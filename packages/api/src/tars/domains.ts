import type { TarsKnowledgeBase } from './knowledge';
import { tarsFetch } from './client';

/**
 * A pwc_tars specialized brain ("專用腦"). Mirrors `SysDomain.to_dict()`.
 * `role_ids` / `knowledge_base_ids` are comma-separated id strings and
 * `domain_functions` is a JSON string of capability toggles, both stored
 * verbatim as pwc_tars returns them.
 */
export interface TarsDomain {
  id: number;
  name: string;
  description: string | null;
  role_ids: string | null;
  knowledge_base_ids: string | null;
  domain_functions: string | null;
  prompt_instruction: string | null;
  iframe_url: string | null;
  status: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  url?: string;
}

interface DomainsByUserResponse {
  sys_domains?: TarsDomain[];
}

/**
 * The specialized brains a pwc_tars user may access, resolved by pwc_tars from
 * the union of the user's role → domain grants (`GET /domain_settings/get_domain_by_user`).
 */
export async function fetchTarsDomainsForUser(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsDomain[]> {
  if (!tarsId) {
    return [];
  }
  const data = await tarsFetch<DomainsByUserResponse>('/api/domain_settings/get_domain_by_user', {
    query: { user_id: tarsId },
    baseUrl,
  });
  return data?.sys_domains ?? [];
}

/**
 * A single specialized brain the user is authorized for. Resolved from the
 * user's accessible domains so the lookup itself enforces authorization — a
 * user can never resolve a domain outside their role grants.
 */
export async function fetchTarsDomainById(
  tarsId: string,
  domainId: number | string,
  baseUrl?: string,
): Promise<TarsDomain | null> {
  const target = String(domainId);
  const domains = await fetchTarsDomainsForUser(tarsId, baseUrl);
  return domains.find((domain) => String(domain.id) === target) ?? null;
}

/** A pwc_tars role, used to populate the domain editor's role multi-select. */
export interface TarsRole {
  id: number;
  name: string;
  domain_ids?: string | null;
}

export interface TarsDomainPrepareData {
  sys_domains: TarsDomain[];
  knowledge_bases: TarsKnowledgeBase[];
  roles: TarsRole[];
}

/** Create/update payload for a specialized brain. */
export interface TarsDomainInput {
  name: string;
  description?: string;
  role_ids?: string;
  knowledge_base_ids?: string;
  domain_functions?: string;
  prompt_instruction?: string;
  iframe_url?: string;
  status?: number | boolean;
}

/**
 * Everything the domain admin editor needs in one call
 * (`GET /api/domain_settings/prepare_data`): all domains, knowledge bases and roles.
 */
export async function fetchTarsDomainPrepareData(baseUrl?: string): Promise<TarsDomainPrepareData> {
  const data = await tarsFetch<Partial<TarsDomainPrepareData>>(
    '/api/domain_settings/prepare_data',
    { baseUrl },
  );
  return {
    sys_domains: data?.sys_domains ?? [],
    knowledge_bases: data?.knowledge_bases ?? [],
    roles: data?.roles ?? [],
  };
}

export async function createTarsDomain(
  tarsId: string,
  input: TarsDomainInput,
  baseUrl?: string,
): Promise<TarsDomain> {
  const data = await tarsFetch<{ domain: TarsDomain }>('/api/domain_settings/create_domain', {
    method: 'POST',
    body: { ...input, created_by: tarsId },
    baseUrl,
  });
  return data.domain;
}

export async function updateTarsDomain(
  tarsId: string,
  domainId: number | string,
  input: TarsDomainInput,
  baseUrl?: string,
): Promise<TarsDomain> {
  const data = await tarsFetch<{ domain: TarsDomain }>(
    `/api/domain_settings/update_domain/${encodeURIComponent(String(domainId))}`,
    { method: 'PUT', body: { ...input, updated_by: tarsId }, baseUrl },
  );
  return data.domain;
}

/**
 * Deletes a specialized brain. pwc_tars strips the id out of every role's
 * `domain_ids` in the same request and records the operator in its audit log,
 * so `operator_id` must be passed even though the deletion itself would succeed
 * without it.
 */
export async function deleteTarsDomain(
  tarsId: string,
  domainId: number | string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/domain_settings/delete_domain/${encodeURIComponent(String(domainId))}`, {
    method: 'DELETE',
    query: { operator_id: tarsId },
    baseUrl,
  });
}
