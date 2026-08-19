import type { TarsDomain, TarsRole } from './domains';
import { tarsFetch } from './client';

/**
 * A pwc_tars role as the permission admin page sees it. `domain_ids` / `menu_ids`
 * are comma-separated id strings; `status` is numeric 1/0 like the group table.
 * `librechat_menu_keys` is the LibreChat-side menu permission set — comma
 * separated stable keys, `null` meaning "not configured" (every menu visible).
 */
export interface TarsRoleDetail extends TarsRole {
  description: string | null;
  domain_ids: string | null;
  menu_ids: string | null;
  librechat_menu_keys: string | null;
  status: number;
  is_default_role: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TarsRolePrepareData {
  roles: TarsRoleDetail[];
  domains: TarsDomain[];
}

/** Create/update payload for a role. */
export interface TarsRoleInput {
  name: string;
  description?: string;
  domainIds?: string;
  librechatMenuKeys?: string;
  isEnabled?: boolean;
  isDefaultRole?: boolean;
}

interface PrepareDataResponse {
  sys_roles?: TarsRoleDetail[];
  sys_domains?: TarsDomain[];
}

/**
 * Roles and specialized brains in one call
 * (`GET /api/role_settings/prepare_data`). The response also carries the legacy
 * pwc_tars `sys_menus` tree, which LibreChat does not use — its own menu
 * permissions live in `librechat_menu_keys`.
 */
export async function fetchTarsRolePrepareData(baseUrl?: string): Promise<TarsRolePrepareData> {
  const data = await tarsFetch<PrepareDataResponse>('/api/role_settings/prepare_data', { baseUrl });
  return {
    roles: data?.sys_roles ?? [],
    domains: data?.sys_domains ?? [],
  };
}

/**
 * pwc_tars only overwrites `librechat_menu_keys` when the key is present in the
 * body, so an empty selection must be sent as `''` (grant nothing) rather than
 * being omitted, which would silently keep the previous set.
 */
const toRoleBody = (input: TarsRoleInput): Record<string, unknown> => ({
  name: input.name,
  description: input.description ?? '',
  domain_ids: input.domainIds ?? '',
  librechat_menu_keys: input.librechatMenuKeys ?? '',
  is_enabled: input.isEnabled ?? true,
  is_default_role: input.isDefaultRole ?? false,
});

export async function createTarsRole(
  tarsId: string,
  input: TarsRoleInput,
  baseUrl?: string,
): Promise<TarsRoleDetail> {
  const data = await tarsFetch<{ role: TarsRoleDetail }>('/api/role_settings/create_role', {
    method: 'POST',
    body: { ...toRoleBody(input), created_by: tarsId },
    baseUrl,
  });
  return data.role;
}

/**
 * Updates a role. Marking it the default role makes pwc_tars clear the flag on
 * every other role, so callers must refresh the whole listing afterwards.
 */
export async function updateTarsRole(
  tarsId: string,
  roleId: number | string,
  input: TarsRoleInput,
  baseUrl?: string,
): Promise<TarsRoleDetail> {
  const data = await tarsFetch<{ role: TarsRoleDetail }>(
    `/api/role_settings/update_role/${encodeURIComponent(String(roleId))}`,
    {
      method: 'PUT',
      body: { ...toRoleBody(input), updated_by: tarsId },
      baseUrl,
    },
  );
  return data.role;
}

export async function deleteTarsRole(
  tarsId: string,
  roleId: number | string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/role_settings/delete_role/${encodeURIComponent(String(roleId))}`, {
    method: 'DELETE',
    query: { operator_id: tarsId },
    baseUrl,
  });
}
