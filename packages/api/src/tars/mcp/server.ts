import { logger } from '@librechat/data-schemas';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { listTarsMcpTools, executeTarsMcpTool } from './client';
import { TarsRequestError } from '~/tars/client';

const SERVER_INFO = { name: 'tars-mcp-gateway', version: '1.0.0' };

function formatResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result ?? null);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * An MCP server exposing the pwc_tars OpenAPI / custom-API tools visible to one
 * pwc_tars user. Listing and execution both proxy to the pwc_tars `/api/mcp`
 * REST API, so pwc_tars stays the source of truth for tool definitions and
 * domain permissions. A `null` user (LibreChat account not linked to pwc_tars)
 * fails closed to an empty tool list.
 */
export function createTarsMcpServer(tarsUserId: string | null): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    if (!tarsUserId) {
      return { tools: [] };
    }
    const entries = await listTarsMcpTools(tarsUserId);
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
        content: [{ type: 'text', text: 'This LibreChat account is not linked to pwc_tars.' }],
        isError: true,
      };
    }
    try {
      const { result } = await executeTarsMcpTool(tarsUserId, name, toolArguments);
      return { content: [{ type: 'text', text: formatResult(result) }] };
    } catch (error) {
      logger.warn(
        `[tars-mcp] Tool "${name}" failed for pwc_tars user ${tarsUserId}: ${toErrorMessage(error)}`,
      );
      return {
        content: [{ type: 'text', text: `TARS tool call failed: ${toErrorMessage(error)}` }],
        isError: true,
      };
    }
  });

  return server;
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
}): Promise<void> {
  const server = createTarsMcpServer(args.tarsUserId);
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
