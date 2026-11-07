import { webSearchAuth, webSearchKeys } from '@librechat/data-schemas';
import { AuthType, SearchCategories, extractVariableName } from 'librechat-data-provider';
import type { TWebSearchKeys, TWebSearchCategories } from '@librechat/data-schemas';
import type { TCustomConfig } from 'librechat-data-provider';
import type { WebSearchAuthResult } from '~/web';
import { getTarsSysConfigValue, parseTarsConfigRef } from './sysconfig';
import { loadWebSearchAuth } from '~/web';

/** {@link loadWebSearchAuth}'s result, naming the service whose sys_config key is unset. */
export interface TarsWebSearchAuthResult extends WebSearchAuthResult {
  /** Set while a category runs on a `${tars:KEY}` key that 系統參數設定 does not hold yet. */
  missingKeyProvider?: string;
}

/** The config field pinning each category's service. */
const PINNED_SERVICE_FIELDS = {
  [SearchCategories.PROVIDERS]: 'searchProvider',
  [SearchCategories.SCRAPERS]: 'scraperProvider',
  [SearchCategories.RERANKERS]: 'rerankerType',
} as const;

const SERVICE_LABELS = new Map<string, string>([
  ['tavily', 'Tavily'],
  ['serper', 'Serper'],
  ['searxng', 'SearXNG'],
  ['firecrawl', 'Firecrawl'],
  ['jina', 'Jina'],
  ['cohere', 'Cohere'],
]);

/**
 * `loadWebSearchAuth`'s `systemAuthValues` for the web search keys that name a
 * pwc_tars sys_config row, e.g. `tavilyApiKey: '${tars:KEY_TAVILY}'`. Keyed by
 * the auth field the config value yields (`tars:KEY_TAVILY`); an unset row maps
 * to undefined, so the provider reads as unconfigured instead of asking the
 * user for a key.
 */
export async function resolveTarsWebSearchAuthValues(
  webSearchConfig: TCustomConfig['webSearch'],
): Promise<Map<string, string | undefined>> {
  const refs = new Map<string, string>();
  for (const key of webSearchKeys) {
    const value = webSearchConfig?.[key];
    if (typeof value !== 'string') {
      continue;
    }
    const sysKey = parseTarsConfigRef(value);
    const field = sysKey ? extractVariableName(value) : null;
    if (sysKey && field) {
      refs.set(field, sysKey);
    }
  }
  const entries = await Promise.all(
    [...refs].map(async ([field, sysKey]) => [field, await getTarsSysConfigValue(sysKey)] as const),
  );
  return new Map(entries);
}

/**
 * The service a category is pinned to when every key it requires is a `${tars:KEY}`
 * reference and one of them has no value: only an admin can supply it, never the user.
 */
function getUnsetTarsService(
  category: TWebSearchCategories,
  webSearchConfig: TCustomConfig['webSearch'],
  systemAuthValues: ReadonlyMap<string, string | undefined>,
): string | undefined {
  const service = webSearchConfig?.[PINNED_SERVICE_FIELDS[category]];
  const services: Record<string, Record<string, 0 | 1>> = webSearchAuth[category];
  const keys = service ? services[service] : undefined;
  if (!service || !keys) {
    return undefined;
  }
  const required = Object.entries(keys).filter(([, flag]) => flag === 1);
  const fields = required.flatMap(([key]) => {
    const value = webSearchConfig?.[key as TWebSearchKeys];
    const field =
      typeof value === 'string' && parseTarsConfigRef(value) ? extractVariableName(value) : null;
    return field ? [field] : [];
  });
  if (fields.length === 0 || fields.length < required.length) {
    return undefined;
  }
  return fields.some((field) => !systemAuthValues.get(field)) ? service : undefined;
}

/** `loadWebSearchAuth` with the `${tars:KEY}` references resolved from pwc_tars sys_config. */
export async function loadTarsWebSearchAuth(
  params: Omit<Parameters<typeof loadWebSearchAuth>[0], 'systemAuthValues'>,
): Promise<TarsWebSearchAuthResult> {
  const systemAuthValues = await resolveTarsWebSearchAuthValues(params.webSearchConfig);
  const result = await loadWebSearchAuth({ ...params, systemAuthValues });
  if (result.authenticated || systemAuthValues.size === 0) {
    return result;
  }
  /** A category waiting on an admin's key is system-defined, so the client asks no one for it. */
  let missingKeyProvider: string | undefined;
  const authTypes = result.authTypes.map(
    ([category, authType]): [TWebSearchCategories, AuthType] => {
      const service =
        authType === AuthType.USER_PROVIDED
          ? getUnsetTarsService(category, params.webSearchConfig, systemAuthValues)
          : undefined;
      if (!service) {
        return [category, authType];
      }
      missingKeyProvider ??= SERVICE_LABELS.get(service) ?? service;
      return [category, AuthType.SYSTEM_DEFINED];
    },
  );
  return missingKeyProvider ? { ...result, authTypes, missingKeyProvider } : result;
}
