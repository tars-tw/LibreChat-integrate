import { useMemo, useState, useCallback } from 'react';
import type { TTarsPrompt } from 'librechat-data-provider';

export const ALL_CATEGORIES = '__all__';
export const UNCATEGORIZED = '__uncategorized__';

export type PromptCategory = { value: string; count: number };

/** The filter key of a prompt's category: trimmed, or `UNCATEGORIZED` when blank. */
export const promptCategoryKey = (prompt: Pick<TTarsPrompt, 'category'>): string =>
  prompt.category?.trim() || UNCATEGORIZED;

/**
 * The categories used by `prompts`, with how many prompts use each. Tiers keep
 * their categories apart in pwc_tars, but a filter spans every tier, so a name
 * shared by personal and knowledge-base prompts is one entry. Sorted by name,
 * with uncategorized prompts last.
 */
export function summarizePromptCategories(
  prompts: readonly Pick<TTarsPrompt, 'category'>[],
): PromptCategory[] {
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    const key = promptCategoryKey(prompt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => {
    if (a.value === UNCATEGORIZED) {
      return 1;
    }
    if (b.value === UNCATEGORIZED) {
      return -1;
    }
    return a.value.localeCompare(b.value);
  });
}

/**
 * One category picked out of `prompts` (`ALL_CATEGORIES` = no filter). A pick
 * no longer among the prompts' categories, as after switching agents, reads as
 * `ALL_CATEGORIES`, so the list never filters down to nothing on its own.
 */
export function usePromptCategoryFilter(prompts: readonly TTarsPrompt[]) {
  const [picked, setPicked] = useState<string>(ALL_CATEGORIES);
  const categories = useMemo(() => summarizePromptCategories(prompts), [prompts]);
  const selected = categories.some((category) => category.value === picked)
    ? picked
    : ALL_CATEGORIES;

  const matchesCategory = useCallback(
    (prompt: TTarsPrompt) => selected === ALL_CATEGORIES || promptCategoryKey(prompt) === selected,
    [selected],
  );

  return { categories, selected, setSelected: setPicked, matchesCategory };
}
