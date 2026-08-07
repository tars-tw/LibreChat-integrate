/**
 * Static user-manual bundles shipped under `client/public/`. Vite copies them into
 * `client/dist/` at build time, so the backend's `staticCache(paths.dist)` serves them
 * directly. Only Traditional Chinese and English editions exist; every other locale
 * falls back to English.
 */
const MANUAL_PATHS = {
  'zh-Hant': 'manual_zh-Hant/index.html',
  en: 'manual_en/index.html',
} as const;

/** Upstream LibreChat's fallback when `HELP_AND_FAQ_URL` is unset — treated as "not configured". */
const DEFAULT_HELP_AND_FAQ_URL = 'https://librechat.ai';

/** Resolves the manual path against `<base href>` so subpath deployments keep working. */
function resolveFromBase(path: string): string {
  if (typeof document === 'undefined') {
    return `/${path}`;
  }
  return new URL(path, document.baseURI).href;
}

export function getUserManualURL(lang?: string): string {
  const manual = lang?.startsWith('zh-Hant') === true ? MANUAL_PATHS['zh-Hant'] : MANUAL_PATHS.en;
  return resolveFromBase(manual);
}

/**
 * The bundled manual is the default help target; an explicitly configured
 * `HELP_AND_FAQ_URL` still wins so deployments can point at their own portal.
 */
export function getHelpAndFaqURL(lang?: string, configuredURL?: string): string {
  const isConfigured =
    !!configuredURL && configuredURL !== '/' && configuredURL !== DEFAULT_HELP_AND_FAQ_URL;
  return isConfigured ? configuredURL : getUserManualURL(lang);
}
