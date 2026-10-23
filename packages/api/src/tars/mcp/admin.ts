import type {
  TTarsMcpPermission,
  TTarsMcpSystemVariable,
  TTarsMcpServerPermission,
  TTarsMcpPermissionPrincipal,
  TTarsMcpPermissionSaveResult,
  TTarsMcpPermissionSavePayload,
  TTarsMcpServerPermissionSaveResult,
  TTarsMcpServerPermissionSavePayload,
} from 'librechat-data-provider';
import { tarsMcpFetch } from './client';

/**
 * Admin-side proxy for managing pwc_tars MCP servers from LibreChat. pwc_tars
 * stays the source of truth — every call goes straight to its `/api/mcp` REST
 * API; nothing is persisted in LibreChat. Mutations sit behind pwc_tars's
 * `@admin_required`, so they take the acting admin's pwc_tars id (`asUser`)
 * and are sent with that admin's bearer.
 */

/** `McpServer.to_dict()` plus route-injected fields (admin listing/detail). */
export interface TarsMcpServerDetail {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  type: 'openapi' | 'custom_api' | 'external' | 'builtin';
  is_enabled: boolean;
  priority?: number | null;
  tags?: string[] | null;
  connection_config?: Record<string, unknown> | null;
  tool_config?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  tool_count?: number;
  requires_user_credentials?: boolean;
  tools?: TarsMcpToolDetail[];
}

/** `McpTool.to_dict()` row. */
export interface TarsMcpToolDetail {
  id: string;
  mcp_server_id: string;
  name: string;
  description?: string | null;
  input_schema?: Record<string, unknown> | null;
  is_enabled: boolean;
}

/** Create/update payload for a pwc_tars MCP server (openapi / custom_api / external). */
export interface TarsMcpServerInput {
  name: string;
  code?: string;
  description?: string;
  type: 'openapi' | 'custom_api' | 'external';
  is_enabled?: boolean;
  priority?: number;
  tags?: string[];
  connection_config: Record<string, unknown>;
  tool_config?: Record<string, unknown>;
  env_vars?: Record<string, string>;
}

/** Per-tool update payload (`PUT /api/mcp/tools/<id>`). */
export interface TarsMcpToolInput {
  description?: string;
  is_enabled?: boolean;
  input_schema?: Record<string, unknown>;
}

/** One `mcp_logs` audit row. */
export interface TarsMcpLogRow {
  id: string;
  sys_user_id: string;
  sys_domain_id?: number | null;
  conversation_id?: string | null;
  message_id?: string | null;
  mcp_server_id: string;
  tool_name: string;
  input_params?: Record<string, unknown> | null;
  output_result?: unknown;
  error_message?: string | null;
  status: string;
  duration_ms?: number | null;
  created_at?: string | null;
}

export interface TarsMcpSyncResult {
  synced?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  [key: string]: unknown;
}

export interface TarsMcpParsedSpec {
  api_info?: Record<string, unknown>;
  base_url?: string;
  tools?: Array<Record<string, unknown>>;
  tool_count?: number;
  login_hint?: Record<string, unknown> | null;
}

export async function adminListTarsMcpServers(): Promise<TarsMcpServerDetail[]> {
  const servers = await tarsMcpFetch<TarsMcpServerDetail[]>('/api/mcp/servers');
  return servers ?? [];
}

export async function adminGetTarsMcpServer(serverId: string): Promise<TarsMcpServerDetail | null> {
  const server = await tarsMcpFetch<TarsMcpServerDetail>(
    `/api/mcp/servers/${encodeURIComponent(serverId)}`,
  );
  return server ?? null;
}

export async function adminCreateTarsMcpServer(
  input: TarsMcpServerInput,
  asUser: string,
): Promise<TarsMcpServerDetail | undefined> {
  return tarsMcpFetch<TarsMcpServerDetail>('/api/mcp/servers', {
    method: 'POST',
    body: input,
    asUser,
  });
}

