import { useMemo } from 'react';
import type { TTarsPrompt } from 'librechat-data-provider';
import {
  useTarsPromptsQuery,
  useTarsAgentPromptsQuery,
  useTarsPersonalPromptsQuery,
  useTarsKnowledgeBasePromptsQuery,
} from '~/data-provider';

/** A scope's categories (trimmed, sorted) and how many of its prompts use each. */
const summarizeCategories = (
  prompts: TTarsPrompt[],
): { categories: string[]; categoryCounts: Record<string, number> } => {
  const categoryCounts: Record<string, number> = {};
  for (const prompt of prompts) {
    const category = prompt.category?.trim();
    if (category) {
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }
  }
  const categories = Object.keys(categoryCounts).sort((a, b) => a.localeCompare(b));
  return { categories, categoryCounts };
};

/**
 * The `/prompts` management page's prompt source, scoped to whichever tier
 * the route names: a saved agent's own prompts, a specialized brain's own
 * prompts, a knowledge base's own prompts, or (no id given) the user's personal
 * prompts. Shared by the page's list and its create/edit form so they always
 * agree on "this scope's prompts" and on where "create new" / "back to the list"
 * should navigate. `isError` is set when the scope cannot be read, which for an
 * agent means the caller may not edit it.
 */
export default function useScopedTarsPrompts({
  domainId,
  knowledgeBaseId,
  agentId,
}: {
  domainId?: string;
  knowledgeBaseId?: string;
  agentId?: string;
}): {
  prompts: TTarsPrompt[];
  categories: string[];
  categoryCounts: Record<string, number>;
  isLoading: boolean;
  isError: boolean;
  basePath: string;
} {
  const personalQuery = useTarsPersonalPromptsQuery({
    enabled: domainId == null && knowledgeBaseId == null && agentId == null,
  });
  const domainQuery = useTarsPromptsQuery(domainId ?? null, { enabled: domainId != null });
  const kbQuery = useTarsKnowledgeBasePromptsQuery(knowledgeBaseId ?? null, {
    enabled: knowledgeBaseId != null,
  });
  const agentQuery = useTarsAgentPromptsQuery(agentId ?? null);

  return useMemo(() => {
    if (agentId != null) {
      const prompts = agentQuery.data ?? [];
      return {
        prompts,
        ...summarizeCategories(prompts),
        isLoading: agentQuery.isLoading,
        isError: agentQuery.isError,
        basePath: `/prompts/agent/${agentId}`,
      };
    }
    if (knowledgeBaseId != null) {
      const prompts = kbQuery.data ?? [];
      return {
        prompts,
        ...summarizeCategories(prompts),
        isLoading: kbQuery.isLoading,
        isError: kbQuery.isError,
        basePath: `/prompts/knowledge-base/${knowledgeBaseId}`,
      };
    }
    if (domainId != null) {
      const prompts = (domainQuery.data?.prompts ?? []).filter(
        (prompt) => (prompt.scope ?? 'personal') === 'domain',
      );
      return {
        prompts,
        ...summarizeCategories(prompts),
        isLoading: domainQuery.isLoading,
        isError: domainQuery.isError,
        basePath: `/prompts/domain/${domainId}`,
      };
    }
    const prompts = personalQuery.data?.prompts ?? [];
    return {
      prompts,
      ...summarizeCategories(prompts),
      isLoading: personalQuery.isLoading,
      isError: personalQuery.isError,
      basePath: '/prompts',
    };
  }, [
    agentId,
    domainId,
    knowledgeBaseId,
    agentQuery.data,
    agentQuery.isLoading,
    agentQuery.isError,
    kbQuery.data,
    kbQuery.isLoading,
    kbQuery.isError,
    domainQuery.data,
    domainQuery.isLoading,
    domainQuery.isError,
    personalQuery.data,
    personalQuery.isLoading,
    personalQuery.isError,
  ]);
}
