import { tarsFetch } from './client';

/**
 * A pwc_tars SSO configuration row (`SysSSOConfig.to_dict()`). One table holds
 * every provider, so the LDAP / OIDC / SAML field groups are all optional and
 * only the group matching `sso_type_id` is populated.
 */
export interface TarsSsoConfig {
  id: string;
  sso_type_id: string;
  sso_type_name: string;
  status: number;
  ldap_name?: string | null;
  ldap_server_address?: string | null;
  ldap_server_port?: string | null;
  ldap_base_dn?: string | null;
  ldap_search_attribute?: string | null;
  ldap_admin_dn?: string | null;
  ldap_admin_password?: string | null;
  ldap_whitelist_users?: string | null;
  ldap_whitelist_groups?: string | null;
  ldap_enable_whitelist?: boolean;
  frequency?: number | null;
  frequency_unit?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  last_execute_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** pwc_tars `sso_type_id` 1 is LDAP — the only provider LibreChat administers. */
export const TARS_SSO_TYPE_LDAP = '1';

/** Every pwc_tars endpoint under `settings/sso` answers in this envelope. */
interface TarsSsoEnvelope<T> {
  success?: boolean;
  data?: T;
}

const unwrap = <T>(response: TarsSsoEnvelope<T> | null | undefined, fallback: T): T =>
  response?.data ?? fallback;

/**
 * The stored LDAP configurations. pwc_tars supports several, and LibreChat
 * lists them all rather than hiding the extras behind a picker.
 *
 * `user_id` is not a filter — pwc_tars returns every configuration for the SSO
 * type — but the route rejects a blank one with a 500, so a real id is required.
 */
export async function fetchTarsSsoConfigs(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsSsoConfig[]> {
  const response = await tarsFetch<TarsSsoEnvelope<TarsSsoConfig[] | TarsSsoConfig>>(
    '/api/settings/get_sso_settings',
    { query: { user_id: tarsId, sso_type_id: TARS_SSO_TYPE_LDAP }, baseUrl },
  );
  const data = response?.data;
  if (Array.isArray(data)) {
    return data;
  }
  return data ? [data] : [];
}

/** Create/update payload for an LDAP configuration. */
export interface TarsLdapConfigInput {
  ldap_name?: string;
  ldap_server_address?: string;
  ldap_server_port?: string;
  ldap_base_dn?: string;
  ldap_search_attribute?: string;
  ldap_admin_dn?: string;
  ldap_admin_password?: string;
  ldap_whitelist_users?: string;
  ldap_enable_whitelist?: boolean;
  status?: number;
}

/**
 * Creates an LDAP configuration, or replaces one when `configId` is given.
 * pwc_tars backfills any field the payload omits from the stored row, so a
 * partial edit never blanks the rest of the configuration.
 */
export async function saveTarsSsoConfig(
  tarsId: string,
  input: TarsLdapConfigInput,
  configId?: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/settings/save_sso_settings', {
    method: 'POST',
    body: {
      user_id: tarsId,
      sso_type_id: TARS_SSO_TYPE_LDAP,
      status: input.status ?? 1,
      ...(configId ? { config_id: configId } : {}),
      ...input,
    },
    baseUrl,
  });
}

/** Partial update of an existing configuration (`POST /update_sso_config`). */
export async function updateTarsSsoConfig(
  tarsId: string,
  configId: string,
  input: TarsLdapConfigInput,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/settings/update_sso_config', {
    method: 'POST',
    body: { config_id: configId, user_id: tarsId, ...input },
    baseUrl,
  });
}

export async function deleteTarsSsoConfig(configId: string, baseUrl?: string): Promise<void> {
  await tarsFetch('/api/settings/delete_sso_config', {
    method: 'DELETE',
    body: { config_id: configId },
    baseUrl,
  });
}

/**
 * Tests an LDAP bind. With a `configId` pwc_tars reads the stored credentials;
 * without one it uses the draft values, which is how the create form can verify
 * a server before anything is saved.
 */
