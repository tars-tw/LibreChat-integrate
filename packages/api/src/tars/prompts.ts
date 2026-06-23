import { tarsFetch } from './client';
import { fetchTarsDomainById } from './domains';
import { fetchTarsKnowledgeBases } from './knowledge';

/** Which pwc_tars table a prompt lives in — its visibility tier. */
export type TarsPromptScope = 'personal' | 'domain' | 'knowledge_base';

/**
 * A pwc_tars "我的提示". Mirrors `Prompt.to_dict()` (and the domain/knowledge-base
 * variants, which share the same shape). `knowledge_base_name` is only present on
 * knowledge-base prompts; `scope` is tagged client-side by the chat aggregator,
 * matching `PromptHelper`'s `isDomain` / `isKnowledgeBase` markers.
 */
export interface TarsPrompt {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  content: string;
  status: number;
  created_by: string;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
  knowledge_base_name?: string | null;
  scope?: TarsPromptScope;
}

interface PromptsResponse {
  prompts?: TarsPrompt[];
}

/** Create/update payload. pwc_tars routes the prompt by which id is present. */
export interface TarsPromptInput {
  name: string;
  content: string;
  category: string;
  description?: string;
  status?: number;
  domain_id?: string | number;
  knowledge_base_id?: string;
}

/** Personal prompts owned by the user (`prompt` table, keyed on `created_by`). */
export async function fetchTarsPersonalPrompts(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsPrompt[]> {
  if (!tarsId) {
    return [];
  }
  const data = await tarsFetch<PromptsResponse>('/api/prompt/prepare_data', {
    query: { user_id: tarsId },
    baseUrl,
  });
  return data?.prompts ?? [];
}

/** Prompts shared within a specialized brain (`prompt_to_domain` table). */
export async function fetchTarsDomainPrompts(
  tarsId: string,
  domainId: number | string,
  baseUrl?: string,
): Promise<TarsPrompt[]> {
  const data = await tarsFetch<PromptsResponse>('/api/prompt/prepare_data_domain', {
    query: { user_id: tarsId, domain_id: domainId },
    baseUrl,
  });
  return data?.prompts ?? [];
}

/** Prompts attached to a knowledge base (`prompt_to_knowledge_base` table). */
export async function fetchTarsKnowledgeBasePrompts(
  knowledgeBaseId: string,
  baseUrl?: string,
): Promise<TarsPrompt[]> {
  const data = await tarsFetch<PromptsResponse>('/api/prompt/prepare_data_km', {
    query: { knowledge_base_id: knowledgeBaseId },
    baseUrl,
  });
  return data?.prompts ?? [];
}

const tag = (prompts: TarsPrompt[], scope: TarsPromptScope): TarsPrompt[] =>
  prompts.map((prompt) => ({ ...prompt, scope }));

const parseIds = (csv: string | null | undefined): string[] =>
  (csv ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

/**
 * The three-tier prompt list a chat sees for its current specialized brain,
 * mirroring `PromptHelper`: the brain's prompts, every bound knowledge base's
 * prompts, then the user's personal prompts. Resolving the domain via the user's
 * accessible brains enforces authorization — an inaccessible `domainId` yields
 * only personal prompts.
 */
export async function fetchTarsPromptsForChat(
  tarsId: string,
  domainId: number | string | null | undefined,
  baseUrl?: string,
): Promise<TarsPrompt[]> {
  if (!tarsId) {
    return [];
  }

  const personal = fetchTarsPersonalPrompts(tarsId, baseUrl).then((p) => tag(p, 'personal'));

  if (domainId == null || domainId === '') {
    return personal;
  }

  const domain = await fetchTarsDomainById(tarsId, domainId, baseUrl);
  if (!domain) {
    return personal;
  }

  const domainPrompts = fetchTarsDomainPrompts(tarsId, domain.id, baseUrl).then((p) =>
    tag(p, 'domain'),
  );
  const kbPrompts = parseIds(domain.knowledge_base_ids).map((kbId) =>
    fetchTarsKnowledgeBasePrompts(kbId, baseUrl).then((p) => tag(p, 'knowledge_base')),
  );

  const groups = await Promise.all([domainPrompts, ...kbPrompts, personal]);
  return groups.flat();
}

/** A specialized brain's knowledge base, for the create form's scope picker. */
export interface TarsPromptKnowledgeBase {
  id: string;
  name: string;
}

/**
 * The knowledge bases bound to a specialized brain, resolved to `{ id, name }`
 * by intersecting the brain's `knowledge_base_ids` with the KBs the user may
 * access — so the picker only offers authorized targets. Names fall back to the
 * id when a bound KB is not in the user's accessible set.
 */
export async function fetchTarsDomainKnowledgeBases(
  tarsId: string,
  domainId: number | string | null | undefined,
  baseUrl?: string,
): Promise<TarsPromptKnowledgeBase[]> {
  if (!tarsId || domainId == null || domainId === '') {
    return [];
  }
  const domain = await fetchTarsDomainById(tarsId, domainId, baseUrl);
  const ids = parseIds(domain?.knowledge_base_ids);
  if (!ids.length) {
    return [];
  }
  const accessible = await fetchTarsKnowledgeBases(tarsId, baseUrl);
  const nameById = new Map(accessible.map((kb) => [String(kb.id), kb.name]));
  return ids.map((id) => ({ id, name: nameById.get(id) ?? id }));
}

export async function createTarsPrompt(
  tarsId: string,
  input: TarsPromptInput,
  baseUrl?: string,
): Promise<TarsPrompt> {
  const data = await tarsFetch<{ prompt: TarsPrompt }>('/api/prompt/create_prompt', {
    method: 'POST',
    body: { ...input, created_by: tarsId },
    baseUrl,
  });
  return data.prompt;
}

export async function updateTarsPrompt(
  tarsId: string,
  promptId: string,
  input: TarsPromptInput,
  baseUrl?: string,
): Promise<TarsPrompt> {
  const data = await tarsFetch<{ prompt: TarsPrompt }>(
    `/api/prompt/update_prompt/${encodeURIComponent(promptId)}`,
    { method: 'PUT', body: { ...input, updated_by: tarsId }, baseUrl },
  );
  return data.prompt;
}

export async function deleteTarsPrompt(
  promptId: string,
  scope?: { domainId?: string | number; knowledgeBaseId?: string },
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/prompt/delete_prompt/${encodeURIComponent(promptId)}`, {
    method: 'DELETE',
    query: { domain_id: scope?.domainId, knowledge_base_id: scope?.knowledgeBaseId },
    baseUrl,
  });
}