export async function adminUpdateTarsMcpServer(
  serverId: string,
  input: Partial<TarsMcpServerInput>,
  asUser: string,
): Promise<TarsMcpServerDetail | undefined> {
  return tarsMcpFetch<TarsMcpServerDetail>(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: 'PUT',
    body: input,
    asUser,
  });
}

export async function adminDeleteTarsMcpServer(serverId: string, asUser: string): Promise<void> {
  await tarsMcpFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: 'DELETE',
    asUser,
  });
}

/** Result of `POST /api/mcp/servers/batch-delete` — some ids may be skipped or not found. */
export interface TarsMcpBatchDeleteResult {
  deleted: string[];
  skipped: string[];
  not_found: string[];
  deleted_count: number;
  skipped_count: number;
  failed_count: number;
}

export async function adminBatchDeleteTarsMcpServers(
  ids: string[],
  asUser: string,
): Promise<TarsMcpBatchDeleteResult | undefined> {
  return tarsMcpFetch<TarsMcpBatchDeleteResult>('/api/mcp/servers/batch-delete', {
    method: 'POST',
    body: { ids },
    asUser,
  });
}

/** Type-specific connectivity + auth probe (parses spec / validates config / probes auth). */
export async function adminTestTarsMcpServer(
  serverId: string,
  asUser: string,
): Promise<Record<string, unknown> | undefined> {
  return tarsMcpFetch<Record<string, unknown>>(
    `/api/mcp/servers/${encodeURIComponent(serverId)}/test`,
    { method: 'POST', body: {}, timeoutMs: 60_000, asUser },
  );
}

/** Materializes the server's tool definitions into pwc_tars `mcp_tools` rows. */
export async function adminSyncTarsMcpServer(
  serverId: string,
  asUser: string,
): Promise<TarsMcpSyncResult | undefined> {
  return tarsMcpFetch<TarsMcpSyncResult>(`/api/mcp/servers/${encodeURIComponent(serverId)}/sync`, {
    method: 'POST',
    body: {},
    timeoutMs: 60_000,
    asUser,
  });
}

/** Parses an OpenAPI/Swagger spec (URL or file) and previews the generated tools. */
export async function adminParseTarsOpenapi(
  body: {
    openapi_url?: string;
    openapi_file?: string;
    base_url?: string;
    timeout?: number;
  },
  asUser: string,
): Promise<TarsMcpParsedSpec | undefined> {
  return tarsMcpFetch<TarsMcpParsedSpec>('/api/mcp/parse-openapi', {
    method: 'POST',
    body,
    timeoutMs: 60_000,
    asUser,
  });
}

/** Per-tool enable/disable or description/schema override. */
export async function adminUpdateTarsMcpTool(
  toolId: string,
  input: TarsMcpToolInput,
  asUser: string,
): Promise<TarsMcpToolDetail | undefined> {
  return tarsMcpFetch<TarsMcpToolDetail>(`/api/mcp/tools/${encodeURIComponent(toolId)}`, {
    method: 'PUT',
    body: input,
    asUser,
  });
}

export async function adminDeleteTarsMcpTool(toolId: string, asUser: string): Promise<void> {
  await tarsMcpFetch(`/api/mcp/tools/${encodeURIComponent(toolId)}`, {
    method: 'DELETE',
    asUser,
  });
}

/** Identifies one principal: exactly one of the two (pwc_tars rejects anything else with 400). */
export interface TarsMcpPermissionTarget {
  user_id?: string;
  user_group_id?: string;
}

/** Only string values reach pwc_tars — an Express query may also carry arrays or objects. */
function permissionTargetQuery(target: TarsMcpPermissionTarget): Record<string, string> {
  const query: Record<string, string> = {};
  if (typeof target.user_id === 'string' && target.user_id !== '') {
    query.user_id = target.user_id;
  }
  if (typeof target.user_group_id === 'string' && target.user_group_id !== '') {
    query.user_group_id = target.user_group_id;
  }
  return query;
}

/**
 * Users and groups holding `sys_mcp_permission` grants, disabled ones included
 * (shown as 已停用 and removable only). Every permission endpoint is
 * `@admin_required` on pwc_tars, reads included, so all of them carry `asUser`.
 */
