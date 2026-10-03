import { logger } from '@librechat/data-schemas';
import { tarsFetch, isTarsConfigured } from './client';

/**
 * Sentinel `baseURL` for a custom endpoint whose models and per-model host
 * routing are auto-discovered from the pwc_tars local model registry. Unlike a
 * real URL or a `${tars:KEY}` sys_config reference, there is no single base URL:
 * each local model lives on its own vLLM host (see {@link resolveTarsLocalModelBaseURL}).
 */
export const TARS_LOCAL_ENDPOINT_MARKER = 'tars://local';

/** True when a custom endpoint's `baseURL` is the pwc_tars local-model marker. */
export function isTarsLocalEndpoint(baseURL?: string | null): boolean {
  return baseURL?.trim() === TARS_LOCAL_ENDPOINT_MARKER;
}

/** One entry of pwc_tars `GET /api/model/health_status`. */
interface TarsEndpointStatus {
  endpoint: string;
  /** Model ids currently loaded on this vLLM host. `null` before the first
   *  probe completes (pwc_tars startup grace window); treated as "none". */
  loaded_models: string[] | null;
}

interface TarsHealthStatusResponse {
  endpoints: TarsEndpointStatus[];
}

const CACHE_TTL_MS = 30_000;
/** The chat/model-list path must not hang on a down pwc_tars. */
const FETCH_TIMEOUT_MS = 3_000;

/** model id → OpenAI-compatible base URL (already suffixed with `/v1`). */
let cachedMap: Map<string, string> | null = null;
let cachedAt = 0;
let inflight: Promise<Map<string, string> | null> | null = null;

/** Drops the cached model→endpoint map so the next lookup re-reads pwc_tars. */
export function invalidateTarsLocalModelsCache(): void {
  cachedMap = null;
  cachedAt = 0;
  inflight = null;
}

function buildModelMap(rows: TarsEndpointStatus[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const endpoint = row.endpoint?.trim();
    if (!endpoint || !Array.isArray(row.loaded_models)) {
      continue;
    }
    const baseURL = `${endpoint.replace(/\/+$/, '')}/v1`;
    for (const model of row.loaded_models) {
      if (model) {
        map.set(model, baseURL);
      }
    }
  }
  return map;
}

async function refreshMap(): Promise<Map<string, string> | null> {
  try {
    const data = await tarsFetch<TarsHealthStatusResponse>('/api/model/health_status', {
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    cachedMap = buildModelMap(data?.endpoints ?? []);
  } catch (error) {
    logger.warn(
      `[TarsLocalModels] Failed to refresh local model status; ${
        cachedMap ? 'serving stale map' : 'treating as none available'
      }`,
      error,
    );
    cachedMap = cachedMap ?? new Map<string, string>();
  } finally {
    cachedAt = Date.now();
    inflight = null;
  }
  return cachedMap;
}

/**
 * The pwc_tars-discovered map of currently-loaded local model id → its vLLM
 * `/v1` base URL, from a per-process TTL cache. Concurrent callers share one
 * in-flight fetch; on failure the previous map is served (or an empty map on
 * cold start) so a down pwc_tars is retried at most once per TTL. Returns an
 * empty map when the TARS integration is unconfigured.
 */
async function getModelMap(): Promise<Map<string, string>> {
  if (!isTarsConfigured()) {
    return new Map<string, string>();
  }
  if (!cachedMap || Date.now() - cachedAt >= CACHE_TTL_MS) {
    inflight = inflight ?? refreshMap();
    await inflight;
  }
  return cachedMap ?? new Map<string, string>();
}

/**
 * The ids of all local models currently loaded across every pwc_tars vLLM host,
 * sorted for a stable selector order. Empty when none are up (or pwc_tars is
 * unreachable), which the model selector treats as "hide the endpoint".
 */
export async function getTarsLocalModelNames(): Promise<string[]> {
  const map = await getModelMap();
  return [...map.keys()].sort();
}

/**
 * The OpenAI-compatible base URL (suffixed with `/v1`) of the vLLM host serving
 * `model`, or undefined when the model is not currently loaded on any host.
 */
export async function resolveTarsLocalModelBaseURL(model: string): Promise<string | undefined> {
  if (!model) {
    return undefined;
  }
  const map = await getModelMap();
  return map.get(model);
}

/** One entry of pwc_tars `GET /api/model/get_model_list`. */
interface TarsModelListEntry {
  model_name?: string | null;
}

const PROFILE_CACHE_TTL_MS = 60_000;

let cachedProfileNames: string[] | null = null;
let profileCachedAt = 0;
let profileInflight: Promise<string[] | null> | null = null;

/** Drops the cached model_profile name list so the next lookup re-reads pwc_tars. */
export function invalidateTarsModelProfilesCache(): void {
  cachedProfileNames = null;
  profileCachedAt = 0;
  profileInflight = null;
}

async function refreshProfileNames(): Promise<string[] | null> {
  try {
    const rows = await tarsFetch<TarsModelListEntry[]>('/api/model/get_model_list', {
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    const names = new Set<string>();
    for (const row of rows ?? []) {
      const name = row?.model_name?.trim();
      if (name) {
        names.add(name);
      }
    }
    cachedProfileNames = [...names];
  } catch (error) {
    logger.warn(
      `[TarsModelProfiles] Failed to refresh model_profile list; ${
        cachedProfileNames ? 'serving stale list' : 'treating as unrestricted'
      }`,
      error,
    );
  } finally {
    profileCachedAt = Date.now();
    profileInflight = null;
  }
  return cachedProfileNames;
}

/**
 * Names of the active pwc_tars `model_profile` rows (the customer-approved
 * model whitelist), from a per-process TTL cache with a shared in-flight fetch.
 * Returns null — meaning "no restriction" — when the TARS integration is
 * unconfigured or pwc_tars is unreachable with no cached list (fail-open: the
 * selector must not lock every model because pwc_tars is down).
 */
export async function getTarsModelProfileNames(): Promise<string[] | null> {
  if (!isTarsConfigured()) {
    return null;
  }
  if (Date.now() - profileCachedAt >= PROFILE_CACHE_TTL_MS) {
    profileInflight = profileInflight ?? refreshProfileNames();
    await profileInflight;
  }
  return cachedProfileNames;
}

/**
 * Reorders every endpoint's model list so pwc_tars model_profile (whitelisted)
 * models come first, each side keeping its relative order. The first entry of a
 * list is LibreChat's default model for new conversations, so without this the
 * default can land on a locked model. No-op when unrestricted.
 */
export async function reorderTarsWhitelistedModels<T extends Record<string, string[]>>(
  modelsConfig: T,
): Promise<T> {
  const names = await getTarsModelProfileNames();
  if (!names?.length) {
    return modelsConfig;
  }
  const allowed = new Set(names.map((name) => name.toLowerCase()));
  const result = { ...modelsConfig };
  for (const [endpoint, models] of Object.entries(modelsConfig)) {
    if (!Array.isArray(models) || models.length === 0) {
      continue;
    }
    const top: string[] = [];
    const rest: string[] = [];
    for (const model of models) {
      (typeof model === 'string' && allowed.has(model.toLowerCase()) ? top : rest).push(model);
    }
    if (top.length > 0 && rest.length > 0) {
      result[endpoint as keyof T] = [...top, ...rest] as T[keyof T];
    }
  }
  return result;
}
