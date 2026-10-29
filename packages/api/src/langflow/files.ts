import { logger } from '@librechat/data-schemas';
import {
  tarsConfigSchema,
  TARS_WORKFLOW_FILES_ARGUMENT,
  TARS_WORKFLOW_MCP_SERVER_NAME,
} from 'librechat-data-provider';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { TTarsWorkflowFilesConfig } from 'librechat-data-provider';
import type { TarsDataFile, TarsDataFileRef } from '~/tars/files/sign';
import type { TarsTurnFiles } from '~/tars/files/turn';
import { isWorkflowAttachment, signTarsFileRefs } from '~/tars/files/sign';

const DEFAULTS: TTarsWorkflowFilesConfig = tarsConfigSchema.parse({}).workflowFiles;

type WorkflowToolFunc = DynamicStructuredTool['func'];
type WorkflowToolInput = Parameters<WorkflowToolFunc>[0];

/** The fields of a loaded tool this module reads; MCP tools carry `mcp` and their server's name. */
export interface WorkflowToolCandidate {
  name?: string;
  mcp?: boolean;
  mcpRawServerName?: string;
  func?: WorkflowToolFunc;
}

export interface WorkflowFilesSource {
  /** The turn's attachments, read when a flow is called; undefined while unresolved. */
  getTurnFiles: () => TarsTurnFiles | undefined;
  /** The requesting user, who owns every turn file. */
  userId: string | undefined;
  /** `tars.workflowFiles` from librechat.yaml; the schema defaults when unset. */
  config?: Partial<TTarsWorkflowFilesConfig>;
}

/** The turn's attachments a flow can read, the message being answered first, capped. */
export function selectWorkflowFiles(
  files: TarsTurnFiles | undefined,
  maxFiles: number,
): TarsDataFile[] {
  const readable = (files?.attachments ?? []).filter((file) => isWorkflowAttachment(file.filename));
  if (readable.length > maxFiles) {
    logger.warn(
      `[langflow/files] ${readable.length} attachments reach this turn; sending the first ${maxFiles} (tars.workflowFiles.maxFiles)`,
    );
  }
  return readable.slice(0, maxFiles);
}

/**
 * The tool arguments with the reserved files argument set to `refs`. Whatever the model put
 * there is dropped: only LibreChat names the files a flow may fetch.
 */
export function withWorkflowFiles(
  args: WorkflowToolInput,
  refs: readonly TarsDataFileRef[],
): WorkflowToolInput {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) {
    return args;
  }
  const { [TARS_WORKFLOW_FILES_ARGUMENT]: _ignored, ...rest } = args as Record<string, unknown>;
  return refs.length > 0 ? { ...rest, [TARS_WORKFLOW_FILES_ARGUMENT]: refs } : rest;
}

const isWorkflowTool = (tool: WorkflowToolCandidate): boolean =>
  tool.mcp === true &&
  tool.mcpRawServerName === TARS_WORKFLOW_MCP_SERVER_NAME &&
  typeof tool.func === 'function';

/**
 * Sends the turn's attachments with every Workflow tool call. The model's arguments are already
 * validated when `func` runs, so the reserved argument reaches Langflow without ever entering the
 * schema the model sees. Langflow downloads the files only for a flow that opted in.
 */
export function attachWorkflowFiles(
  tools: readonly WorkflowToolCandidate[],
  { getTurnFiles, userId, config }: WorkflowFilesSource,
): void {
  const { enabled, maxFiles } = { ...DEFAULTS, ...config };
  if (!enabled || !userId) {
    return;
  }
  for (const tool of tools) {
    if (!isWorkflowTool(tool)) {
      continue;
    }
    const call = tool.func as WorkflowToolFunc;
    tool.func = (input, runManager, runConfig) => {
      const files = selectWorkflowFiles(getTurnFiles(), maxFiles);
      const refs = files.length > 0 ? signTarsFileRefs(files, userId, 'workflow') : [];
      return call(withWorkflowFiles(input, refs), runManager, runConfig);
    };
  }
}