export async function adminListTarsMcpPermissionPrincipals(
  asUser: string,
): Promise<TTarsMcpPermissionPrincipal[]> {
  const rows = await tarsMcpFetch<TTarsMcpPermissionPrincipal[]>('/api/mcp/permission/principals', {
    asUser,
  });
  return rows ?? [];
}

/** One user's or group's own grants (not what a user inherits from groups). */
export async function adminGetTarsMcpPermissions(
  target: TarsMcpPermissionTarget,
  asUser: string,
): Promise<TTarsMcpPermission[]> {
  const rows = await tarsMcpFetch<TTarsMcpPermission[]>('/api/mcp/permission', {
    query: permissionTargetQuery(target),
    asUser,
  });
  return rows ?? [];
}

/**
 * Overwrites the grants of every listed user and group (unchecked servers are
 * removed). pwc_tars validates the payload and refuses disabled principals.
 */
export async function adminSaveTarsMcpPermissions(
  payload: TTarsMcpPermissionSavePayload,
  asUser: string,
): Promise<TTarsMcpPermissionSaveResult | undefined> {
  return tarsMcpFetch<TTarsMcpPermissionSaveResult>('/api/mcp/permission/save', {
    method: 'POST',
    body: {
      user_ids: payload.user_ids,
      user_group_ids: payload.user_group_ids,
      servers: payload.servers,
    },
    asUser,
  });
}

/** Removes every grant of one user or group; returns how many rows went. */
export async function adminDeleteTarsMcpPermissions(
  target: TarsMcpPermissionTarget,
  asUser: string,
): Promise<number> {
  const result = await tarsMcpFetch<{ deleted?: number }>('/api/mcp/permission', {
    method: 'DELETE',
    query: permissionTargetQuery(target),
    asUser,
  });
  return result?.deleted ?? 0;
}

/** One server's assignees with their tool scope, disabled ones included (server-centric view). */
export async function adminGetTarsMcpServerPermissions(
  query: { mcp_server_id?: unknown },
  asUser: string,
): Promise<TTarsMcpServerPermission[]> {
  const serverId = query.mcp_server_id;
  const rows = await tarsMcpFetch<TTarsMcpServerPermission[]>('/api/mcp/permission/server', {
    query: typeof serverId === 'string' && serverId !== '' ? { mcp_server_id: serverId } : {},
    asUser,
  });
  return rows ?? [];
}

/**
 * Overwrites one server's assignees: listed principals are upserted, every other principal
 * loses this server, their other servers are untouched. pwc_tars validates the payload.
 */
export async function adminSaveTarsMcpServerPermissions(
  payload: TTarsMcpServerPermissionSavePayload,
  asUser: string,
): Promise<TTarsMcpServerPermissionSaveResult | undefined> {
  return tarsMcpFetch<TTarsMcpServerPermissionSaveResult>('/api/mcp/permission/server/save', {
    method: 'POST',
    body: { mcp_server_id: payload.mcp_server_id, principals: payload.principals },
    asUser,
  });
}

/**
 * The `{{TARS_*}}` variables a custom_api / openapi field's fixed value may bind, each with
 * the value it resolves to for `tarsUserId` (null when that user has none, e.g. no email).
 */
export async function adminListTarsMcpSystemVariables(
  tarsUserId: string,
): Promise<TTarsMcpSystemVariable[]> {
  const rows = await tarsMcpFetch<TTarsMcpSystemVariable[]>('/api/mcp/system-variables', {
    query: { user_id: tarsUserId },
  });
  return rows ?? [];
}

/** Recent `mcp_logs` audit rows (newest first; optional conversation filter). */
export async function adminGetTarsMcpLogs(params: {
  conversation_id?: string;
  limit?: number;
}): Promise<TarsMcpLogRow[]> {
  const rows = await tarsMcpFetch<TarsMcpLogRow[]>('/api/mcp/logs', {
    query: {
      ...(params.conversation_id ? { conversation_id: params.conversation_id } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  });
  return rows ?? [];
}
