import { logger } from '@librechat/data-schemas';
import { tarsFetch } from '~/tars/client';
import type { TarsQuery } from '~/tars/client';

/**
 * The pwc_tars MCP server types proxied through the LibreChat gateway. `external`
 * servers are real MCP servers (connect them to LibreChat directly) and `builtin`
 * tools are pwc_tars-internal, so both are excluded.
 */
const PROXIED_SERVER_TYPES = new Set(['openapi', 'custom_api']);

const TOOLS_CACHE_TTL_MS = 30_000;
const DEFAULT_EXECUTE_TIMEOUT_MS = 60_000;
const MAX_PREFIX_LENGTH = 24;
/**
 * Providers cap tools per request (OpenAI: 128 across ALL sources). The gateway
 * keeps headroom for LibreChat's other tools/servers; narrow the pwc_tars
 * domain whitelist (`mcp_tool_ids`) or the server's `tool_config` filters
 * rather than raising `TARS_MCP_MAX_TOOLS`.
 */
const DEFAULT_MAX_TOOLS = 100;

/** Uniform pwc_tars `/api/mcp` response envelope. */
interface TarsMcpEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

/**
 * One row of pwc_tars `GET /api/mcp/available-tools?user_id=` — already filtered
 * server- and tool-level by the user's domain grants (`sys_domain_mcp` incl.
 * `mcp_tool_ids` whitelists) and per-user settings (`sys_user_mcp`).
 */
export interface TarsAvailableToolRow {
  server_id: string;
  server_name: string;
  server_code?: string | null;
  server_type: string;
  tool_id: string;
  tool_name: string;
  description?: string | null;
  input_schema?: Record<string, unknown> | null;
}

/** One gateway tool: MCP-facing name plus the pwc_tars coordinates to execute it. */
export interface TarsMcpToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
  toolName: string;
}

export interface TarsMcpExecuteResult {
  result: unknown;
  durationMs?: number;
}

interface ToolsCacheEntry {
  entries: TarsMcpToolEntry[];
  byName: Map<string, TarsMcpToolEntry>;
  cachedAt: number;
}

const toolsCache = new Map<string, ToolsCacheEntry>();
const inflight = new Map<string, Promise<ToolsCacheEntry>>();

/** Drops all cached tool lists so the next listing re-reads pwc_tars. */
export function invalidateTarsMcpToolsCache(): void {
  toolsCache.clear();
  inflight.clear();
}

function executeTimeoutMs(): number {
  const raw = Number(process.env.TARS_MCP_EXECUTE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXECUTE_TIMEOUT_MS;
}

function maxTools(): number {
  const raw = Number(process.env.TARS_MCP_MAX_TOOLS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TOOLS;
}

/** pwc_tars `/api/mcp` fetch that unwraps the `{success, message, data}` envelope. */
export async function tarsMcpFetch<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    query?: TarsQuery;
    timeoutMs?: number;
  } = {},
): Promise<T | undefined> {
  const envelope = await tarsFetch<TarsMcpEnvelope<T>>(path, options);
  if (envelope?.success === false) {
    throw new Error(envelope.message || `pwc_tars request to ${path} was not successful`);
  }
  return envelope?.data;
}

