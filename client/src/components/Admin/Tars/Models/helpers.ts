import { TARS_MODEL_TYPES } from 'librechat-data-provider';
import type { TTarsModelProfile, TTarsModelProfileSync } from 'librechat-data-provider';

const ZH = 'zh-TW';
const EN = 'en-US';

export const isProfileEnabled = (profile: TTarsModelProfile): boolean =>
  Number(profile.status) === 1;

/** The selectable types plus any legacy one still in use, for the list filter. */
export const collectModelTypes = (profiles: TTarsModelProfile[]): string[] => {
  const types = new Set<string>(TARS_MODEL_TYPES);
  for (const profile of profiles) {
    const type = profile.type?.trim();
    if (type) {
      types.add(type);
    }
  }
  return [...types].sort((a, b) => a.localeCompare(b));
};

const parseObject = (raw: string | null | undefined): Record<string, unknown> | null => {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * The model selector shows a description per UI language, stored as
 * `{"zh-TW": …, "en-US": …}`. Older rows hold plain text, which reads the same
 * in every language.
 */
export const splitDescription = (raw: string | null | undefined): { zh: string; en: string } => {
  const parsed = parseObject(raw);
  if (parsed) {
    return { zh: textOf(parsed[ZH]), en: textOf(parsed[EN]) };
  }
  return { zh: raw ?? '', en: '' };
};

/**
 * Writes the two languages back into the stored JSON, keeping any other locale
 * an earlier editor put there. Both empty with nothing else left → ''.
 */
export const joinDescription = (raw: string | null | undefined, zh: string, en: string): string => {
  const next: Record<string, unknown> = { ...(parseObject(raw) ?? {}) };
  for (const [key, value] of [
    [ZH, zh.trim()],
    [EN, en.trim()],
  ] as const) {
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
  }
  return Object.keys(next).length > 0 ? JSON.stringify(next) : '';
};

/** The description in the UI language, falling back to the other one; plain text drops its `[tag]` prefix. */
export const displayDescription = (raw: string | null | undefined, language: string): string => {
  const parsed = parseObject(raw);
  if (!parsed) {
    return (raw ?? '').replace(/^\[.*?\]\s*/, '');
  }
  const preferred = language.toLowerCase().startsWith('zh') ? [ZH, EN] : [EN, ZH];
  return preferred.map((key) => textOf(parsed[key])).find(Boolean) ?? '';
};

/** pwc_tars rejects anything but a JSON object; an empty config means "no settings". */
export const isValidConfig = (text: string): boolean => !text.trim() || parseObject(text) != null;

export const formatConfig = (text: string): string => {
  const parsed = parseObject(text);
  return parsed ? JSON.stringify(parsed, null, 2) : text;
};

/** How many live references pwc_tars moved onto another model, and which one. */
export const summarizeSync = (
  sync: TTarsModelProfileSync | null | undefined,
): { count: number; name: string } | null => {
  if (!sync?.target) {
    return null;
  }
  const count = sync.knowledge_base + sync.sys_model + sync.sys_rag_model + sync.sys_domain;
  return count > 0 ? { count, name: sync.target.name } : null;
};

export const errorStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } })?.response?.status;

export const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
