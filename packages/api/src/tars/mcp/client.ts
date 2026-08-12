import { logger } from '@librechat/data-schemas';
import type { TarsQuery } from '~/tars/client';
import { tarsFetch } from '~/tars/client';

/**
 * The pwc_tars MCP server types proxied through the LibreChat gateway.
 * `external` servers (real MCP servers reached via stdio / streamable-http) are
 * executed by pwc_tars itself, so they proxy like the rest; only `builtin`
 * (pwc_tars-internal LangChain tools, unsupported by `/api/mcp/execute`) is
 * excluded.
 */
export const PROXIED_SERVER_TYPES: ReadonlySet<string> = new Set([
  'openapi',
  'custom_api',
  'external',
]);

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

/** Tool entries scoped to one lookup namespace (the aggregate gateway or a single server). */
interface ScopedTools {
  entries: TarsMcpToolEntry[];
  byName: Map<string, TarsMcpToolEntry>;
}

interface ToolsCacheEntry {
  aggregate: ScopedTools;
  byServer: Map<string, ScopedTools>;
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
 * Builds the aggregate-mode MCP tool name `<serverPrefix>__<toolName>` (the
 * legacy single-entry gateway aggregates every pwc_tars server, so names must
 * be unique across servers). Collisions after sanitizing/truncation get a short
 * server-id suffix.
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

/**
 * Per-server mode drops the `<serverPrefix>__` prefix — the server identity
 * lives in the `_mcp_tars_<code>` suffix LibreChat appends to the tool key.
 * pwc_tars tool names are unique per server, so a collision only arises from
 * sanitization; those get the short server-id suffix.
 */
export function buildScopedToolName(row: TarsAvailableToolRow, taken: Set<string>): string | null {
  const candidate = sanitizeNamePart(row.tool_name) || 'tool';
  if (!taken.has(candidate)) {
    return candidate;
  }
  const suffixed = `${candidate}_${sanitizeNamePart(row.server_id).slice(0, 8)}`;
  if (!taken.has(suffixed)) {
    return suffixed;
  }
  logger.warn(`[tars-mcp] Duplicate scoped tool name after suffixing, skipping: ${suffixed}`);
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

function toToolEntry(name: string, row: TarsAvailableToolRow): TarsMcpToolEntry {
  return {
    name,
    description: row.description || '',
    inputSchema: toInputSchema(row.input_schema),
    serverId: row.server_id,
    serverName: row.server_name,
    toolName: row.tool_name,
  };
}

function enforceToolLimit(byName: Map<string, TarsMcpToolEntry>, scope: string): void {
  const limit = maxTools();
  if (byName.size <= limit) {
    return;
  }
  logger.warn(
    `[tars-mcp] pwc_tars exposes ${byName.size} tools for ${scope}; ` +
      `truncating to ${limit}. Narrow the domain tool whitelist (mcp_tool_ids) or the ` +
      `server's tool_config filters in pwc_tars instead of relying on truncation.`,
  );
  let index = 0;
  for (const name of byName.keys()) {
    index += 1;
    if (index > limit) {
      byName.delete(name);
    }
  }
}

function toScopedTools(byName: Map<string, TarsMcpToolEntry>): ScopedTools {
  return { entries: [...byName.values()], byName };
}

async function loadTools(tarsUserId: string): Promise<ToolsCacheEntry> {
  const rows = await tarsMcpFetch<TarsAvailableToolRow[]>('/api/mcp/available-tools', {
    query: { user_id: tarsUserId },
  });

  const aggregateByName = new Map<string, TarsMcpToolEntry>();
  const aggregateTaken = new Set<string>();
  const serverMaps = new Map<string, Map<string, TarsMcpToolEntry>>();
  const serverTaken = new Map<string, Set<string>>();
  for (const row of rows ?? []) {
    if (!PROXIED_SERVER_TYPES.has(row.server_type)) {
      continue;
    }
    const aggregateName = buildToolName(row, aggregateTaken);
    if (aggregateName) {
      aggregateTaken.add(aggregateName);
      aggregateByName.set(aggregateName, toToolEntry(aggregateName, row));
    }

    let taken = serverTaken.get(row.server_id);
    if (!taken) {
      taken = new Set<string>();
      serverTaken.set(row.server_id, taken);
      serverMaps.set(row.server_id, new Map());
    }
    const scopedName = buildScopedToolName(row, taken);
    if (scopedName) {
      taken.add(scopedName);
      serverMaps.get(row.server_id)?.set(scopedName, toToolEntry(scopedName, row));
    }
  }

  enforceToolLimit(aggregateByName, `user ${tarsUserId}`);
  const byServer = new Map<string, ScopedTools>();
  for (const [serverId, byName] of serverMaps) {
    enforceToolLimit(byName, `user ${tarsUserId} server ${serverId}`);
    byServer.set(serverId, toScopedTools(byName));
  }

  return { aggregate: toScopedTools(aggregateByName), byServer, cachedAt: Date.now() };
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

function scopeOf(entry: ToolsCacheEntry, serverId?: string): ScopedTools {
  if (!serverId) {
    return entry.aggregate;
  }
  return entry.byServer.get(serverId) ?? { entries: [], byName: new Map() };
}

/**
 * The pwc_tars tools the user may access, scoped to one server when `serverId`
 * is given (per-server gateway entries) or aggregated across all servers
 * (legacy single-entry gateway). pwc_tars applies the full permission stack
 * server-side (domain grants, `mcp_tool_ids` tool whitelists, per-user
 * enable/disable and tool overrides). Cached briefly so the MCP handshake
 * (initialize + tools/list) doesn't hammer pwc_tars.
 */
export async function listTarsMcpTools(
  tarsUserId: string,
  serverId?: string,
): Promise<TarsMcpToolEntry[]> {
  return scopeOf(await getTools(tarsUserId), serverId).entries;
}

/** Resolves a gateway tool name back to its pwc_tars server/tool, refreshing the cache on a miss. */
export async function resolveTarsMcpTool(
  tarsUserId: string,
  name: string,
  serverId?: string,
): Promise<TarsMcpToolEntry | null> {
  const cached = await getTools(tarsUserId);
  const entry = scopeOf(cached, serverId).byName.get(name);
  if (entry) {
    return entry;
  }
  const refreshed = await getTools(tarsUserId, true);
  return scopeOf(refreshed, serverId).byName.get(name) ?? null;
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
  serverId?: string,
): Promise<TarsMcpExecuteResult> {
  const entry = await resolveTarsMcpTool(tarsUserId, name, serverId);
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
