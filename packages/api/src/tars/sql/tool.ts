import { z } from 'zod';
import { Tools } from 'librechat-data-provider';
import { tool } from '@librechat/agents/langchain/tools';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { TarsSqlDatabase } from './client';
import { listTarsSqlDatabases, runTarsSqlAgent } from './client';
import { TarsRequestError } from '~/tars/client';

export const TARS_SQL_TOOL_NAME: Tools = Tools.sql_agent;

/**
 * What the tool tells the model about itself, independent of any request. The
 * databases it may actually reach vary per turn and arrive as runtime context
 * ({@link buildTarsSqlContext}), because the definition registry is resolved
 * once at module load while the reachable set follows the active 專用腦.
 */
const TARS_SQL_DESCRIPTION: string =
  'Answer a question from a real SQL database. Sends the question to the TARS SQL agent, which ' +
  'reads the bound schema, writes and runs read-only SQL, and returns the resulting rows ' +
  'together with the SQL it used. Ask a complete question in plain language — never SQL. The ' +
  'table it returns can be passed to other tools for charting or further analysis. The databases ' +
  "you may query are listed in this tool's runtime context; when only one is listed, leave " +
  '`knowledge_base_id` empty.';

const TARS_SQL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        'The question to answer, in plain language and in the language the user asked it.',
    },
    knowledge_base_id: {
      type: 'string',
      description:
        'Which database to query. Only needed when the runtime context lists more than one.',
    },
  },
  required: ['question'],
} as const;

interface TarsSqlToolDefinitionShape {
  name: string;
  description: string;
  schema: typeof TARS_SQL_JSON_SCHEMA;
}

/** Registry entry so the tool survives the definition-only (deferred) load path. */
export const TarsSqlToolDefinition: TarsSqlToolDefinitionShape = {
  name: TARS_SQL_TOOL_NAME as string,
  description: TARS_SQL_DESCRIPTION,
  schema: TARS_SQL_JSON_SCHEMA,
};

const sqlAgentSchema = z.object({
  question: z
    .string()
    .describe('The question to answer, in plain language and in the language the user asked it.'),
  knowledge_base_id: z
    .string()
    .optional()
    .describe(
      'Which database to query. Only needed when more than one is listed in this tool description.',
    ),
});

export interface TarsSqlToolOptions {
  /**
   * pwc_tars user this tool runs as; the databases it may reach follow from it.
   * Absent for a LibreChat account not linked to pwc_tars — the tool is still
   * built (dropping it would leave the agent short a tool it was equipped with)
   * but reaches nothing.
   */
  tarsUserId?: string;
  /** Active 專用腦 — the databases are narrowed to the ones it binds. */
  domainId?: string | number | null;
  /** Model the chat turn runs on; the nested pwc_tars loop inherits it. */
  model?: string;
  librechatUserId?: string;
}

const NOT_LINKED =
  'This LibreChat account is not linked to pwc_tars, so no database can be queried.';

function listDatabases(databases: TarsSqlDatabase[]): string {
  if (!databases.length) {
    return 'No database is bound to the active brain (專用腦), so this tool cannot answer anything right now.';
  }
  if (databases.length === 1) {
    return `Queries ${databases[0].name}. Leave \`knowledge_base_id\` empty.`;
  }
  const lines = databases.map((database) =>
    database.description
      ? `- ${database.name} (knowledge_base_id: ${database.knowledge_base_id}) — ${database.description}`
      : `- ${database.name} (knowledge_base_id: ${database.knowledge_base_id})`,
  );
  return `Available databases — pass one as \`knowledge_base_id\`:\n${lines.join('\n')}`;
}

function describe(databases: TarsSqlDatabase[]): string {
  return `${TARS_SQL_DESCRIPTION}\n\n${listDatabases(databases)}`;
}

/**
 * The runtime context block naming the databases this turn may query. Written
 * into the system prompt the same way web search's context is, so the
 * definition-only load path — which never builds the tool instance and so never
 * sees its dynamic description — still tells the model what it can reach.
 */
export async function buildTarsSqlContext(
  tarsUserId: string | undefined,
  domainId?: string | number | null,
): Promise<string> {
  const body = tarsUserId
    ? listDatabases(await listTarsSqlDatabases(tarsUserId, domainId))
    : NOT_LINKED;
  return `# \`${TARS_SQL_TOOL_NAME}\` Runtime Context\n${body}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The pwc_tars SQL agent as one native LibreChat tool.
 *
 * The reachable databases are resolved once per request and written into the
 * tool's own description, which is what removes the usual list-then-query round
 * trip: a brain binding a single database needs no `knowledge_base_id` at all,
 * and a brain binding several advertises them by name. pwc_tars owns the whole
 * text-to-SQL loop; this only bounds which knowledge base may be asked and
 * relays the answer back into the agent loop.
 */
export async function createTarsSqlTool(
  options: TarsSqlToolOptions,
): Promise<DynamicStructuredTool> {
  const { tarsUserId } = options;
  /** No pwc_tars identity means nothing is reachable, so skip the round trip. */
  const databases = tarsUserId
    ? await listTarsSqlDatabases(tarsUserId, options.domainId)
    : ([] as TarsSqlDatabase[]);
  const only = databases.length === 1 ? databases[0].knowledge_base_id : undefined;

  return tool(
    async (input: z.infer<typeof sqlAgentSchema>): Promise<string> => {
      if (!tarsUserId) {
        return NOT_LINKED;
      }
      const knowledgeBaseId = input.knowledge_base_id?.trim() || only;
      if (!knowledgeBaseId) {
        return databases.length
          ? `Pick a database first: pass one of ${databases
              .map((database) => `${database.name} (${database.knowledge_base_id})`)
              .join(', ')} as \`knowledge_base_id\`.`
          : 'The active brain (專用腦) has no knowledge base with a database bound, so there is nothing to query.';
      }
      try {
        const result = await runTarsSqlAgent(tarsUserId, {
          question: input.question,
          knowledgeBaseId,
          domainId: options.domainId,
          model: options.model,
          librechatUserId: options.librechatUserId,
        });
        return result.answer;
      } catch (error) {
        return `The database query failed: ${toErrorMessage(error)}`;
      }
    },
    {
      name: TARS_SQL_TOOL_NAME,
      description: tarsUserId ? describe(databases) : `${TARS_SQL_DESCRIPTION}\n\n${NOT_LINKED}`,
      schema: sqlAgentSchema,
    },
  ) as unknown as DynamicStructuredTool;
}
