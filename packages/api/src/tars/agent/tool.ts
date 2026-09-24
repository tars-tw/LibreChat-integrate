import { z } from 'zod';
import { Tools } from 'librechat-data-provider';
import { tool } from '@librechat/agents/langchain/tools';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { LangflowToolResult } from '~/tars/langflow/client';
import type { TarsAgentBindings } from './bindings';
import type { TarsAgentScope } from './client';
import { langflowToolResult, LANGFLOW_TOOL_RESPONSE_FORMAT } from '~/tars/langflow/client';
import { listTarsAgentScope, runTarsAgent } from './client';
import { hasTarsAgentBindings } from './bindings';
import { TarsRequestError } from '~/tars/client';

export const TARS_AGENT_TOOL_NAME: Tools = Tools.tars_agent;

/**
 * What the tool tells the model about itself, independent of any request. What
 * it may actually reach varies per turn and arrives as runtime context
 * ({@link buildTarsAgentContext}), because the definition registry is resolved
 * once at module load while the reachable set follows the active 專用腦 and the
 * chat's switches.
 */
const TARS_AGENT_DESCRIPTION: string =
  'Send a question to the TARS agent, which works with the company data this turn has bound — ' +
  'the knowledge bases (documents, cited by file name), their SQL databases (read-only SQL, ' +
  'returning the rows and the SQL used), the spreadsheets attached to this conversation, and ' +
  'chart or file generation — deciding by itself which of them the question needs, possibly ' +
  'several. Ask a complete question in plain language — never SQL. What is bound this turn is ' +
  "listed in this tool's runtime context; the optional arguments only narrow it: leave " +
  '`knowledge_base_ids` and `document_ids` empty to use everything listed, and name a ' +
  '`database_knowledge_base_id` only when several databases are listed and the question is about ' +
  'records or figures. Links the agent returns (charts, files) must be copied into your reply verbatim.';

const TARS_AGENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        'The question to answer, in plain language and in the language the user asked it.',
    },
    knowledge_base_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional subset of the knowledge bases listed in the runtime context. Omit to search every one of them.',
    },
    database_knowledge_base_id: {
      type: 'string',
      description:
        'Which database to bind, by its knowledge_base_id. Only needed when the runtime context lists more than one database.',
    },
    document_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional subset of the attached spreadsheets (document_id values from the runtime context). Omit to use all of them.',
    },
  },
  required: ['question'],
} as const;

interface TarsAgentToolDefinitionShape {
  name: string;
  description: string;
  schema: typeof TARS_AGENT_JSON_SCHEMA;
}

/** Registry entry so the tool survives the definition-only (deferred) load path. */
export const TarsAgentToolDefinition: TarsAgentToolDefinitionShape = {
  name: TARS_AGENT_TOOL_NAME as string,
  description: TARS_AGENT_DESCRIPTION,
  schema: TARS_AGENT_JSON_SCHEMA,
};

const tarsAgentSchema = z.object({
  question: z
    .string()
    .describe('The question to answer, in plain language and in the language the user asked it.'),
  knowledge_base_ids: z
    .array(z.string())
    .optional()
    .describe(
      'Optional subset of the knowledge bases listed in this tool description. Omit to search ' +
        'every one of them.',
    ),
  database_knowledge_base_id: z
    .string()
    .optional()
    .describe(
      'Which database to bind, by its knowledge_base_id. Only needed when more than one database ' +
        'is listed in this tool description.',
    ),
  document_ids: z
    .array(z.string())
    .optional()
    .describe(
      'Optional subset of the attached spreadsheets (document_id values from this tool ' +
        'description). Omit to use all of them.',
    ),
});

export interface TarsAgentToolOptions {
  /**
   * pwc_tars user this tool runs as; what it may reach follows from it. Absent
   * for a LibreChat account not linked to pwc_tars — the tool is still built
   * (dropping it would leave the agent short a tool it was equipped with) but
   * reaches nothing.
   */
  tarsUserId?: string;
  /** Active 專用腦 — everything is narrowed to what it binds. */
  domainId?: string | number | null;
  /** What this turn binds into the loop; see `resolveTarsAgentBindings`. */
  bindings: TarsAgentBindings;
  /** Model the chat turn runs on; the nested pwc_tars loop inherits it. */
  model?: string;
  librechatUserId?: string;
}

