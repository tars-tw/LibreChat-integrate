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
