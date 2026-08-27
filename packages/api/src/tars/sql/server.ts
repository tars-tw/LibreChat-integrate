import { logger } from '@librechat/data-schemas';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { listTarsSqlDatabases, runTarsSqlAgent } from './client';
import { recallTarsChatContext } from '~/tars/chat';
import { TarsRequestError } from '~/tars/client';

const SERVER_INFO = { name: 'tars-sql-agent', version: '1.0.0' };

export const LIST_DATABASES_TOOL = 'list_databases';
export const QUERY_DATABASE_TOOL = 'query_database';

/**
 * Static definitions: the pwc_tars SQL agent always offers the same two tools,
 * so `tools/list` never depends on pwc_tars being reachable. Which databases a
 * user may reach is answered by `list_databases` at call time instead.
 */
const TOOLS: ListToolsResult['tools'] = [
  {
    name: LIST_DATABASES_TOOL,
    description:
      'List the databases the active brain (專用腦) can query through the TARS SQL agent. Each ' +
      "entry is one of that brain's knowledge bases with a bound SQL database; use its " +
      `\`knowledge_base_id\` with \`${QUERY_DATABASE_TOOL}\`. Only needed when the brain binds ` +
      'more than one database and the question does not say which.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: QUERY_DATABASE_TOOL,
    description:
      'Answer a question from a real SQL database by running the TARS SQL agent. It inspects the ' +
      'bound schema, writes and executes read-only SQL, and returns the result rows together with ' +
      'the SQL it used. Ask a complete natural-language question (not SQL) and pass the ' +
      `\`knowledge_base_id\` of the target database from \`${LIST_DATABASES_TOOL}\`. ` +
      'The returned table can be handed to other tools for charting or further analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to answer, in the language the user asked it in.',
        },
        knowledge_base_id: {
          type: 'string',
          description: `Target database, from \`${LIST_DATABASES_TOOL}\`.`,
        },
      },
      required: ['question', 'knowledge_base_id'],
      additionalProperties: false,
    },
  },
];

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function formatDatabases(databases: Awaited<ReturnType<typeof listTarsSqlDatabases>>): string {
  if (!databases.length) {
    return 'The active brain (專用腦) has no knowledge base with a database bound. Bind one under 知識庫 → 資料庫, or switch to a brain that has one.';
  }
  const lines = databases.map((database) =>
    database.description
      ? `- ${database.name} (knowledge_base_id: ${database.knowledge_base_id}) — ${database.description}`
      : `- ${database.name} (knowledge_base_id: ${database.knowledge_base_id})`,
  );
  return `Databases available to this user:\n${lines.join('\n')}`;
}

async function callTool(
  tarsUserId: string,
  librechatUserId: string | null,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<CallToolResult> {
  const { domainId } = librechatUserId ? recallTarsChatContext(librechatUserId) : {};
  if (name === LIST_DATABASES_TOOL) {
    return textResult(formatDatabases(await listTarsSqlDatabases(tarsUserId, domainId)));
  }
  if (name !== QUERY_DATABASE_TOOL) {
    return textResult(`Unknown tool "${name}".`, true);
  }

  const question = typeof args?.question === 'string' ? args.question.trim() : '';
  const knowledgeBaseId =
    typeof args?.knowledge_base_id === 'string' ? args.knowledge_base_id.trim() : '';
  if (!question) {
    return textResult('`question` is required.', true);
  }
  if (!knowledgeBaseId) {
    return textResult(
      `\`knowledge_base_id\` is required — call \`${LIST_DATABASES_TOOL}\` first.`,
      true,
    );
  }

  const result = await runTarsSqlAgent(tarsUserId, {
    question,
    knowledgeBaseId,
    librechatUserId: librechatUserId ?? undefined,
  });
  return textResult(result.answer);
}

/**
 * An MCP server exposing the pwc_tars SQL agent to one pwc_tars user. Both
 * tools proxy to pwc_tars (`/api/langflow-service/sql` and the knowledge-base
 * listing), so pwc_tars stays the source of truth for database bindings,
 * schema prompts and read-only enforcement. A `null` user (LibreChat account
 * not linked to pwc_tars) fails closed.
 */
export function createTarsSqlServer(tarsUserId: string | null, librechatUserId?: string): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: tarsUserId ? TOOLS : [],
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: toolArguments } = request.params;
    if (!tarsUserId) {
      return textResult('This LibreChat account is not linked to pwc_tars.', true);
    }
    try {
      return await callTool(tarsUserId, librechatUserId ?? null, name, toolArguments);
    } catch (error) {
      logger.warn(
        `[tars-sql] Tool "${name}" failed for pwc_tars user ${tarsUserId}: ${toErrorMessage(error)}`,
      );
      return textResult(`TARS SQL agent failed: ${toErrorMessage(error)}`, true);
    }
  });

  return server;
}

/**
 * Handles one stateless streamable-http MCP request, mirroring the pwc_tars MCP
 * gateway: a fresh Server + transport pair per POST keeps the endpoint
 * session-free.
 */
export async function handleTarsSqlRequest(args: {
  req: IncomingMessage;
  res: ServerResponse;
  body?: unknown;
  tarsUserId: string | null;
  librechatUserId?: string;
}): Promise<void> {
  const server = createTarsSqlServer(args.tarsUserId, args.librechatUserId);
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
