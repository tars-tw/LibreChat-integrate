import { EModelEndpoint } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import { tarsFetch, isTarsConfigured } from './client';
import { isUserProvided, checkUserKeyExpiry } from '~/utils';

/** A pwc_tars system parameter (系統參數設定). Mirrors `SysConfig.to_dict()`. */
export interface TarsSysConfig {
  id: number;
  category: string | null;
  key: string;
  value: string | null;
  type: string;
  description: string | null;
  status: string;
  is_displayed: boolean;
  created_by: string;
  created_name: string;
  updated_by: string | null;
  updated_name: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Update payload; pwc_tars only touches fields that are present and non-null. */
export interface TarsSysConfigUpdate {
  key: string;
  value?: string;
  description?: string;
  status?: string;
}

/** Providers whose API key can be centrally managed in the pwc_tars sys_config table. */
export type TarsKeyedProvider =
  | EModelEndpoint.openAI
  | EModelEndpoint.anthropic
  | EModelEndpoint.google;

const TARS_PROVIDER_KEY_MAP: Record<TarsKeyedProvider, string> = {
  [EModelEndpoint.openAI]: 'KEY_OPEN_AI_API',
  [EModelEndpoint.anthropic]: 'KEY_ANTHROPIC_API',
  [EModelEndpoint.google]: 'KEY_GEMINI_API',
};

const SYSCONFIG_CACHE_TTL_MS = 30_000;
/** The chat path must not hang on a down pwc_tars, so this is far below tarsFetch's default. */
const SYSCONFIG_FETCH_TIMEOUT_MS = 3_000;

let cachedKeys: Map<string, string> | null = null;
let cachedAt = 0;
let inflight: Promise<Map<string, string> | null> | null = null;

/** All displayed system parameters (`sys_config` rows with `is_displayed=true`). */
export async function fetchTarsSysConfigs(baseUrl?: string): Promise<TarsSysConfig[]> {
  const data = await tarsFetch<TarsSysConfig[]>('/api/sys_config/prepare_data', { baseUrl });
  return data ?? [];
}

/** Drops the cached key map so the next chat request re-reads sys_config. */
export function invalidateTarsSysConfigCache(): void {
  cachedKeys = null;
  cachedAt = 0;
  inflight = null;
}

export async function updateTarsSysConfig(
  updater: { tarsId: string; name: string },
  input: TarsSysConfigUpdate,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/sys_config/update_sys_config', {
    method: 'PUT',
    body: { ...input, updated_by: updater.tarsId, updated_name: updater.name },
    baseUrl,
  });
  invalidateTarsSysConfigCache();
}

/** '', whitespace, or 'DEFAULT' (any case) means "unset" by pwc_tars convention. */
function isValidKeyValue(value: string | null): value is string {
  const trimmed = value?.trim();
  return !!trimmed && trimmed.toUpperCase() !== 'DEFAULT';
}

async function refreshKeyCache(): Promise<Map<string, string> | null> {
  try {
    const rows = await tarsFetch<TarsSysConfig[]>('/api/sys_config/prepare_data', {
      timeoutMs: SYSCONFIG_FETCH_TIMEOUT_MS,
    });
    const keys = new Map<string, string>();
    for (const row of rows ?? []) {
      if (row.status === 'active' && isValidKeyValue(row.value)) {
        keys.set(row.key, row.value.trim());
      }
    }
    cachedKeys = keys;
  } catch (error) {
    logger.warn(
      `[TarsSysConfig] Failed to refresh sys_config keys; ${
        cachedKeys ? 'serving stale values' : 'falling back to env'
      }`,
      error,
    );
    cachedKeys = cachedKeys ?? new Map<string, string>();
  } finally {
    cachedAt = Date.now();
    inflight = null;
  }
  return cachedKeys;
}

/**
 * The active sys_config value for `key`, from a per-process TTL cache.
 * Concurrent chat requests share one in-flight fetch; on failure the previous
 * values are served (or an empty negative cache on cold start) so a down
 * pwc_tars is retried at most once per TTL. Returns undefined when the TARS
 * integration is unconfigured or the key is absent/invalid/inactive.
 */
export async function getTarsSysConfigValue(key: string): Promise<string | undefined> {
  if (!isTarsConfigured()) {
    return undefined;
  }
  if (!cachedKeys || Date.now() - cachedAt >= SYSCONFIG_CACHE_TTL_MS) {
    inflight = inflight ?? refreshKeyCache();
    await inflight;
  }
  return cachedKeys?.get(key);
}

/** The active sys_config API key for a provider — see {@link getTarsSysConfigValue}. */
export async function getTarsProviderApiKey(
  provider: TarsKeyedProvider,
): Promise<string | undefined> {
  return getTarsSysConfigValue(TARS_PROVIDER_KEY_MAP[provider]);
}

/**
 * Expiry guard for personal keys of TARS-keyed providers: returns false while
 * the key is still valid, returns true when it is expired but an active
 * sys_config key covers the provider — the caller must then ignore the
 * personal key so the sys_config fallback applies — and otherwise rethrows
 * the expiry error.
 */
export async function isExpiredKeyCoveredByTars(
  expiresAt: string,
  provider: TarsKeyedProvider,
): Promise<boolean> {
  try {
    checkUserKeyExpiry(expiresAt, provider);
    return false;
  } catch (error) {
    if (await getTarsProviderApiKey(provider)) {
      return true;
    }
    throw error;
  }
}

/**
 * Precedence: the `user_provided` env sentinel wins (per-user key flows are
 * never intercepted) > active/valid sys_config value > env value.
 */
export async function resolveTarsProviderKey(
  envValue: string | undefined,
  provider: TarsKeyedProvider,
): Promise<string | undefined> {
  if (isUserProvided(envValue)) {
    return envValue;
  }
  return (await getTarsProviderApiKey(provider)) ?? envValue;
}
