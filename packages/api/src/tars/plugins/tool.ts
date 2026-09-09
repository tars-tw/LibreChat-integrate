import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import { tarsPluginNameFromToolName } from 'librechat-data-provider';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { JsonSchemaType } from '@librechat/data-schemas';
import type { TarsPluginManifest, TarsPluginRunResult } from './client';
import { getTarsPluginManifest, primeTarsPluginManifests, runTarsPluginTool } from './client';
import { normalizeJsonSchema, resolveJsonSchemaRefs } from '~/mcp/zod';
import { TarsRequestError } from '~/tars/client';

/** Shape shared with the definition registry, kept local to avoid a runtime import cycle. */
export interface TarsPluginToolDefinition {
  name: string;
  description: string;
  schema: JsonSchemaType;
  toolType: 'builtin';
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
 * What the model sees. `final_text` is what pwc_tars would show the user when
 * a tool closes the turn by itself; LibreChat cannot end the turn from a tool,
 * so it is relayed as the answer instead. The standard artifact keys every
 * pwc_tars host renders (`chart_url`, `file_url`, `urls`) are appended as
 * markdown so the model can pass them on.
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
  return parts.join('\n\n');
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

  return tool(
    async (input: Record<string, unknown>): Promise<string> => {
      if (!tarsUserId) {
        return NOT_LINKED;
      }
      try {
        const result = await runTarsPluginTool(pluginName, {
          inputs: input,
          question: options.question,
          tarsUserId,
          domainId: options.domainId,
          model: options.model,
          librechatUserId: options.librechatUserId,
        });
        return formatTarsPluginResult(result);
      } catch (error) {
        return `The plugin tool "${manifest.display_name}" failed: ${toErrorMessage(error)}`;
      }
    },
    {
      name: options.toolName,
      description: manifest.description,
      schema: toParameters(manifest),
    },
  ) as unknown as DynamicStructuredTool;
}
