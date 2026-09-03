import { tarsFetch } from './client';

/** A quota row's provider. `system` is the catch-all pwc_tars falls back to. */
export type TarsTokenProvider = string;

/** A quota rule (`TokenConfig.to_dict()`) plus the names pwc_tars joins in. */
export interface TarsTokenConfig {
  id: string;
  domain_id: string | null;
  user_group_id: string | null;
  provider: string | null;
  system_total_limit: number | null;
  default_user_limit: number | null;
  reset_type: string | null;
  reset_day: number | null;
  last_reset_at: string | null;
  warning_threshold: number | null;
  is_active: boolean;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  domain_name?: string;
  group_name?: string;
}

/** A per-person override (`TokenUserQuota.to_dict()`) plus the joined names. */
export interface TarsTokenUserQuota {
  id: string;
  domain_id: string | null;
  user_group_id: string | null;
  user_id: string | null;
  provider: string | null;
  custom_limit: number | null;
  used_amount: number | null;
  total_used_amount: number | null;
  reset_type: string | null;
  reset_day: number | null;
  last_reset_at: string | null;
  warning_threshold: number | null;
  status: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  domain_name?: string;
  group_name?: string;
  username?: string;
  display_name?: string;
  email?: string;
}

/** A user group with the specialized brains its roles grant it. */
export interface TarsTokenGroup {
  id: string;
  name: string;
  allowed_domains: string[];
}

export interface TarsTokenDomain {
  id: string;
  name: string;
}

export interface TarsTokenPrepareData {
  groups: TarsTokenGroup[];
  domains: TarsTokenDomain[];
}

/** A search hit from the personal-quota user picker. */
export interface TarsTokenUser {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  allowed_domains: string[];
  group_id: string | null;
}

export interface TarsTokenConfigFilters {
  domain_id?: string;
  user_group_id?: string;
  provider?: string;
  is_active?: boolean;
}

export interface TarsTokenQuotaFilters {
  domain_id?: string;
  user_group_id?: string;
  user_id?: string;
  provider?: string;
  status?: string;
}

export interface TarsTokenConfigInput {
  domain_id?: string | null;
  user_group_id?: string | null;
  provider?: string;
  system_total_limit?: number | null;
  default_user_limit?: number | null;
  reset_type?: string;
  reset_day?: number;
  warning_threshold?: number;
  is_active?: boolean;
}

export interface TarsTokenQuotaInput {
  user_id?: string;
  provider?: string;
  domain_id?: string | null;
  user_group_id?: string | null;
  custom_limit?: number | null;
  reset_type?: string;
  reset_day?: number;
  warning_threshold?: number;
  status?: string;
}

/** The system-wide default for one provider — a config row with no domain and no group. */
export interface TarsTokenSystemDefaultInput {
  provider: string;
  system_total_limit?: number | null;
  default_user_limit?: number | null;
  reset_type?: string;
  reset_day?: number;
  warning_threshold?: number;
}

/** The pwc_tars actor stamped onto `created_by` / `updated_by`. */
export interface TarsTokenActor {
  tarsId: string;
}

interface TarsEnvelope<T> {
  success?: boolean;
  data: T;
  total?: number;
}

interface TarsMutationEnvelope<T> {
  message?: string;
  data?: T;
}

const TOKEN_BASE = '/api/token';

export async function fetchTarsTokenPrepareData(baseUrl?: string): Promise<TarsTokenPrepareData> {
  const response = await tarsFetch<TarsEnvelope<TarsTokenPrepareData>>(
    `${TOKEN_BASE}/prepare_data`,
    { baseUrl },
  );
  return response.data ?? { groups: [], domains: [] };
}

/** pwc_tars caps this at 20 rows and returns its first 20 users for an empty term. */
export async function searchTarsTokenUsers(
  keyword: string,
  baseUrl?: string,
): Promise<TarsTokenUser[]> {
  const response = await tarsFetch<TarsEnvelope<TarsTokenUser[]>>(`${TOKEN_BASE}/search_users`, {
    query: { q: keyword },
    baseUrl,
  });
  return response.data ?? [];
}

