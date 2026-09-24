import type { TarsKnowledgeBase } from '~/tars/knowledge';
import { fetchTarsDomainKnowledgeBases } from '~/tars/prompts';
import { fetchTarsKnowledgeBases } from '~/tars/knowledge';

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
 * The knowledge bases one chat turn may reach: everything pwc_tars grants the
 * user, narrowed to what the active 專用腦 binds. This mirrors pwc_tars's own
 * chat path, which answers out of the domain's `knowledge_base_ids` rather
 * than everything the user can see. Both listings are already scoped by
 * pwc_tars to the user's grants, so the result doubles as the authorization
 * set for every capability that names a knowledge base (SQL, RAG). Without a
 * domain it falls back to every knowledge base the user may access.
 */
export async function listTarsScopedKnowledgeBases(
  tarsUserId: string,
  domainId?: string | number | null,
): Promise<TarsKnowledgeBase[]> {
  if (!tarsUserId) {
    return [];
  }
  const scope = domainId == null || domainId === '' ? '' : String(domainId);
  const cacheKey = `${tarsUserId}\u0000${scope}`;
  const cached = scopedCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.bases;
  }

  const [bases, domainBases] = await Promise.all([
    fetchTarsKnowledgeBases(tarsUserId),
    scope ? fetchTarsDomainKnowledgeBases(tarsUserId, scope) : Promise.resolve(null),
  ]);
  const inDomain = domainBases && new Set(domainBases.map((base) => base.id));
  const scoped = inDomain ? bases.filter((base) => inDomain.has(base.id)) : bases;
  scopedCache.set(cacheKey, { bases: scoped, cachedAt: Date.now() });
  return scoped;
}
