import { z } from 'zod';
import { Tools } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { TarsMemoryDocument } from '~/tars/memory/client';
import { langflowTimeoutMs, runLangflowCapability, resolveLangflowModelName } from './client';
import { TarsRequestError } from '~/tars/client';

export const TARS_DATA_TOOL_NAME: Tools = Tools.data_query;

const DATA_PATH = '/api/langflow-service/data';
const DEFAULT_TIMEOUT_MS = 240_000;

const TARS_DATA_DESCRIPTION: string =
  'Answer a question over the spreadsheet files (csv/xlsx) attached to this conversation. Sends ' +
  'the question to the TARS data agent, which loads the sheets into an in-memory SQL workspace, ' +
  'writes and runs read-only queries, and returns the answer. Ask a complete question in plain ' +
  "language — never SQL. The files it can read are listed in this tool's runtime context; leave " +
  '`document_ids` empty to use all of them.';

const TARS_DATA_JSON_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        'The question to answer over the attached spreadsheets, in plain language and in the language the user asked it.',
    },
    document_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional subset of the attached files (document_id values from the runtime context). Omit to query every attached spreadsheet.',
    },
  },
  required: ['question'],
} as const;

interface TarsDataToolDefinitionShape {
  name: string;
  description: string;
  schema: typeof TARS_DATA_JSON_SCHEMA;
}

/** Registry entry so the tool survives the definition-only (deferred) load path. */
export const TarsDataToolDefinition: TarsDataToolDefinitionShape = {
  name: TARS_DATA_TOOL_NAME as string,
  description: TARS_DATA_DESCRIPTION,
  schema: TARS_DATA_JSON_SCHEMA,
};

const dataQuerySchema = z.object({
  question: z
    .string()
    .describe(
      'The question to answer over the attached spreadsheets, in plain language and in the ' +
        'language the user asked it.',
    ),
  document_ids: z
    .array(z.string())
    .optional()
    .describe(
      'Optional subset of the attached files (document_id values from the runtime context). ' +
        'Omit to query every attached spreadsheet.',
    ),
});

export interface TarsDataToolOptions {
  /** Absent for a LibreChat account not linked to pwc_tars — nothing is reachable. */
  tarsUserId?: string;
  /** The status=1 structured memory documents of this conversation. */
  documents?: TarsMemoryDocument[];
  model?: string;
  librechatUserId?: string;
}

const NOT_LINKED =
  'This LibreChat account is not linked to pwc_tars, so no attached file can be queried.';
const NO_FILES =
  'No spreadsheet file (csv/xlsx) is attached to this conversation, so there is nothing to query.';

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

function describe(documents: TarsMemoryDocument[]): string {
  if (!documents.length) {
    return `${TARS_DATA_DESCRIPTION}\n\n${NO_FILES}`;
  }
  const lines = documents.map((doc) => `- ${doc.filename} (document_id: ${doc.id})`);
  return `${TARS_DATA_DESCRIPTION}\n\nAttached spreadsheets:\n${lines.join('\n')}`;
}

/**
 * Resolves the requested subset against the conversation's own attachments —
 * ids outside the snapshot are dropped rather than forwarded, so the call can
 * never read another conversation's files.
 */
function resolveDocumentIds(documents: TarsMemoryDocument[], requested?: string[]): string[] {
  if (!requested?.length) {
    return documents.map((doc) => doc.id);
  }
  const known = new Set(documents.map((doc) => doc.id));
  return requested.filter((id) => known.has(id));
}

/**
 * The pwc_tars data capability as one native LibreChat tool. Equipped
 * automatically whenever the conversation's long-term memory holds an active
 * structured file; pwc_tars owns the sheet-to-SQL loop, LibreChat only bounds
 * which documents may be asked and relays the answer.
 */
export function createTarsDataTool(options: TarsDataToolOptions): DynamicStructuredTool {
  const documents = options.documents ?? [];
  return tool(
    async (input: z.infer<typeof dataQuerySchema>): Promise<string> => {
      if (!options.tarsUserId) {
        return NOT_LINKED;
      }
      const documentIds = resolveDocumentIds(documents, input.document_ids);
      if (!documentIds.length) {
        return NO_FILES;
      }
      try {
        const requestedModel = await resolveLangflowModelName(options.model, 'tars-data');
        const data = await runLangflowCapability(
          DATA_PATH,
          {
            query: input.question,
            document_ids: documentIds.join(','),
            model_name: requestedModel,
          },
          {
            timeoutMs: langflowTimeoutMs('TARS_DATA_AGENT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
            librechatUserId: options.librechatUserId,
          },
        );
        logger.debug(
          `[tars-data] docs=${documentIds.length} requested=${requestedModel ?? '(pwc_tars default)'} ` +
            `used=${data.model_name ?? '(unreported)'} tokens=${data.tokens?.total ?? 0} ` +
            'gateway=requested',
        );
        return data.answer?.trim() || '(pwc_tars returned no answer.)';
      } catch (error) {
        return `The data query failed: ${toErrorMessage(error)}`;
      }
    },
    {
      name: TARS_DATA_TOOL_NAME,
      description: options.tarsUserId
        ? describe(documents)
        : `${TARS_DATA_DESCRIPTION}\n\n${NOT_LINKED}`,
      schema: dataQuerySchema,
    },
  ) as unknown as DynamicStructuredTool;
}
