import { TARS_MEMORY_LIMITS } from 'librechat-data-provider';
import type { TTarsMemory, TTarsMemoryType } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';

export interface TarsMemoryError {
  key: TranslationKeys;
  values?: Record<string, number>;
}

/** The categories pwc_tars's extraction prompt writes; anything else shows as stored. */
const CATEGORY_LABELS: Record<string, TranslationKeys> = {
  fact: 'com_ui_tars_memory_category_fact',
  preference: 'com_ui_tars_memory_category_preference',
  requirement: 'com_ui_tars_memory_category_requirement',
  constraint: 'com_ui_tars_memory_category_constraint',
  decision: 'com_ui_tars_memory_category_decision',
};

export const categoryLabelKey = (category: string): TranslationKeys | undefined =>
  CATEGORY_LABELS[category.trim().toLowerCase()];

/** One line of the list: a whole semantic record, or one preference of the profile record. */
export interface TarsMemoryRow {
  key: string;
  memory: TTarsMemory;
  text: string;
  /** The line of `memory.items` this row is; absent on a semantic record. */
  itemIndex?: number;
}

/** The list's rows, preferences first since they apply to every conversation. */
export function toTarsMemoryRows(memories: readonly TTarsMemory[]): TarsMemoryRow[] {
  const preferences: TarsMemoryRow[] = [];
  const highlights: TarsMemoryRow[] = [];
  for (const memory of memories) {
    if (memory.memory_type !== 'profile') {
      highlights.push({ key: memory.id, memory, text: memory.content });
      continue;
    }
    (memory.items ?? []).forEach((text, itemIndex) => {
      preferences.push({ key: `${memory.id}:${itemIndex}`, memory, text, itemIndex });
    });
  }
  return [...preferences, ...highlights];
}

/** The whole profile with this row's line replaced by `text`, which may hold several lines. */
export function withEditedItem({ memory, itemIndex }: TarsMemoryRow, text: string): string {
  return (memory.items ?? []).map((item, index) => (index === itemIndex ? text : item)).join('\n');
}

/** pwc_tars's `_BULLET_PATTERN`: "-" and "*" are bullets only before whitespace, so "-5 度" stays. */
const BULLET_PATTERN = /^(?:[•·]\s*|[-*](?:\s+|$))+/;

/** The lines pwc_tars keeps of an edited profile: bullets and blank lines go. */
export const profileLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim().replace(BULLET_PATTERN, '').trim())
    .filter(Boolean);

/** pwc_tars's profile limits, on the lines given and the size the profile would reach. */
function getProfileError(lines: string[], total: number): TarsMemoryError | null {
  const { profileMaxItems, profileMaxItemChars } = TARS_MEMORY_LIMITS;
  if (lines.length === 0) {
    return { key: 'com_ui_field_required' };
  }
  if (total > profileMaxItems) {
    return { key: 'com_ui_tars_memory_error_profile_items', values: { max: profileMaxItems } };
  }
  return lines.some((line) => line.length > profileMaxItemChars)
    ? { key: 'com_ui_tars_memory_error_profile_length', values: { max: profileMaxItemChars } }
    : null;
}

/** The same limits pwc_tars enforces on save, so a bad edit never leaves the dialog. */
export function getTarsMemoryError(type: TTarsMemoryType, text: string): TarsMemoryError | null {
  if (type === 'profile') {
    const lines = profileLines(text);
    return getProfileError(lines, lines.length);
  }
  const fact = text.split(/\s+/).filter(Boolean).join(' ');
  if (!fact) {
    return { key: 'com_ui_field_required' };
  }
  const { semanticMaxChars: max } = TARS_MEMORY_LIMITS;
  return fact.length > max
    ? { key: 'com_ui_tars_memory_error_semantic_length', values: { max } }
    : null;
}

/** Checks lines being added to a profile that already holds `heldItems`; repeats do not count. */
export function getTarsMemoryAddError(
  text: string,
  heldItems: readonly string[],
): TarsMemoryError | null {
  const lines = profileLines(text);
  return getProfileError(lines, new Set([...heldItems, ...lines]).size);
}

/** What a failed save or delete tells the user, by what the status means for this API. */
export function getTarsMemoryFailureKey(error: unknown): TranslationKeys {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === 404) {
    return 'com_ui_tars_memory_error_stale';
  }
  if (status === 400) {
    return 'com_ui_tars_memory_error_invalid';
  }
  return status === 503 ? 'com_ui_tars_memory_error_load' : 'com_ui_tars_memory_error_save';
}
