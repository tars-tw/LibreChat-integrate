import { isEphemeralAgentId } from 'librechat-data-provider';
import type { TTarsToolSwitch, TTarsAgentKnowledgeBases } from 'librechat-data-provider';
import type { TarsKnowledgeBase } from '~/tars/knowledge';
import type { TarsAccessEnvelope } from '~/tars/client';
import { fetchTarsDomainKnowledgeBaseIds } from '~/tars/prompts';
import { tarsFetch } from '~/tars/client';

const CACHE_TTL_MS = 30_000;

interface ScopedCacheEntry {
  bases: TarsKnowledgeBase[];
  cachedAt: number;
}

const scopedCache = new Map<string, ScopedCacheEntry>();

/** Drops the cached per-user knowledge-base scopes so the next call re-reads pwc_tars. */
export function invalidateTarsScopedKnowledgeBasesCache(): void {
  scopedCache.clear();
}

/**
 * The knowledge bases a user may use in chat (`km_permission`): assigned to them or one
 * of their enabled groups, enabled bases only. Admins are not exempt, and the management
 * list (`allowed_user_ids`) grants nothing here.
 */
export async function fetchTarsChatKnowledgeBases(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsKnowledgeBase[]> {
  const envelope = await tarsFetch<TarsAccessEnvelope<TarsKnowledgeBase[]>>(
    '/api/km_permission/chat_knowledge_bases',
    { query: { user_id: tarsId }, baseUrl },
  );
  return envelope?.data ?? [];
}

/**
 * What narrows a turn's knowledge bases: a saved agent's own picks for the tool, or —
 * for a chat without one — the active 專用腦. A plain id is the brain.
 */
export type TarsKnowledgeScope =
  | string
  | number
  | null
  | undefined
  | { knowledgeBaseIds: readonly string[] };

const isPicked = (scope: TarsKnowledgeScope): scope is { knowledgeBaseIds: readonly string[] } =>
  scope != null && typeof scope === 'object';

/**
 * The knowledge bases one chat turn may reach: the user's chat list
 * ({@link fetchTarsChatKnowledgeBases}), narrowed to what the saved agent picked for the
 * tool or, without a saved agent, to what the active 專用腦 binds. The result doubles as
 * the authorization set for every capability that names a knowledge base (SQL, RAG, the
 * built-in tools, the table task). With neither it is the whole chat list; an agent that
 * picked nothing reaches nothing.
 */
export async function listTarsScopedKnowledgeBases(
  tarsUserId: string,
  scope?: TarsKnowledgeScope,
): Promise<TarsKnowledgeBase[]> {
  if (!tarsUserId) {
    return [];
  }
  const picked = isPicked(scope) ? [...new Set(scope.knowledgeBaseIds)].sort() : null;
  if (picked != null && picked.length === 0) {
    return [];
  }
  const domain = picked != null || scope == null || scope === '' ? '' : String(scope);
  const key = picked != null ? `picked:${picked.join(',')}` : `domain:${domain}`;
  const cacheKey = `${tarsUserId}\u0000${key}`;
  const cached = scopedCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.bases;
  }

  const [bases, domainIds] = await Promise.all([
    fetchTarsChatKnowledgeBases(tarsUserId),
    domain ? fetchTarsDomainKnowledgeBaseIds(tarsUserId, domain) : Promise.resolve(null),
  ]);
  const allowed = picked ?? domainIds;
  const within = allowed && new Set(allowed);
  const scoped = within ? bases.filter((base) => within.has(base.id)) : bases;
  scopedCache.set(cacheKey, { bases: scoped, cachedAt: Date.now() });
  return scoped;
}

/**
 * A saved agent's TARS picks; undefined for a chat without one (an ephemeral agent),
 * which still follows the chat's 專用腦. A saved agent binds no brain, so a switch it
 * picked nothing for reaches nothing.
 */
export function tarsAgentKnowledgeBasesOf(
  agent:
    | { id?: string | null; tars_knowledge_bases?: TTarsAgentKnowledgeBases | null }
    | null
    | undefined,
): TTarsAgentKnowledgeBases | undefined {
  if (!agent?.id || isEphemeralAgentId(agent.id)) {
    return undefined;
  }
  return agent.tars_knowledge_bases ?? {};
}

/** Whether a chat request runs a saved agent, which binds no 專用腦 (an ephemeral agent still follows the chat's). */
export function isTarsSavedAgentChat(
  body: { agent_id?: string | null } | null | undefined,
): boolean {
  const agentId = body?.agent_id;
  return typeof agentId === 'string' && agentId !== '' && !isEphemeralAgentId(agentId);
}

/** The scope one switch's tool runs in: the agent's picks for it, else the chat's 專用腦. */
export function tarsSwitchScope(
  picks: TTarsAgentKnowledgeBases | undefined,
  toolSwitch: TTarsToolSwitch,
  domainId: string | number | null | undefined,
): TarsKnowledgeScope {
  return picks ? { knowledgeBaseIds: picks[toolSwitch] ?? [] } : domainId;
}