const NOT_LINKED = 'This LibreChat account is not linked to pwc_tars, so nothing can be reached.';
const NOTHING_BOUND =
  'Nothing is bound for this turn — no knowledge base, database, spreadsheet or chart request — so this tool cannot answer anything right now.';

function listScope(scope: TarsAgentScope): string {
  const lines: string[] = [];
  if (scope.knowledgeBases.length) {
    lines.push('Knowledge bases (all searched unless `knowledge_base_ids` narrows it):');
    lines.push(
      ...scope.knowledgeBases.map((base) =>
        base.description
          ? `- ${base.name} (knowledge_base_id: ${base.knowledge_base_id}) — ${base.description}`
          : `- ${base.name} (knowledge_base_id: ${base.knowledge_base_id})`,
      ),
    );
  }
  if (scope.databases.length === 1) {
    lines.push(`Database: ${scope.databases[0].name}, bound automatically.`);
  } else if (scope.databases.length > 1) {
    lines.push('Databases (pass one as `database_knowledge_base_id` for a data question):');
    lines.push(
      ...scope.databases.map(
        (database) => `- ${database.name} (knowledge_base_id: ${database.knowledge_base_id})`,
      ),
    );
  }
  if (scope.documents.length) {
    lines.push('Attached spreadsheets (all loaded unless `document_ids` narrows it):');
    lines.push(...scope.documents.map((doc) => `- ${doc.filename} (document_id: ${doc.id})`));
  }
  if (scope.chart) {
    lines.push('Charts: the agent can render a chart as a PNG and return its markdown image link.');
  }
  return lines.length ? lines.join('\n') : NOTHING_BOUND;
}

function describe(scope: TarsAgentScope): string {
  return `${TARS_AGENT_DESCRIPTION}\n\n${listScope(scope)}`;
}

/**
 * The runtime context block naming what this turn may reach. Written into the
 * system prompt the same way the SQL agent's context is, so the definition-only
 * load path — which never builds the tool instance and so never sees its
 * dynamic description — still tells the model what it can reach.
 */
export async function buildTarsAgentContext(
  tarsUserId: string | undefined,
  domainId: string | number | null | undefined,
  bindings: TarsAgentBindings,
): Promise<string> {
  const body = tarsUserId
    ? listScope(await listTarsAgentScope(tarsUserId, domainId, bindings))
    : NOT_LINKED;
  return `# \`${TARS_AGENT_TOOL_NAME}\` Runtime Context\n${body}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * pwc_tars's chat as one native LibreChat tool. It stands in for every
 * loop-backed TARS capability the turn has switched on (knowledge bases,
 * database, spreadsheets, charts), so a question costs one nested run however
 * many of them are on: pwc_tars's model picks the tools inside a single loop,
 * the way it does in its own chat, and the trace shows what it chose.
 */
export async function createTarsAgentTool(
  options: TarsAgentToolOptions,
): Promise<DynamicStructuredTool> {
  const { tarsUserId, bindings } = options;
  const bound = hasTarsAgentBindings(bindings);
  /** No pwc_tars identity or nothing bound means nothing is reachable, so skip the round trip. */
  const scope: TarsAgentScope =
    tarsUserId && bound
      ? await listTarsAgentScope(tarsUserId, options.domainId, bindings)
      : { knowledgeBases: [], databases: [], documents: [], chart: false };

  return tool(
    async (input: z.infer<typeof tarsAgentSchema>): Promise<LangflowToolResult> => {
      if (!tarsUserId) {
        return langflowToolResult(NOT_LINKED);
      }
      if (!bound) {
        return langflowToolResult(NOTHING_BOUND);
      }
      try {
        const result = await runTarsAgent(tarsUserId, {
          question: input.question,
          bindings,
          knowledgeBaseIds: input.knowledge_base_ids,
          databaseKnowledgeBaseId: input.database_knowledge_base_id,
          documentIds: input.document_ids,
          domainId: options.domainId,
          model: options.model,
          librechatUserId: options.librechatUserId,
        });
        return langflowToolResult(result.answer, result.trace);
      } catch (error) {
        return langflowToolResult(`The TARS agent failed: ${toErrorMessage(error)}`);
      }
    },
    {
      name: TARS_AGENT_TOOL_NAME,
      description: tarsUserId ? describe(scope) : `${TARS_AGENT_DESCRIPTION}\n\n${NOT_LINKED}`,
      schema: tarsAgentSchema,
      responseFormat: LANGFLOW_TOOL_RESPONSE_FORMAT,
    },
  ) as unknown as DynamicStructuredTool;
}
