import type { TarsAccessEnvelope } from './client';
import { tarsFetch } from './client';

const MANAGED_TTL_MS = 60_000;

/** `all` = a pwc_tars admin; otherwise only the listed knowledge bases. */
export interface TarsManagedKnowledgeBases {
  all: boolean;
  ids: Set<string>;
}

interface ManagedEntry {
  managed: TarsManagedKnowledgeBases;
  cachedAt: number;
}

const managedCache = new Map<string, ManagedEntry>();
const managedInFlight = new Map<string, Promise<TarsManagedKnowledgeBases>>();
/** Bumped on invalidation, so a read that started before it never writes back a stale list. */
let managedGeneration = 0;

/**
 * Drops the cached management lists. Called when a list may have changed here; a change
 * made elsewhere (pwc_tars's own page, a group membership) lands within the TTL.
 */
export function invalidateTarsManagedKnowledgeBasesCache(): void {
  managedGeneration += 1;
  managedCache.clear();
  managedInFlight.clear();
}

async function readManagedKnowledgeBases(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsManagedKnowledgeBases> {
  const envelope = await tarsFetch<
    TarsAccessEnvelope<{ all?: boolean; knowledge_base_ids?: string[] }>
  >('/api/km_permission/managed_knowledge_bases', { query: { user_id: tarsId }, baseUrl });
  return {
    all: envelope?.data?.all === true,
    ids: new Set(envelope?.data?.knowledge_base_ids ?? []),
  };
}

/**
 * The knowledge bases a user may manage (pwc_tars `knowledge_base.allowed_*`: the user or
 * one of their enabled groups). Cached per user for a minute; concurrent reads share
 * one request. A pwc_tars failure throws, so callers decide how to fail closed.
 */
export async function fetchTarsManagedKnowledgeBases(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsManagedKnowledgeBases> {
  const cached = managedCache.get(tarsId);
  if (cached && Date.now() - cached.cachedAt < MANAGED_TTL_MS) {
    return cached.managed;
  }
  const pending = managedInFlight.get(tarsId);
  if (pending) {
    return pending;
  }
  const generation = managedGeneration;
  const request = readManagedKnowledgeBases(tarsId, baseUrl)
    .then((managed) => {
      if (generation === managedGeneration) {
        managedCache.set(tarsId, { managed, cachedAt: Date.now() });
      }
      return managed;
    })
    .finally(() => {
      if (managedInFlight.get(tarsId) === request) {
        managedInFlight.delete(tarsId);
      }
    });
  managedInFlight.set(tarsId, request);
  return request;
}
