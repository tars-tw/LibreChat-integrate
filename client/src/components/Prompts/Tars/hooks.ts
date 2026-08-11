import { useMemo } from 'react';
import type { TTarsPrompt } from 'librechat-data-provider';
import { useTarsPersonalPromptsQuery } from '~/data-provider';

/**
 * The management page's prompt source: the user's personal pwc_tars prompts plus
 * the categories derived from them. pwc_tars has no category table — a category
 * only exists as the `category` column of a saved prompt.
 */
export default function useTarsPrompts(): {
  prompts: TTarsPrompt[];
  categories: string[];
  isLoading: boolean;
} {
  const { data, isLoading } = useTarsPersonalPromptsQuery();

  const prompts = useMemo(() => data?.prompts ?? [], [data]);

  const categories = useMemo(() => {
    const unique = new Set<string>();
    for (const prompt of prompts) {
      const category = prompt.category?.trim();
      if (category) {
        unique.add(category);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [prompts]);

  return { prompts, categories, isLoading };
}
