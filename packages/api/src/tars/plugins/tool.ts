import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import { tarsPluginNameFromToolName } from 'librechat-data-provider';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { JsonSchemaType } from '@librechat/data-schemas';
import type { TTarsToolStep } from 'librechat-data-provider';
import type { TarsProgressReporter, TarsToolRunConfig } from '~/tars/tools/progress';
import type { TarsPluginManifest, TarsPluginRunResult } from './client';
import type { LangflowToolResult } from '~/tars/langflow/client';
import type { TarsMemoryDocument } from '~/tars/memory/client';
import type { TarsHistoryMessage } from './context';
import { getTarsPluginManifest, primeTarsPluginManifests, runTarsPluginTool } from './client';
import { langflowToolResult, LANGFLOW_TOOL_RESPONSE_FORMAT } from '~/tars/langflow/client';
import { normalizeJsonSchema, resolveJsonSchemaRefs } from '~/mcp/zod';
import { rewriteTarsAssetLinks } from '~/tars/assets';
import { buildTarsPluginFileInput } from './context';
import { TarsRequestError } from '~/tars/client';

/** Shape shared with the definition registry, kept local to avoid a runtime import cycle. */
export interface TarsPluginToolDefinition {
  name: string;
  description: string;
  schema: JsonSchemaType;
  toolType: 'builtin';
  responseFormat: typeof LANGFLOW_TOOL_RESPONSE_FORMAT;
}

const toParameters = (manifest: TarsPluginManifest): JsonSchemaType =>
  normalizeJsonSchema(resolveJsonSchemaRefs(manifest.input_schema));

/**
 * A primed plugin as a registry definition, so the definition-only (deferred)
 * load path can advertise it without building the tool instance. Undefined
 * for non-plugin names and for plugins pwc_tars has not loaded.
 */
export function getTarsPluginDefinition(toolName: string): TarsPluginToolDefinition | undefined {
  const pluginName = tarsPluginNameFromToolName(toolName);
  const manifest = pluginName ? getTarsPluginManifest(pluginName) : undefined;
  if (!manifest) {
    return undefined;
  }
  return {
    name: toolName,
    description: manifest.description,
    schema: toParameters(manifest),
    toolType: 'builtin',
    responseFormat: LANGFLOW_TOOL_RESPONSE_FORMAT,
  };
}

export interface TarsPluginToolOptions {
  /** The LibreChat tool name (`tars_plugin_<name>`). */
  toolName: string;
  /** pwc_tars user this tool runs as; absent for an unlinked LibreChat account. */
  tarsUserId?: string;
  /** Active 專用腦 the plugin was switched on for. */
  domainId?: string | number | null;
  /** Model the chat turn runs on; a plugin that needs a model inherits it. */
  model?: string;
  librechatUserId?: string;
  /** The user's current message, offered to the plugin as `ctx.question`. */
  question?: string;
  /**
   * The conversation's active memory files (snapshot): spreadsheets go out as
   * `ctx.settings.data_files`, the rest's parsed text as `ctx.settings.file_input`.
   */
  documents?: TarsMemoryDocument[];
  /** Reads the prior turns (`ctx.history`) when the plugin runs; see `loadTarsPluginHistory`. */
  loadHistory?: () => Promise<TarsHistoryMessage[]>;
  /** Relays the progress the tool reports to its card while it runs (host-bound). */
  reportProgress?: TarsProgressReporter;
}

const NOT_LINKED = 'This LibreChat account is not linked to pwc_tars, so plugin tools cannot run.';

type ArtifactUrl = { url?: string; title?: string } | string;

const toUrlLine = (item: ArtifactUrl): string | undefined => {
  if (typeof item === 'string') {
    return item ? `- ${item}` : undefined;
  }
  if (!item?.url) {
    return undefined;
  }
  return item.title ? `- [${item.title}](${item.url})` : `- ${item.url}`;
};

/**
 * Leads the output of a plugin that ends the turn. Its answer is already on
 * the card, verbatim; a model asked to relay it instead drops the rule trail
 * and has been seen to shift table cells, which is why pwc_tars never lets
 * the model touch it.
 */
const ENDS_TURN_NOTE =
  'The tool has already shown the user its complete answer, verbatim, right above your reply. ' +
  'Do not repeat, summarize or reformat it. Reply with at most two short sentences in the ' +
  "user's language (for example, point to the download link); the output below is for " +
  'follow-up questions only.';

/** A plugin's answer is shown on its card only when it ends the turn and succeeded. */
const presentsAnswer = (result: TarsPluginRunResult): boolean =>
  result.end_turn && !result.is_error && (result.final_text || result.content).trim() !== '';

/**
 * What the model sees. `final_text` is what pwc_tars would show the user when
 * a tool closes the turn by itself; LibreChat cannot end the turn from a tool,
 * so the card shows it (see {@link toTarsPluginStep}) and the model is told
 * not to retell it. The standard artifact keys every
 * pwc_tars host renders (`chart_url`, `file_url`, `urls`) are appended as
 * markdown so the model can pass them on. pwc_tars builds those links from its
 * sys_config `HOST`, so they go through LibreChat's relay like every other
 * generated file.
 */
