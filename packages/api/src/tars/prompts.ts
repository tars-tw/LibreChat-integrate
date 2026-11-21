import { logger } from '@librechat/data-schemas';
import { tarsFetch, isTarsConfigured } from './client';
import { fetchTarsKnowledgeBases } from './knowledge';
import { fetchTarsDomainById } from './domains';

/** Which pwc_tars table a prompt lives in — its visibility tier. */
export type TarsPromptScope = 'personal' | 'domain' | 'knowledge_base' | 'agent';

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
  /** Quick `/command`; absent from a pwc_tars that predates the column */
  command?: string | null;
  status: number;
  created_by: string;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
  knowledge_base_name?: string | null;
  /** Set on agent prompts (`prompt_to_agent`); the name is tagged by the chat aggregator. */
  agent_id?: string | null;
  agent_name?: string | null;
  scope?: TarsPromptScope;
}

/** The saved agent whose prompts (`prompt_to_agent`) a request reaches. */
export interface TarsPromptAgent {
  id: string;
  name: string;
}

interface PromptsResponse {
  prompts?: TarsPrompt[];
}

/**
 * Create/update payload. pwc_tars routes the prompt by which id is present.
 * An empty `command` clears it; leaving it out keeps the stored one.
 */
export interface TarsPromptInput {
  name: string;
  content: string;
  category: string;
  description?: string;
  command?: string;
  status?: number;
  domain_id?: string | number;
  knowledge_base_id?: string;
}

/**
 * The body pwc_tars receives. `agent_id` routes the prompt to `prompt_to_agent`
 * ahead of every other id, so it is set only from an agent the caller was
 * authorized on and stripped from anything else a client sent.
 */
type TarsPromptBody = TarsPromptInput & { agent_id?: string };

const scopedPromptBody = (input: TarsPromptInput, agentId?: string): TarsPromptBody =>
  agentId
    ? { ...input, domain_id: undefined, knowledge_base_id: undefined, agent_id: agentId }
    : { ...input, agent_id: undefined };

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

/** A saved agent's own prompts (`prompt_to_agent` table), sorted by name. */
export async function fetchTarsAgentPrompts(
  agentId: string,
  baseUrl?: string,
): Promise<TarsPrompt[]> {
  const data = await tarsFetch<PromptsResponse>('/api/prompt/prepare_data_agent', {
    query: { agent_id: agentId },
    baseUrl,
  });
  return data?.prompts ?? [];
}

