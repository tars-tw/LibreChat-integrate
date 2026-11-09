import { logger } from '@librechat/data-schemas';
import { tarsConfigSchema } from 'librechat-data-provider';
import type { TTarsMcpDirectToolsStatus } from 'librechat-data-provider';
import { splitMCPToolKey } from '~/mcp/utils';

const DEFAULT_TIMEOUT_MS: number = tarsConfigSchema.parse({}).directToolCatalogTimeoutMs;

/** One tool in a user's MCP catalog, as `formatMCPServerTools` shapes it. */
export interface TarsDirectCatalogTool {
  serverToolName?: string;
  function?: { description?: string; parameters?: Record<string, unknown> };
}

/** Reads the tools of the given entries from the acting user's own connections. */
export type TarsDirectToolCatalog = (
  entryNames: string[],
  signal?: AbortSignal,
) => Promise<ReadonlyMap<string, Record<string, TarsDirectCatalogTool> | null | undefined>>;

export interface DirectCatalogTool {
  name: string;
  description: string | null;
  input_schema: Record<string, unknown> | null;
  tool_key: string;
}

/** One entry's catalog as plain tools, under the upstream name the switches are stored by. */
export function listDirectCatalogTools(
  gatewayName: string,
  catalog: Record<string, TarsDirectCatalogTool> | null | undefined,
): DirectCatalogTool[] {
  return Object.entries(catalog ?? {}).flatMap(([toolKey, tool]) => {
    const [parsedName, owner] = splitMCPToolKey(toolKey, [gatewayName]);
    if (owner !== gatewayName) {
      return [];
    }
    return [
      {
        name: tool.serverToolName ?? parsedName,
        description: tool.function?.description ?? null,
        input_schema: tool.function?.parameters ?? null,
        tool_key: toolKey,
      },
    ];
  });
}

class TarsDirectCatalogTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`OIDC MCP tool catalog timed out after ${timeoutMs}ms`);
    this.name = 'TarsDirectCatalogTimeoutError';
  }
}

export const directToolsFailureStatus = (error: unknown): TTarsMcpDirectToolsStatus =>
  error instanceof TarsDirectCatalogTimeoutError ? 'timeout' : 'error';

/**
 * The catalog comes from the user's live connection, so an unresponsive server must not hold up
 * the page asking for it: past the limit the read is aborted and rejects like any other failure.
 */
export async function loadDirectCatalogs(
  load: TarsDirectToolCatalog,
  entryNames: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): ReturnType<TarsDirectToolCatalog> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      /** Before the abort, or the read's own abort error would settle the race first. */
      reject(new TarsDirectCatalogTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([load(entryNames, controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** One entry's read: its catalog, or why it could not be had. */
export interface DirectCatalogOutcome {
  catalog?: Record<string, TarsDirectCatalogTool> | null;
  failure?: TTarsMcpDirectToolsStatus;
}

/** Each entry gets its own limit, so one unresponsive server cannot blank the others' lists. */
export async function readDirectCatalogs(
  load: TarsDirectToolCatalog,
  entryNames: string[],
  timeoutMs?: number,
): Promise<ReadonlyMap<string, DirectCatalogOutcome>> {
  const outcomes = await Promise.all(
    entryNames.map(async (name): Promise<[string, DirectCatalogOutcome]> => {
      try {
        const catalogs = await loadDirectCatalogs(load, [name], timeoutMs);
        return [name, { catalog: catalogs.get(name) }];
      } catch (error) {
        logger.warn(`[tars-mcp] Failed to read the tools of OIDC MCP server ${name}`, error);
        return [name, { failure: directToolsFailureStatus(error) }];
      }
    }),
  );
  return new Map(outcomes);
}
