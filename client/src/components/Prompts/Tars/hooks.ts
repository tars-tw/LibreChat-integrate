import { useMemo } from 'react';
import type { TTarsPrompt } from 'librechat-data-provider';
import {
  useTarsPromptsQuery,
  useTarsPersonalPromptsQuery,
  useTarsKnowledgeBasePromptsQuery,
} from '~/data-provider';

const uniqueCategories = (prompts: TTarsPrompt[]): string[] => {
  const unique = new Set<string>();
  for (const prompt of prompts) {
    const category = prompt.category?.trim();
    if (category) {
      unique.add(category);
    }
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
};

/**
 * The `/prompts` management page's prompt source, scoped to whichever tier
 * the route names: a specialized brain's own prompts, a knowledge base's own
 * prompts, or (neither id given) the user's personal prompts. Shared by the
 * page's list and its create/edit form so they always agree on "this scope's
 * prompts" and on where "create new" / "back to the list" should navigate.
 */
export default function useScopedTarsPrompts({
  domainId,
  knowledgeBaseId,
}: {
  domainId?: string;
  knowledgeBaseId?: string;
}): {
  prompts: TTarsPrompt[];
  categories: string[];
  isLoading: boolean;
  basePath: string;
} {
  const personalQuery = useTarsPersonalPromptsQuery({
    enabled: domainId == null && knowledgeBaseId == null,
  });
  const domainQuery = useTarsPromptsQuery(domainId ?? null, { enabled: domainId != null });
  const kbQuery = useTarsKnowledgeBasePromptsQuery(knowledgeBaseId ?? null, {
    enabled: knowledgeBaseId != null,
  });

  return useMemo(() => {
    if (knowledgeBaseId != null) {
      const prompts = kbQuery.data ?? [];
      return {
        prompts,
        categories: uniqueCategories(prompts),
        isLoading: kbQuery.isLoading,
        basePath: `/prompts/knowledge-base/${knowledgeBaseId}`,
      };
    }
    if (domainId != null) {
      const prompts = (domainQuery.data?.prompts ?? []).filter(
        (prompt) => (prompt.scope ?? 'personal') === 'domain',
      );
      return {
        prompts,
        categories: uniqueCategories(prompts),
        isLoading: domainQuery.isLoading,
        basePath: `/prompts/domain/${domainId}`,
      };
    }
    const prompts = personalQuery.data?.prompts ?? [];
    return {
      prompts,
      categories: uniqueCategories(prompts),
      isLoading: personalQuery.isLoading,
      basePath: '/prompts',
    };
  }, [
    domainId,
    knowledgeBaseId,
    kbQuery.data,
    kbQuery.isLoading,
    domainQuery.data,
    domainQuery.isLoading,
    personalQuery.data,
    personalQuery.isLoading,
  ]);
}