export function formatTarsPluginResult(result: TarsPluginRunResult): string {
  const text = (result.final_text || result.content || '').trim();
  if (result.is_error) {
    return `The plugin tool reported an error: ${text || 'unknown error'}`;
  }
  const parts: string[] = [text || '(the tool returned no output)'];
  const { chart_url: chartUrl, file_url: fileUrl, urls } = result.artifacts;
  if (typeof chartUrl === 'string' && chartUrl && !text.includes(chartUrl)) {
    parts.push(`![chart](${chartUrl})`);
  }
  if (typeof fileUrl === 'string' && fileUrl && !text.includes(fileUrl)) {
    parts.push(`[Download](${fileUrl})`);
  }
  if (Array.isArray(urls)) {
    const lines = (urls as ArtifactUrl[]).map(toUrlLine).filter((line): line is string => !!line);
    if (lines.length > 0) {
      parts.push(`Sources:\n${lines.join('\n')}`);
    }
  }
  const body = rewriteTarsAssetLinks(parts.join('\n\n'));
  return presentsAnswer(result) ? `${ENDS_TURN_NOTE}\n\n${body}` : body;
}

const relayedLink = (type: string, url: unknown): { type: string; url: string }[] =>
  typeof url === 'string' && url ? [{ type, url: rewriteTarsAssetLinks(url) }] : [];

/** The card's view of one run: outcome, generated files, and an `ends_turn` answer. */
export function toTarsPluginStep(
  pluginName: string,
  manifest: Pick<TarsPluginManifest, 'display_name'>,
  result: TarsPluginRunResult,
): TTarsToolStep {
  const { chart_url: chartUrl, file_url: fileUrl } = result.artifacts;
  const links = [...relayedLink('chart', chartUrl), ...relayedLink('file', fileUrl)];
  return {
    tool: pluginName,
    ok: !result.is_error,
    title: manifest.display_name,
    ...(result.summary && { summary: result.summary }),
    ...(links.length > 0 && { links }),
    ...(presentsAnswer(result) && {
      answer: rewriteTarsAssetLinks((result.final_text || result.content).trim()),
    }),
  };
}

/** Paths pwc_tars reported for the attached spreadsheets; rows without one are skipped. */
const toDataFiles = (documents: TarsMemoryDocument[] | undefined): string[] =>
  (documents ?? []).flatMap((doc) => (doc.structured && doc.file_path ? [doc.file_path] : []));

/** History is context, not a precondition: a failed read runs the plugin without it. */
async function readHistory(
  loadHistory: TarsPluginToolOptions['loadHistory'],
): Promise<TarsHistoryMessage[] | undefined> {
  if (!loadHistory) {
    return undefined;
  }
  try {
    return await loadHistory();
  } catch (error) {
    logger.warn(
      '[tars-plugins] Could not read the conversation history; running without it',
      error,
    );
    return undefined;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * One pwc_tars plugin (`tars_tool_sdk`) as a native LibreChat tool. The
 * schema is the plugin's own pydantic input model, so the model fills exactly
 * the arguments the plugin author declared; pwc_tars runs it and LibreChat
 * relays the output back into the agent loop. Undefined when pwc_tars no
 * longer lists the plugin — the caller skips it rather than equipping a stub.
 */
export async function createTarsPluginTool(
  options: TarsPluginToolOptions,
): Promise<DynamicStructuredTool | undefined> {
  const pluginName = tarsPluginNameFromToolName(options.toolName);
  if (!pluginName) {
    return undefined;
  }
  const manifests = await primeTarsPluginManifests();
  const manifest = manifests.get(pluginName);
  if (!manifest) {
    logger.warn(`[tars-plugins] "${pluginName}" is not loaded by pwc_tars; not equipped`);
    return undefined;
  }
  const { tarsUserId } = options;
  const dataFiles = toDataFiles(options.documents);
  const fileInput = buildTarsPluginFileInput(options.documents);

  return tool(
    async (
      input: Record<string, unknown>,
      config?: TarsToolRunConfig,
    ): Promise<LangflowToolResult> => {
      if (!tarsUserId) {
        return langflowToolResult(NOT_LINKED);
      }
      try {
        const result = await runTarsPluginTool(pluginName, {
          inputs: input,
          question: options.question,
          tarsUserId,
          domainId: options.domainId,
          model: options.model,
          dataFiles,
          fileInput,
          history: await readHistory(options.loadHistory),
          librechatUserId: options.librechatUserId,
          onProgress: (message) => options.reportProgress?.(message, config),
          signal: config?.signal,
        });
        return langflowToolResult(formatTarsPluginResult(result), {
          trace: [],
          step: toTarsPluginStep(pluginName, manifest, result),
        });
      } catch (error) {
        return langflowToolResult(
          `The plugin tool "${manifest.display_name}" failed: ${toErrorMessage(error)}`,
        );
      }
    },
    {
      name: options.toolName,
      description: manifest.description,
      schema: toParameters(manifest),
      responseFormat: LANGFLOW_TOOL_RESPONSE_FORMAT,
    },
  ) as unknown as DynamicStructuredTool;
}