export async function fetchTarsTokenConfigs(
  filters: TarsTokenConfigFilters = {},
  baseUrl?: string,
): Promise<TarsTokenConfig[]> {
  const response = await tarsFetch<TarsEnvelope<TarsTokenConfig[]>>(
    `${TOKEN_BASE}/get_token_configs`,
    { query: { ...filters }, baseUrl },
  );
  return response.data ?? [];
}

export async function createTarsTokenConfig(
  actor: TarsTokenActor,
  input: TarsTokenConfigInput,
  baseUrl?: string,
): Promise<TarsTokenConfig | undefined> {
  const response = await tarsFetch<TarsMutationEnvelope<TarsTokenConfig>>(
    `${TOKEN_BASE}/create_token_config`,
    { method: 'POST', body: { ...input, created_by: actor.tarsId }, baseUrl },
  );
  return response.data;
}

export async function updateTarsTokenConfig(
  actor: TarsTokenActor,
  configId: string,
  input: TarsTokenConfigInput,
  baseUrl?: string,
): Promise<TarsTokenConfig | undefined> {
  const response = await tarsFetch<TarsMutationEnvelope<TarsTokenConfig>>(
    `${TOKEN_BASE}/update_token_config/${encodeURIComponent(configId)}`,
    { method: 'PUT', body: { ...input, updated_by: actor.tarsId }, baseUrl },
  );
  return response.data;
}

export async function deleteTarsTokenConfig(configId: string, baseUrl?: string): Promise<void> {
  await tarsFetch(`${TOKEN_BASE}/delete_token_config/${encodeURIComponent(configId)}`, {
    method: 'DELETE',
    baseUrl,
  });
}

export async function fetchTarsTokenUserQuotas(
  filters: TarsTokenQuotaFilters = {},
  baseUrl?: string,
): Promise<TarsTokenUserQuota[]> {
  const response = await tarsFetch<TarsEnvelope<TarsTokenUserQuota[]>>(
    `${TOKEN_BASE}/get_user_quotas`,
    { query: { ...filters }, baseUrl },
  );
  return response.data ?? [];
}

export async function createTarsTokenUserQuota(
  actor: TarsTokenActor,
  input: TarsTokenQuotaInput,
  baseUrl?: string,
): Promise<TarsTokenUserQuota | undefined> {
  const response = await tarsFetch<TarsMutationEnvelope<TarsTokenUserQuota>>(
    `${TOKEN_BASE}/create_user_quota`,
    { method: 'POST', body: { ...input, created_by: actor.tarsId }, baseUrl },
  );
  return response.data;
}

export async function updateTarsTokenUserQuota(
  actor: TarsTokenActor,
  quotaId: string,
  input: TarsTokenQuotaInput,
  baseUrl?: string,
): Promise<TarsTokenUserQuota | undefined> {
  const response = await tarsFetch<TarsMutationEnvelope<TarsTokenUserQuota>>(
    `${TOKEN_BASE}/update_user_quota/${encodeURIComponent(quotaId)}`,
    { method: 'PUT', body: { ...input, updated_by: actor.tarsId }, baseUrl },
  );
  return response.data;
}

export async function deleteTarsTokenUserQuota(quotaId: string, baseUrl?: string): Promise<void> {
  await tarsFetch(`${TOKEN_BASE}/delete_user_quota/${encodeURIComponent(quotaId)}`, {
    method: 'DELETE',
    baseUrl,
  });
}

export async function fetchTarsTokenSystemDefaults(baseUrl?: string): Promise<TarsTokenConfig[]> {
  const response = await tarsFetch<TarsEnvelope<TarsTokenConfig[]>>(
    `${TOKEN_BASE}/get_system_defaults`,
    { baseUrl },
  );
  return response.data ?? [];
}

/** Upserts by provider: pwc_tars creates the row when no system default exists yet. */
export async function updateTarsTokenSystemDefault(
  actor: TarsTokenActor,
  input: TarsTokenSystemDefaultInput,
  baseUrl?: string,
): Promise<TarsTokenConfig | undefined> {
  const response = await tarsFetch<TarsMutationEnvelope<TarsTokenConfig>>(
    `${TOKEN_BASE}/update_system_default`,
    { method: 'PUT', body: { ...input, updated_by: actor.tarsId }, baseUrl },
  );
  return response.data;
}