function sanitizeNamePart(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Builds the MCP-facing tool name `<serverPrefix>__<toolName>` (the gateway
 * aggregates every pwc_tars server, so names must be unique across servers).
 * Collisions after sanitizing/truncation get a short server-id suffix.
 */
function buildToolName(row: TarsAvailableToolRow, taken: Set<string>): string | null {
  const prefix =
    sanitizeNamePart(row.server_code?.trim() || row.server_name).slice(0, MAX_PREFIX_LENGTH) ||
    'server';
  const candidate = `${prefix}__${sanitizeNamePart(row.tool_name)}`;
  if (!taken.has(candidate)) {
    return candidate;
  }
  const suffixed = `${candidate}_${sanitizeNamePart(row.server_id).slice(0, 8)}`;
  if (!taken.has(suffixed)) {
    return suffixed;
  }
  logger.warn(`[tars-mcp] Duplicate tool name after suffixing, skipping: ${suffixed}`);
  return null;
}

function toInputSchema(
  schema: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (schema && typeof schema === 'object' && Object.keys(schema).length > 0) {
    return schema;
  }
  return { type: 'object', properties: {} };
}

async function loadTools(tarsUserId: string): Promise<ToolsCacheEntry> {
  const rows = await tarsMcpFetch<TarsAvailableToolRow[]>('/api/mcp/available-tools', {
    query: { user_id: tarsUserId },
  });

  const byName = new Map<string, TarsMcpToolEntry>();
  const taken = new Set<string>();
  for (const row of rows ?? []) {
    if (!PROXIED_SERVER_TYPES.has(row.server_type)) {
      continue;
    }
    const name = buildToolName(row, taken);
    if (!name) {
      continue;
    }
    taken.add(name);
    byName.set(name, {
      name,
      description: row.description || '',
      inputSchema: toInputSchema(row.input_schema),
      serverId: row.server_id,
      serverName: row.server_name,
      toolName: row.tool_name,
    });
  }

  const limit = maxTools();
  if (byName.size > limit) {
    logger.warn(
      `[tars-mcp] pwc_tars exposes ${byName.size} tools for user ${tarsUserId}; ` +
        `truncating to ${limit}. Narrow the domain tool whitelist (mcp_tool_ids) or the ` +
        `OpenAPI server's tool_config filters in pwc_tars instead of relying on truncation.`,
    );
    let index = 0;
    for (const name of byName.keys()) {
      index += 1;
      if (index > limit) {
        byName.delete(name);
      }
    }
  }

  return { entries: [...byName.values()], byName, cachedAt: Date.now() };
}

async function getTools(tarsUserId: string, forceRefresh = false): Promise<ToolsCacheEntry> {
  const cached = toolsCache.get(tarsUserId);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < TOOLS_CACHE_TTL_MS) {
    return cached;
  }

  const pending = inflight.get(tarsUserId);
  if (pending) {
    return pending;
  }

  const load = loadTools(tarsUserId)
    .then((entry) => {
      toolsCache.set(tarsUserId, entry);
      return entry;
    })
    .finally(() => {
      inflight.delete(tarsUserId);
    });
  inflight.set(tarsUserId, load);
  return load;
}

/**
 * The OpenAPI / custom-API tools the pwc_tars user may access. pwc_tars applies
 * the full permission stack server-side (domain grants, `mcp_tool_ids` tool
 * whitelists, per-user enable/disable and tool overrides). Cached briefly so the
 * MCP handshake (initialize + tools/list) doesn't hammer pwc_tars.
 */
export async function listTarsMcpTools(tarsUserId: string): Promise<TarsMcpToolEntry[]> {
  return (await getTools(tarsUserId)).entries;
}

/** Resolves a gateway tool name back to its pwc_tars server/tool, refreshing the cache on a miss. */
export async function resolveTarsMcpTool(
  tarsUserId: string,
  name: string,
): Promise<TarsMcpToolEntry | null> {
  const cached = await getTools(tarsUserId);
  const entry = cached.byName.get(name);
  if (entry) {
    return entry;
  }
  const refreshed = await getTools(tarsUserId, true);
  return refreshed.byName.get(name) ?? null;
}

/**
 * Executes a gateway tool via pwc_tars `POST /api/mcp/execute`. `user_id` makes
 * pwc_tars re-check tool visibility, merge that user's stored credentials
 * (`sys_user_mcp.auth_credentials`) and attribute the `mcp_logs` audit row.
 * Failures surface as HTTP errors ({@link TarsRequestError} with the backend's
 * message), not as a `success: false` body — callers translate them into MCP
 * `isError` content.
 */
export async function executeTarsMcpTool(
  tarsUserId: string,
  name: string,
  toolArguments: Record<string, unknown> | undefined,
): Promise<TarsMcpExecuteResult> {
  const entry = await resolveTarsMcpTool(tarsUserId, name);
  if (!entry) {
    throw new Error(`Unknown TARS MCP tool: ${name}`);
  }
  const data = await tarsMcpFetch<{ result?: unknown; duration_ms?: number }>('/api/mcp/execute', {
    method: 'POST',
    body: {
      server_id: entry.serverId,
      tool_name: entry.toolName,
      arguments: toolArguments ?? {},
      user_id: tarsUserId,
    },
    timeoutMs: executeTimeoutMs(),
  });
  return { result: data?.result, durationMs: data?.duration_ms };
}
