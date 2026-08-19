import type { TarsRole } from './domains';
import { tarsFetch, getTarsBaseUrl } from './client';

/**
 * A pwc_tars account row. Mirrors `SysUser.to_dict()` plus the two fields
 * `GET /user_settings/get_users` computes on the fly: `is_online` (last active
 * within the online threshold) and `roles_names` (the union of the user's own
 * role and every role granted by their groups, comma separated).
 */
export interface TarsAccount {
  id: string;
  username: string;
  email: string | null;
  role_id: number | null;
  user_group_id: string | null;
  display_name: string | null;
  avatar?: string | null;
  interface_language?: string | null;
  interface_theme?: string | null;
  timezone?: string | null;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  status: string;
  initialized_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_active_at?: string | null;
  is_sso_user?: boolean;
  is_syncbyad?: boolean;
  sso_config_id?: string | null;
  is_online?: boolean;
  roles_names?: string | null;
}

/** A pwc_tars user group (`SysUserGroup.to_dict()`). */
export interface TarsUserGroup {
  id: string;
  name: string;
  description?: string | null;
  role_id?: string | null;
  status?: number | boolean | null;
  is_syncbyad?: boolean;
  sso_config_id?: string | null;
}

/** Create payload for a pwc_tars account. `email`/`password` are omitted for AD users. */
export interface TarsUserInput {
  username: string;
  email?: string;
  password?: string;
  display_name?: string;
  role_id?: string | number | null;
  user_group_id?: string | null;
  status?: string;
  is_sso_user?: boolean;
}

/** Partial update payload — pwc_tars only touches the keys that are present. */
export interface TarsUserUpdate {
  email?: string;
  display_name?: string;
  role_id?: string | number | null;
  user_group_id?: string | null;
  status?: string;
}

/** The subset of fields `PUT /user_settings/bulk_update_users` accepts. */
export interface TarsBulkUserUpdate {
  role_id?: string | number | null;
  user_group_id?: string | null;
  status?: string;
}

/** Everything the user admin page needs before it can render its editors. */
export interface TarsUserPrepareData {
  roles: TarsRole[];
  userGroups: TarsUserGroup[];
  sso: { enabled: boolean; type: string | null };
}

interface UsersResponse {
  users?: TarsAccount[];
}

/** All pwc_tars accounts with their online state and resolved role names. */
export async function fetchTarsUsers(baseUrl?: string): Promise<TarsAccount[]> {
  const data = await tarsFetch<UsersResponse>('/api/user_settings/get_users', { baseUrl });
  return data?.users ?? [];
}

/** All pwc_tars roles (`GET /role_settings/get_roles`). */
export async function fetchTarsRoles(baseUrl?: string): Promise<TarsRole[]> {
  const data = await tarsFetch<{ roles?: TarsRole[] }>('/api/role_settings/get_roles', { baseUrl });
  return data?.roles ?? [];
}

/**
 * The enabled pwc_tars user groups. The endpoint is a POST filter search; the
 * user admin page only ever wants `status: 1` like the pwc_tars page does.
 */
