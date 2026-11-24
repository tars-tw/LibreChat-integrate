import { logger } from '@librechat/data-schemas';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ContentBlockSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  ContentBlock,
  CallToolResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { TARS_NOT_LINKED, tarsToolFailureText } from '~/tars/failure';
import { listTarsMcpTools, executeTarsMcpTool } from './client';
import { TarsRequestError } from '~/tars/client';
import { isTarsMcpOidcGateway } from './names';

const SERVER_INFO = { name: 'tars-mcp-gateway', version: '1.0.0' };

function formatResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result ?? null);
}

/**
 * The images and files pwc_tars relayed beside its text result. Its `result` already holds
 * the text parts and a placeholder per file, so text parts are not repeated; a text file
 * (CSV, an attachment) arrives as a text resource whose body only this part carries. A part
 * the MCP schema rejects is dropped rather than failing the call.
 */
function relayedFileParts(content: unknown[] | undefined): ContentBlock[] {
  const parts: ContentBlock[] = [];
  for (const item of content ?? []) {
    const parsed = ContentBlockSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const part = parsed.data;
    if (part.type === 'text') {
      continue;
    }
    parts.push(part);
  }
  return parts;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * An MCP server exposing the pwc_tars tools visible to one pwc_tars user,
 * scoped to a single pwc_tars server when `serverId` is given (per-server
 * gateway entries) or aggregated across all servers (legacy single entry).
 * Listing and execution both proxy to the pwc_tars `/api/mcp` REST API, so
 * pwc_tars stays the source of truth for tool definitions and user/group
 * permissions. A `null` user (LibreChat account not linked to pwc_tars) fails
 * closed to an empty tool list. `accessToken` is the caller's OIDC access token,
 * handed to pwc_tars with each call on a server that runs on one.
 */
export function createTarsMcpServer(
  tarsUserId: string | null,
  serverId?: string,
  accessToken?: string,
): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    if (!tarsUserId) {
      return { tools: [] };
    }
    const entries = await listTarsMcpTools(tarsUserId, serverId);
    return {
      tools: entries.map((entry) => ({
        name: entry.name,
        description: entry.description,
        inputSchema: entry.inputSchema as ListToolsResult['tools'][number]['inputSchema'],
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: toolArguments } = request.params;
    if (!tarsUserId) {
      return {
        content: [{ type: 'text', text: `${TARS_NOT_LINKED}.` }],
        isError: true,
      };
    }
    try {
      const { result, content } = await executeTarsMcpTool(
        tarsUserId,
        name,
        toolArguments,
        serverId,
        accessToken,
      );
      return {
        content: [{ type: 'text', text: formatResult(result) }, ...relayedFileParts(content)],
      };
    } catch (error) {
      logger.warn(
        `[tars-mcp] Tool "${name}" failed for pwc_tars user ${tarsUserId}: ${toErrorMessage(error)}`,
      );
      return {
        content: [
          { type: 'text', text: tarsToolFailureText('TARS tool call', toErrorMessage(error)) },
        ],
        isError: true,
      };
    }
  });

  return server;
}

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i;

/**
 * The caller's access token for a server pwc_tars runs on one: the token, or `null` when that
 * server is called without one or with one already expired. Any other server gets `undefined`,
 * whatever the header holds, so a token is never handed to pwc_tars for an API it was not issued
 * for.
 */
export function readGatewayAccessToken(
  serverId: string | undefined,
  authorization: string | undefined,
  now: number = Date.now(),
): string | null | undefined {
  if (serverId == null || !isTarsMcpOidcGateway(serverId)) {
    return undefined;
  }
  const token = authorization?.match(BEARER_PATTERN)?.[1];
  return token != null && !isExpiredJwt(token, now) ? token : null;
}

/**
 * A direct server answers an expired token with 401, which is what makes the MCP client refresh;
 * the API behind the gateway answers pwc_tars instead, and the user would only see a failed tool.
 * So the gateway reads `exp` off a JWT access token (unverified: it only decides when to ask for
 * a fresh one, the API still checks the token). An opaque token is passed on as it is.
 */
function isExpiredJwt(token: string, now: number): boolean {
  const payload = token.split('.')[1];
  if (payload == null) {
    return false;
  }
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof exp === 'number' && exp * 1000 <= now;
  } catch {
    return false;
  }
}

/**
 * RFC 6750 §3: the 401 an MCP client takes as "sign in", which starts the OAuth flow, or a
 * refresh when it holds a refresh token.
 */
function rejectUnauthenticated(res: ServerResponse): void {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer',
  });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Sign-in required' },
      id: null,
    }),
  );
}

/**
 * Handles one stateless streamable-http MCP request (initialize / tools/list /
 * tools/call arrive as independent POSTs). A fresh Server + transport pair per
 * request keeps the gateway session-free, matching how LibreChat's own MCP
 * client consumes stateless streamable-http servers.
 */
export async function handleTarsMcpRequest(args: {
  req: IncomingMessage;
  res: ServerResponse;
  body?: unknown;
  tarsUserId: string | null;
  serverId?: string;
}): Promise<void> {
  const accessToken = readGatewayAccessToken(args.serverId, args.req.headers.authorization);
  if (accessToken === null) {
    rejectUnauthenticated(args.res);
    return;
  }
  const server = createTarsMcpServer(args.tarsUserId, args.serverId, accessToken);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  args.res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(args.req, args.res, args.body);
}