/** Deletes every prompt of an agent, returning how many pwc_tars removed. */
export async function deleteTarsAgentPrompts(agentId: string, baseUrl?: string): Promise<number> {
  const data = await tarsFetch<{ deleted_count?: number }>('/api/prompt/delete_agent_prompts', {
    method: 'DELETE',
    query: { agent_id: agentId },
    baseUrl,
  });
  return data?.deleted_count ?? 0;
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

/**
 * The ids of the knowledge bases a specialized brain binds, read from the brains the
 * user may access — an inaccessible brain binds nothing.
 */
export async function fetchTarsDomainKnowledgeBaseIds(
  tarsId: string,
  domainId: number | string | null | undefined,
  baseUrl?: string,
): Promise<string[]> {
  if (!tarsId || domainId == null || domainId === '') {
    return [];
  }
  const domain = await fetchTarsDomainById(tarsId, domainId, baseUrl);
  return parseIds(domain?.knowledge_base_ids);
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
  const ids = await fetchTarsDomainKnowledgeBaseIds(tarsId, domainId, baseUrl);
  if (!ids.length) {
    return [];
  }
  const accessible = await fetchTarsKnowledgeBases(tarsId, baseUrl);
  const nameById = new Map(accessible.map((kb) => [String(kb.id), kb.name]));
  return ids.map((id) => ({ id, name: nameById.get(id) ?? id }));
}

async function postTarsPrompt(
  tarsId: string,
  body: TarsPromptBody,
  baseUrl?: string,
): Promise<TarsPrompt> {
  const data = await tarsFetch<{ prompt: TarsPrompt }>('/api/prompt/create_prompt', {
    method: 'POST',
    body: { ...body, created_by: tarsId },
    baseUrl,
  });
  return data.prompt;
}

async function putTarsPrompt(
  tarsId: string,
  promptId: string,
  body: TarsPromptBody,
  baseUrl?: string,
): Promise<TarsPrompt> {
  const data = await tarsFetch<{ prompt: TarsPrompt }>(
    `/api/prompt/update_prompt/${encodeURIComponent(promptId)}`,
    { method: 'PUT', body: { ...body, updated_by: tarsId }, baseUrl },
  );
  return data.prompt;
}

/** Creates a personal, 專用腦 or knowledge-base prompt; never an agent's. */
export function createTarsPrompt(
  tarsId: string,
  input: TarsPromptInput,
  baseUrl?: string,
): Promise<TarsPrompt> {
  return postTarsPrompt(tarsId, scopedPromptBody(input), baseUrl);
}

/** Updates a personal, 專用腦 or knowledge-base prompt; never an agent's. */
export function updateTarsPrompt(
  tarsId: string,
  promptId: string,
  input: TarsPromptInput,
  baseUrl?: string,
): Promise<TarsPrompt> {
  return putTarsPrompt(tarsId, promptId, scopedPromptBody(input), baseUrl);
}

/** Creates a prompt on an agent the caller may edit (checked by the route). */
export function createTarsAgentPrompt(
  tarsId: string,
  agentId: string,
  input: TarsPromptInput,
  baseUrl?: string,
): Promise<TarsPrompt> {
  return postTarsPrompt(tarsId, scopedPromptBody(input, agentId), baseUrl);
}

/** Updates one of an agent's prompts; pwc_tars refuses a prompt of another agent (404). */
export function updateTarsAgentPrompt(
  tarsId: string,
  agentId: string,
  promptId: string,
  input: TarsPromptInput,
  baseUrl?: string,
): Promise<TarsPrompt> {
  return putTarsPrompt(tarsId, promptId, scopedPromptBody(input, agentId), baseUrl);
}

/** Which category to move, and to what; the scope ids pick the tier as on create. */
export interface TarsPromptCategoryRename {
  old_category: string;
  new_category: string;
  domain_id?: string | number;
  knowledge_base_id?: string;
}

/**
 * Moves every prompt of one tier from `old_category` to `new_category` in a
 * single pwc_tars transaction. pwc_tars keeps categories on the prompts
 * themselves, so this is both a rename and — into an existing category — the
 * only way to delete one. Personal scope is always the caller's own prompts.
 */
async function putTarsPromptCategory(
  tarsId: string,
  input: TarsPromptCategoryRename,
  agentId?: string,
  baseUrl?: string,
): Promise<{ updated_count: number }> {
  const data = await tarsFetch<{ updated_count?: number }>('/api/prompt/rename_category', {
    method: 'PUT',
    body: {
      old_category: input.old_category,
      new_category: input.new_category,
      ...(agentId
        ? { agent_id: agentId }
        : { domain_id: input.domain_id, knowledge_base_id: input.knowledge_base_id }),
      user_id: tarsId,
      updated_by: tarsId,
    },
    baseUrl,
  });
  return { updated_count: data?.updated_count ?? 0 };
}

export function renameTarsPromptCategory(
  tarsId: string,
  input: TarsPromptCategoryRename,
  baseUrl?: string,
): Promise<{ updated_count: number }> {
  return putTarsPromptCategory(tarsId, input, undefined, baseUrl);
}

/** Moves one agent's prompts between categories, as {@link renameTarsPromptCategory}. */
export function renameTarsAgentPromptCategory(
  tarsId: string,
  agentId: string,
  input: TarsPromptCategoryRename,
  baseUrl?: string,
): Promise<{ updated_count: number }> {
  return putTarsPromptCategory(tarsId, input, agentId, baseUrl);
}

export async function deleteTarsPrompt(
  promptId: string,
  scope?: { domainId?: string | number; knowledgeBaseId?: string; agentId?: string },
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/prompt/delete_prompt/${encodeURIComponent(promptId)}`, {
    method: 'DELETE',
    query: {
      domain_id: scope?.domainId,
      knowledge_base_id: scope?.knowledgeBaseId,
      agent_id: scope?.agentId,
    },
    baseUrl,
  });
}

/**
 * Drops a deleted agent's prompts. Best-effort and never rejects: the agent is
 * already gone, so a failure is only logged and leaves orphan rows nobody can reach.
 */
export async function forgetTarsAgentPrompts(agentId: string, baseUrl?: string): Promise<void> {
  if (!agentId || !isTarsConfigured(baseUrl)) {
    return;
  }
  try {
    await deleteTarsAgentPrompts(agentId, baseUrl);
  } catch (error) {
    logger.warn(`[tars] Failed to delete the prompts of deleted agent ${agentId}`, error);
  }
}

/** Wraps an agent delete so a successful one also drops the agent's pwc_tars prompts. */
export function withTarsAgentPromptCleanup<TSearch extends { id: string }, TResult>(
  deleteAgent: (search: TSearch) => Promise<TResult | null>,
): (search: TSearch) => Promise<TResult | null> {
  return async (search) => {
    const deleted = await deleteAgent(search);
    if (deleted) {
      void forgetTarsAgentPrompts(search.id);
    }
    return deleted;
  };
}