export async function fetchTarsUserGroups(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsUserGroup[]> {
  const data = await tarsFetch<{ data?: TarsUserGroup[] }>(
    '/api/user_settings/get_user_group_by_filter',
    {
      method: 'POST',
      body: { user_id: tarsId, filter: { status: 1 } },
      baseUrl,
    },
  );
  return data?.data ?? [];
}

/** Whether pwc_tars has SSO enabled and which provider (`1`/LDAP, `2`/OIDC). */
export async function fetchTarsSsoStatus(
  baseUrl?: string,
): Promise<{ enabled: boolean; type: string | null }> {
  const data = await tarsFetch<{ enabled?: boolean; type?: string | null }>(
    '/api/auth/sso/status',
    { baseUrl },
  );
  return { enabled: !!data?.enabled, type: data?.type ?? null };
}

/**
 * Roles, groups and SSO status in one call so the admin page opens with a
 * single request. Each source degrades to an empty/disabled default instead of
 * failing the whole page.
 */
export async function fetchTarsUserPrepareData(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsUserPrepareData> {
  const [roles, userGroups, sso] = await Promise.all([
    fetchTarsRoles(baseUrl).catch(() => [] as TarsRole[]),
    fetchTarsUserGroups(tarsId, baseUrl).catch(() => [] as TarsUserGroup[]),
    fetchTarsSsoStatus(baseUrl).catch(() => ({ enabled: false, type: null })),
  ]);
  return { roles, userGroups, sso };
}

export async function createTarsUser(
  tarsId: string,
  input: TarsUserInput,
  baseUrl?: string,
): Promise<TarsAccount> {
  const data = await tarsFetch<{ user: TarsAccount }>('/api/user_settings/create_user', {
    method: 'POST',
    body: { ...input, created_by: tarsId },
    baseUrl,
  });
  return data.user;
}

export async function updateTarsUser(
  tarsId: string,
  userId: string,
  input: TarsUserUpdate,
  baseUrl?: string,
): Promise<TarsAccount> {
  const data = await tarsFetch<{ user: TarsAccount }>(
    `/api/user_settings/update_user/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      body: { ...input, updated_by: tarsId },
      baseUrl,
    },
  );
  return data.user;
}

export async function deleteTarsUser(
  tarsId: string,
  userId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/user_settings/delete_user/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    body: { deleted_by: tarsId },
    baseUrl,
  });
}

/** Applies the same field changes to many accounts at once. */
export async function bulkUpdateTarsUsers(
  tarsId: string,
  ids: string[],
  updates: TarsBulkUserUpdate,
  baseUrl?: string,
): Promise<TarsAccount[]> {
  const data = await tarsFetch<UsersResponse>('/api/user_settings/bulk_update_users', {
    method: 'PUT',
    body: { ids, updates, updated_by: tarsId },
    baseUrl,
  });
  return data?.users ?? [];
}

/** pwc_tars refuses to delete the operator's own account and returns a 400. */
export async function bulkDeleteTarsUsers(
  tarsId: string,
  ids: string[],
  baseUrl?: string,
): Promise<number> {
  const data = await tarsFetch<{ deleted_count?: number }>('/api/user_settings/bulk_delete_users', {
    method: 'POST',
    body: { ids, deleted_by: tarsId },
    baseUrl,
  });
  return data?.deleted_count ?? ids.length;
}

export async function resetTarsUserPassword(
  userId: string,
  newPassword: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/auth/reset_password', {
    method: 'POST',
    body: { user_id: userId, new_password: newPassword },
    baseUrl,
  });
}

/**
 * The LDAP whitelist configured on the pwc_tars SSO settings (`sso_type_id: 1`),
 * split from its `;`-separated string. Empty when SSO is unconfigured. Names
 * already provisioned as SSO accounts are excluded so the create form only
 * offers people who can still be added — pwc_tars matches an existing account
 * by username or by the local part of its email, case-insensitively.
 */
export async function fetchTarsAdWhitelist(tarsId: string, baseUrl?: string): Promise<string[]> {
  const data = await tarsFetch<{ data?: Array<Record<string, unknown>> | Record<string, unknown> }>(
    '/api/settings/get_sso_settings',
    { query: { user_id: tarsId, sso_type_id: 1 }, baseUrl },
  );
  const raw = data?.data;
  const configs = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw) && raw) {
    configs.push(raw);
  }
  const config = configs.find(
    (item) =>
      (item?.sso_type_id === 1 || item?.sso_type_id === '1') &&
      typeof item?.ldap_whitelist_users === 'string',
  );
  if (!config) {
    return [];
  }
  const whitelist = (config.ldap_whitelist_users as string)
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);
  if (whitelist.length === 0) {
    return whitelist;
  }

  const users = await fetchTarsUsers(baseUrl).catch(() => [] as TarsAccount[]);
  const taken = new Set<string>();
  for (const user of users) {
    if (!user.is_sso_user) {
      continue;
    }
    taken.add(user.username.toLowerCase());
    const localPart = (user.email ?? '').split('@')[0];
    if (localPart) {
      taken.add(localPart.toLowerCase());
    }
  }
  return whitelist.filter((name) => !taken.has(name.toLowerCase()));
}

/** The pwc_tars bulk-import template (`.xlsx`), streamed back to the browser. */
export async function downloadTarsUserImportTemplate(
  tarsId: string,
  baseUrl?: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const url = `${getTarsBaseUrl(baseUrl)}/api/user_settings/download_template?operator_id=${encodeURIComponent(tarsId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`pwc_tars template download returned status ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType:
      response.headers.get('content-type') ??
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/**
 * Forwards a filled-in template to pwc_tars, which owns the row validation.
 * A rejected import comes back as a non-2xx JSON body carrying `error` and a
 * per-row `details` array, both surfaced to the caller unchanged.
 */
export async function bulkImportTarsUsers(
  file: { buffer: Buffer; filename: string; mimetype: string },
  baseUrl?: string,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const url = `${getTarsBaseUrl(baseUrl)}/api/user_settings/bulk_import`;
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.filename,
  );

  const response = await fetch(url, { method: 'POST', body: form });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  return { ok: response.ok, status: response.status, body };
}
