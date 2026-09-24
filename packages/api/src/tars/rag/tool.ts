import { z } from 'zod';
import { Tools } from 'librechat-data-provider';
import { tool } from '@librechat/agents/langchain/tools';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { LangflowToolResult } from '~/tars/langflow/client';
import type { TarsRagKnowledgeBase } from './client';
import { langflowToolResult, LANGFLOW_TOOL_RESPONSE_FORMAT } from '~/tars/langflow/client';
import { listTarsRagKnowledgeBases, runTarsRagAgent } from './client';
import { TarsRequestError } from '~/tars/client';

export const TARS_RAG_TOOL_NAME: Tools = Tools.rag_agent;

/**
 * What the tool tells the model about itself, independent of any request. The
 * knowledge bases it may actually search vary per turn and arrive as runtime
 * context ({@link buildTarsRagContext}), because the definition registry is
 * resolved once at module load while the reachable set follows the active 專用腦.
 */
const TARS_RAG_DESCRIPTION: string =
  "Answer a question from the company's knowledge bases (uploaded documents, websites, file " +
  'shares). Sends the question to the TARS RAG agent, which retrieves the relevant passages, ' +
  'answers from them and cites the source file names. Ask a complete question in plain ' +
  "language. The knowledge bases you may search are listed in this tool's runtime context; " +
  'leave `knowledge_base_ids` empty to search all of them, or pass a subset to narrow the search.';

const TARS_RAG_JSON_SCHEMA = {
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
  },
  required: ['question'],
} as const;

interface TarsRagToolDefinitionShape {
  name: string;
  description: string;
  schema: typeof TARS_RAG_JSON_SCHEMA;
}

/** Registry entry so the tool survives the definition-only (deferred) load path. */
export const TarsRagToolDefinition: TarsRagToolDefinitionShape = {
  name: TARS_RAG_TOOL_NAME as string,
  description: TARS_RAG_DESCRIPTION,
  schema: TARS_RAG_JSON_SCHEMA,
};

const ragAgentSchema = z.object({
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
});

export interface TarsRagToolOptions {
  /**
   * pwc_tars user this tool runs as; the knowledge bases it may reach follow
   * from it. Absent for a LibreChat account not linked to pwc_tars — the tool
   * is still built (dropping it would leave the agent short a tool it was
   * equipped with) but reaches nothing.
   */
  tarsUserId?: string;
  /** Active 專用腦 — the knowledge bases are narrowed to the ones it binds. */
  domainId?: string | number | null;
  /** Model the chat turn runs on; the nested pwc_tars loop inherits it. */
  model?: string;
  librechatUserId?: string;
}

const NOT_LINKED =
  'This LibreChat account is not linked to pwc_tars, so no knowledge base can be searched.';
const NO_KNOWLEDGE_BASES =
  'The active brain (專用腦) binds no knowledge base, so this tool cannot answer anything right now.';

function listKnowledgeBases(bases: TarsRagKnowledgeBase[]): string {
  if (!bases.length) {
    return NO_KNOWLEDGE_BASES;
  }
  const lines = bases.map((base) =>
    base.description
      ? `- ${base.name} (knowledge_base_id: ${base.knowledge_base_id}) — ${base.description}`
      : `- ${base.name} (knowledge_base_id: ${base.knowledge_base_id})`,
  );
  return `Searchable knowledge bases (all of them unless \`knowledge_base_ids\` narrows it):\n${lines.join('\n')}`;
}

function describe(bases: TarsRagKnowledgeBase[]): string {
  return `${TARS_RAG_DESCRIPTION}\n\n${listKnowledgeBases(bases)}`;
}

/**
 * The runtime context block naming the knowledge bases this turn may search.
 * Written into the system prompt the same way the SQL agent's context is, so
 * the definition-only load path — which never builds the tool instance and so
 * never sees its dynamic description — still tells the model what it can reach.
 */
export async function buildTarsRagContext(
  tarsUserId: string | undefined,
  domainId?: string | number | null,
): Promise<string> {
  const body = tarsUserId
    ? listKnowledgeBases(await listTarsRagKnowledgeBases(tarsUserId, domainId))
    : NOT_LINKED;
  return `# \`${TARS_RAG_TOOL_NAME}\` Runtime Context\n${body}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The pwc_tars RAG agent as one native LibreChat tool.
 *
 * The reachable knowledge bases are resolved once per request and written into
 * the tool's own description, so the model can search the whole brain without
 * naming anything, or narrow to a subset by id. pwc_tars owns retrieval and
 * the cited answer; this only bounds which knowledge bases may be searched and
 * relays the answer, with the nested run's trace, back into the agent loop.
 */
export async function createTarsRagTool(
  options: TarsRagToolOptions,
): Promise<DynamicStructuredTool> {
  const { tarsUserId } = options;
  /** No pwc_tars identity means nothing is reachable, so skip the round trip. */
  const bases = tarsUserId
    ? await listTarsRagKnowledgeBases(tarsUserId, options.domainId)
    : ([] as TarsRagKnowledgeBase[]);

  return tool(
    async (input: z.infer<typeof ragAgentSchema>): Promise<LangflowToolResult> => {
      if (!tarsUserId) {
        return langflowToolResult(NOT_LINKED);
      }
      if (!bases.length) {
        return langflowToolResult(NO_KNOWLEDGE_BASES);
      }
      try {
        const result = await runTarsRagAgent(tarsUserId, {
          question: input.question,
          knowledgeBaseIds: input.knowledge_base_ids,
          domainId: options.domainId,
          model: options.model,
          librechatUserId: options.librechatUserId,
        });
        return langflowToolResult(result.answer, result.trace);
      } catch (error) {
        return langflowToolResult(`The knowledge base search failed: ${toErrorMessage(error)}`);
      }
    },
    {
      name: TARS_RAG_TOOL_NAME,
      description: tarsUserId ? describe(bases) : `${TARS_RAG_DESCRIPTION}\n\n${NOT_LINKED}`,
      schema: ragAgentSchema,
      responseFormat: LANGFLOW_TOOL_RESPONSE_FORMAT,
    },
  ) as unknown as DynamicStructuredTool;
}
