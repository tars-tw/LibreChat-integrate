import { z } from 'zod';
import { Tools } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { TarsMemoryDocument } from '~/tars/memory/client';
import { langflowTimeoutMs, runLangflowCapability, resolveLangflowModelName } from './client';
import { fetchTarsDomainKnowledgeBases } from '~/tars/prompts';
import { TarsRequestError } from '~/tars/client';

export const TARS_TABLE_TOOL_NAME: Tools = Tools.table_task;

const TABLE_TASK_PATH = '/api/langflow-service/table-task';
/** pwc_tars caps a table-task run at 1800s; wait a little less to surface our timeout first. */
const DEFAULT_TIMEOUT_MS = 1_740_000;

const TARS_TABLE_DESCRIPTION: string =
  'Apply one instruction to EVERY row of an attached spreadsheet, enriching each row from the ' +
  "active brain's knowledge bases (e.g. match every product row against the knowledge base and " +
  'flag mismatches). This is an exhaustive, long-running batch job — do NOT use it for a single ' +
  'lookup, a filter, or an aggregation; use `data_query` for those. Returns the augmented table ' +
  'plus an xlsx download link — include that link verbatim in your reply. The files it can read ' +
  "are listed in this tool's runtime context; leave `document_ids` empty to use all of them.";

const TARS_TABLE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    task: {
      type: 'string',
      description:
        'What to do for every row, in plain language and in the language the user asked it.',
    },
    document_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional subset of the attached files (document_id values from the runtime context). Omit to use every attached spreadsheet.',
    },
  },
  required: ['task'],
} as const;

interface TarsTableToolDefinitionShape {
  name: string;
  description: string;
  schema: typeof TARS_TABLE_JSON_SCHEMA;
}

/** Registry entry so the tool survives the definition-only (deferred) load path. */
export const TarsTableToolDefinition: TarsTableToolDefinitionShape = {
  name: TARS_TABLE_TOOL_NAME as string,
  description: TARS_TABLE_DESCRIPTION,
  schema: TARS_TABLE_JSON_SCHEMA,
};

const tableTaskSchema = z.object({
  task: z
    .string()
    .describe('What to do for every row, in plain language and in the language the user asked it.'),
  document_ids: z
    .array(z.string())
    .optional()
    .describe(
      'Optional subset of the attached files (document_id values from the runtime context). ' +
        'Omit to use every attached spreadsheet.',
    ),
});

export interface TarsTableToolOptions {
  /** Absent for a LibreChat account not linked to pwc_tars — nothing is reachable. */
  tarsUserId?: string;
  /** Active 專用腦 — its knowledge bases are what each row is enriched from. */
  domainId?: string | number | null;
  /** The status=1 structured memory documents of this conversation. */
  documents?: TarsMemoryDocument[];
  model?: string;
  librechatUserId?: string;
}

const NOT_LINKED =
  'This LibreChat account is not linked to pwc_tars, so no attached file can be processed.';
const NO_FILES =
  'No spreadsheet file (csv/xlsx) is attached to this conversation, so there is nothing to process.';
const NO_DOMAIN =
  'No active brain (專用腦) is selected, so there is no knowledge base to enrich the rows from.';
const NO_KNOWLEDGE_BASES =
  'The active brain (專用腦) binds no knowledge base, so table-task has nothing to enrich the rows from.';

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

function describe(documents: TarsMemoryDocument[]): string {
  if (!documents.length) {
    return `${TARS_TABLE_DESCRIPTION}\n\n${NO_FILES}`;
  }
  const lines = documents.map((doc) => `- ${doc.filename} (document_id: ${doc.id})`);
  return `${TARS_TABLE_DESCRIPTION}\n\nAttached spreadsheets:\n${lines.join('\n')}`;
}

function resolveDocumentIds(documents: TarsMemoryDocument[], requested?: string[]): string[] {
  if (!requested?.length) {
    return documents.map((doc) => doc.id);
  }
  const known = new Set(documents.map((doc) => doc.id));
  return requested.filter((id) => known.has(id));
}

/**
 * The pwc_tars table-task capability as one native LibreChat tool. Equipped
 * automatically alongside `data_query` when the conversation holds active
 * structured memory files. Every row is enriched against the knowledge bases
 * the active 專用腦 binds — the same scoping pwc_tars's own chat path uses —
 * so without a domain (or with a KB-less one) the call is refused up front
 * instead of letting pwc_tars 400 it.
 */
export function createTarsTableTaskTool(options: TarsTableToolOptions): DynamicStructuredTool {
  const documents = options.documents ?? [];
  return tool(
    async (input: z.infer<typeof tableTaskSchema>): Promise<string> => {
      if (!options.tarsUserId) {
        return NOT_LINKED;
      }
      const documentIds = resolveDocumentIds(documents, input.document_ids);
      if (!documentIds.length) {
        return NO_FILES;
      }
      const domainId =
        options.domainId == null || options.domainId === '' ? '' : String(options.domainId);
      if (!domainId) {
        return NO_DOMAIN;
      }
      try {
        const knowledgeBases = await fetchTarsDomainKnowledgeBases(options.tarsUserId, domainId);
        const knowledgeBaseIds = (knowledgeBases ?? []).map((base) => base.id);
        if (!knowledgeBaseIds.length) {
          return NO_KNOWLEDGE_BASES;
        }
        const requestedModel = await resolveLangflowModelName(options.model, 'tars-table');
        const data = await runLangflowCapability(
          TABLE_TASK_PATH,
          {
            query: input.task,
            knowledge_base_ids: knowledgeBaseIds.join(','),
            document_ids: documentIds.join(','),
            model_name: requestedModel,
          },
          {
            timeoutMs: langflowTimeoutMs('TARS_TABLE_TASK_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
            librechatUserId: options.librechatUserId,
          },
        );
        logger.debug(
          `[tars-table] docs=${documentIds.length} kbs=${knowledgeBaseIds.length} ` +
            `requested=${requestedModel ?? '(pwc_tars default)'} used=${data.model_name ?? '(unreported)'} ` +
            `tokens=${data.tokens?.total ?? 0} gateway=requested`,
        );
        const answer = data.answer?.trim() ?? '';
        const fileUrl = data.file_url?.trim() ?? '';
        if (!fileUrl || answer.includes(fileUrl)) {
          return answer || '(pwc_tars returned no answer.)';
        }
        return `${answer}\n\n[下載完整結果 (xlsx)](${fileUrl})`;
      } catch (error) {
        return `The table task failed: ${toErrorMessage(error)}`;
      }
    },
    {
      name: TARS_TABLE_TOOL_NAME,
      description: options.tarsUserId
        ? describe(documents)
        : `${TARS_TABLE_DESCRIPTION}\n\n${NOT_LINKED}`,
      schema: tableTaskSchema,
    },
  ) as unknown as DynamicStructuredTool;
}
