import { webSearchKeys } from '@librechat/data-schemas';
import { extractVariableName } from 'librechat-data-provider';
import type { TCustomConfig } from 'librechat-data-provider';
import type { WebSearchAuthResult } from '~/web';
import { getTarsSysConfigValue, parseTarsConfigRef } from './sysconfig';
import { loadWebSearchAuth } from '~/web';

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

/** `loadWebSearchAuth` with the `${tars:KEY}` references resolved from pwc_tars sys_config. */
export async function loadTarsWebSearchAuth(
  params: Omit<Parameters<typeof loadWebSearchAuth>[0], 'systemAuthValues'>,
): Promise<WebSearchAuthResult> {
  const systemAuthValues = await resolveTarsWebSearchAuthValues(params.webSearchConfig);
  return loadWebSearchAuth({ ...params, systemAuthValues });
}