export async function testTarsLdapConnection(
  payload: { config_id?: string } & TarsLdapConfigInput,
  baseUrl?: string,
): Promise<string> {
  const response = await tarsFetch<TarsSsoEnvelope<{ message?: string }>>(
    '/api/settings/test_ldap_connection',
    { method: 'POST', body: payload, baseUrl },
  );
  return unwrap(response, {}).message ?? 'LDAP connection successful';
}

/** A node of the pwc_tars LDAP directory tree. */
export interface TarsLdapTreeNode {
  key: string;
  label: string;
  type?: string | null;
  children?: TarsLdapTreeNode[];
}

export async function fetchTarsLdapTree(
  payload: { config_id?: string } & TarsLdapConfigInput,
  baseUrl?: string,
): Promise<TarsLdapTreeNode[]> {
  const response = await tarsFetch<
    TarsSsoEnvelope<TarsLdapTreeNode[] | { tree?: TarsLdapTreeNode[] }>
  >('/api/settings/get_ldap_tree', { method: 'POST', body: payload, baseUrl, timeoutMs: 60000 });
  const data = response?.data;
  if (Array.isArray(data)) {
    return data;
  }
  return data?.tree ?? [];
}

/** A whitelist entry resolved against the directory. */
export interface TarsWhitelistUser {
  username: string;
  ou?: string | null;
  display_name?: string | null;
  email?: string | null;
}

/**
 * Resolves the `;`-separated whitelist into directory records. pwc_tars needs
 * the connection parameters in the body, so the caller passes the configuration
 * it is showing rather than an id.
 */
export async function fetchTarsWhitelistUsersDetail(
  payload: { whitelist_users: string } & TarsLdapConfigInput,
  baseUrl?: string,
): Promise<TarsWhitelistUser[]> {
  const response = await tarsFetch<TarsSsoEnvelope<{ users?: TarsWhitelistUser[] }>>(
    '/api/settings/get_whitelist_users_detail',
    { method: 'POST', body: payload, baseUrl, timeoutMs: 60000 },
  );
  return unwrap(response, {}).users ?? [];
}

/** Runs a full directory sync, provisioning pwc_tars accounts from AD. */
export async function importTarsAdData(
  configId: string,
  enableUsers: boolean,
  baseUrl?: string,
): Promise<string> {
  const response = await tarsFetch<TarsSsoEnvelope<{ message?: string }>>(
    '/api/settings/import_ad_data',
    {
      method: 'POST',
      body: { config_id: configId, enable_users: enableUsers },
      baseUrl,
      timeoutMs: 120000,
    },
  );
  return unwrap(response, {}).message ?? '';
}

/** Removes every account and group this configuration synced from AD. */
export async function deleteTarsAdData(configId: string, baseUrl?: string): Promise<string> {
  const response = await tarsFetch<TarsSsoEnvelope<{ message?: string }>>(
    '/api/settings/delete_ad_user',
    { method: 'DELETE', body: { config_id: configId }, baseUrl, timeoutMs: 60000 },
  );
  return unwrap(response, {}).message ?? '';
}

export interface TarsSyncSchedule {
  frequency: number;
  frequency_unit: string;
  start_time: string | null;
  end_time: string | null;
  last_execute_at?: string | null;
}

export async function fetchTarsSyncSchedule(
  configId: string,
  baseUrl?: string,
): Promise<TarsSyncSchedule | null> {
  const response = await tarsFetch<TarsSsoEnvelope<TarsSyncSchedule>>(
    '/api/settings/get_sync_schedule',
    { query: { config_id: configId }, baseUrl },
  );
  return response?.data ?? null;
}

/** pwc_tars parses the window with `%Y-%m-%dT%H:%M`, so times stay unzoned. */
export async function saveTarsSyncSchedule(
  configId: string,
  schedule: { frequency: number; frequency_unit: string; start_time?: string; end_time?: string },
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/settings/save_sync_schedule', {
    method: 'POST',
    body: { config_id: configId, ...schedule },
    baseUrl,
  });
}

export async function deleteTarsSyncSchedule(configId: string, baseUrl?: string): Promise<void> {
  await tarsFetch('/api/settings/delete_sync_schedule', {
    method: 'DELETE',
    body: { config_id: configId },
    baseUrl,
  });
}
