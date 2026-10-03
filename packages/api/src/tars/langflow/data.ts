import { z } from 'zod';
import { Tools } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { TarsDataFile } from '~/tars/files/sign';
import type { LangflowToolResult } from './client';
import {
  langflowTimeoutMs,
  langflowToolResult,
  toTarsTraceArtifact,
  runLangflowCapability,
  resolveLangflowModelName,
  LANGFLOW_TOOL_RESPONSE_FORMAT,
  TARS_CAPABILITY_DEFAULT_TIMEOUT_MS,
} from './client';
import { toTarsDataFileRefsContext } from '~/tars/files/sign';
import { TarsRequestError } from '~/tars/client';

export const TARS_DATA_TOOL_NAME: Tools = Tools.data_query;

const DATA_PATH = '/api/langflow-service/data';

const TARS_DATA_DESCRIPTION: string =
  'Answer a question over the spreadsheet files (csv/xlsx) attached to this conversation. Sends ' +
  'the question to the TARS data agent, which loads the sheets into an in-memory SQL workspace, ' +
  'writes and runs read-only queries, and returns the answer. Ask a complete question in plain ' +
  "language — never SQL. The files it can read are listed in this tool's runtime context; leave " +
  '`file_ids` empty to use all of them.';

const TARS_DATA_JSON_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        'The question to answer over the attached spreadsheets, in plain language and in the language the user asked it.',
    },
    file_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional subset of the attached files (file_id values from the runtime context). Omit to query every attached spreadsheet.',
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
  file_ids: z
    .array(z.string())
    .optional()
    .describe(
      'Optional subset of the attached files (file_id values from the runtime context). ' +
        'Omit to query every attached spreadsheet.',
    ),
});

export interface TarsDataToolOptions {
  /** Absent for a LibreChat account not linked to pwc_tars — nothing is reachable. */
  tarsUserId?: string;
  /** The thread's spreadsheets (csv / xlsx / xls LibreChat uploads). */
  dataFiles?: TarsDataFile[];
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

function describe(files: TarsDataFile[]): string {
  if (!files.length) {
    return `${TARS_DATA_DESCRIPTION}\n\n${NO_FILES}`;
  }
  const lines = files.map((file) => `- ${file.filename} (file_id: ${file.id})`);
  return `${TARS_DATA_DESCRIPTION}\n\nAttached spreadsheets:\n${lines.join('\n')}`;
}

/**
 * Resolves the requested subset against the conversation's own attachments —
 * ids outside the thread are dropped rather than forwarded, so the call can
 * never read another conversation's files.
 */
function selectFiles(files: TarsDataFile[], requested?: string[]): TarsDataFile[] {
  if (!requested?.length) {
    return files;
  }
  const wanted = new Set(requested);
  return files.filter((file) => wanted.has(file.id));
}

/**
 * The pwc_tars data capability as one native LibreChat tool. Equipped
 * for saved agents that list it; pwc_tars owns the sheet-to-SQL loop,
 * LibreChat only bounds which files may be asked and relays the answer.
 */
export function createTarsDataTool(options: TarsDataToolOptions): DynamicStructuredTool {
  const files = options.dataFiles ?? [];
  return tool(
    async (input: z.infer<typeof dataQuerySchema>): Promise<LangflowToolResult> => {
      if (!options.tarsUserId) {
        return langflowToolResult(NOT_LINKED);
      }
      const selected = selectFiles(files, input.file_ids);
      const dataFileRefs = toTarsDataFileRefsContext(selected, options.librechatUserId);
      if (!dataFileRefs) {
        return langflowToolResult(NO_FILES);
      }
      try {
        const requestedModel = await resolveLangflowModelName(options.model, 'tars-data');
        const data = await runLangflowCapability(
          DATA_PATH,
          {
            query: input.question,
            data_file_refs: dataFileRefs,
            model_name: requestedModel,
          },
          {
            timeoutMs: langflowTimeoutMs(
              'TARS_DATA_AGENT_TIMEOUT_MS',
              TARS_CAPABILITY_DEFAULT_TIMEOUT_MS,
            ),
            librechatUserId: options.librechatUserId,
            tarsUserId: options.tarsUserId,
          },
        );
        logger.debug(
          `[tars-data] files=${selected.length} requested=${requestedModel ?? '(pwc_tars default)'} ` +
            `used=${data.model_name ?? '(unreported)'} tokens=${data.tokens?.total ?? 0} ` +
            'gateway=requested',
        );
        return langflowToolResult(
          data.answer?.trim() || '(pwc_tars returned no answer.)',
          toTarsTraceArtifact(data),
        );
      } catch (error) {
        return langflowToolResult(`The data query failed: ${toErrorMessage(error)}`);
      }
    },
    {
      name: TARS_DATA_TOOL_NAME,
      description: options.tarsUserId
        ? describe(files)
        : `${TARS_DATA_DESCRIPTION}\n\n${NOT_LINKED}`,
      schema: dataQuerySchema,
      responseFormat: LANGFLOW_TOOL_RESPONSE_FORMAT,
    },
  ) as unknown as DynamicStructuredTool;
}
