import { useMemo, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, FileText, ChevronDown } from 'lucide-react';
import { Button, Skeleton, FilterInput, TooltipAnchor } from '@librechat/client';
import type { TTarsPrompt } from 'librechat-data-provider';
import type { ChatPromptScope } from './scopes';
import useTarsChatPrompts from '~/hooks/Tars/useTarsChatPrompts';
import { CHAT_PROMPT_SCOPES, PROMPT_SCOPE_META } from './scopes';
import AutoSendPrompt from '../buttons/AutoSendPrompt';
import { usePromptCategoryFilter } from './filter';
import CategoryFilter from './CategoryFilter';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import Item from './Item';

/**
 * The prompts side panel, backed by pwc_tars prompts. On a chat route a card
 * inserts/sends its prompt; on `/prompts` it opens the prompt for editing.
 * Prompts are grouped by tier (the selected agent's picked knowledge bases / personal)
 * and narrowed by search and by one category across every tier, matching the chat
 * composer's prompt panel, with only the personal tier
 * editable/deletable here — brain and knowledge-base prompts are shared and
 * insert-only.
 */
export default function TarsPromptsPanel() {
  const location = useLocation();
  const localize = useLocalize();
  const { data, isLoading } = useTarsChatPrompts();
  const prompts = useMemo(() => data?.prompts ?? [], [data]);

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Partial<Record<ChatPromptScope, boolean>>>({});
  const { categories, selected, setSelected, matchesCategory } = usePromptCategoryFilter(prompts);
  const isChatRoute = location.pathname?.startsWith('/c/') ?? false;

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchesTerm = (prompt: TTarsPrompt) =>
      !term ||
      prompt.name.toLowerCase().includes(term) ||
      prompt.content.toLowerCase().includes(term);

    return CHAT_PROMPT_SCOPES.map((scope) => ({
      scope,
      items: prompts.filter(
        (prompt) =>
          (prompt.scope ?? 'personal') === scope && matchesCategory(prompt) && matchesTerm(prompt),
      ),
    })).filter((group) => group.items.length > 0);
  }, [prompts, search, matchesCategory]);

  const resultCount = grouped.reduce((sum, group) => sum + group.items.length, 0);
  const searchResultsAnnouncement = useMemo(() => {
    if (!search.trim()) {
      return '';
    }
    return resultCount === 1
      ? localize('com_ui_search_result_count', { count: resultCount })
      : localize('com_ui_search_results_count', { count: resultCount });
  }, [search, resultCount, localize]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value),
    [],
  );

  const toggleGroup = useCallback((scope: ChatPromptScope) => {
    setCollapsed((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }, []);

  return (
    <div id="prompts-panel" className="flex h-full w-full flex-col space-y-2 pt-2">
      <div className="text-text-primary flex h-full min-h-0 scrollbar-gutter-stable flex-col gap-2 overflow-x-hidden overflow-y-auto pr-1 pl-3">
        <div className="shrink-0 space-y-2">
          <div role="search" className="flex items-center gap-2">
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              {searchResultsAnnouncement}
            </div>
            <FilterInput
              inputId="prompts-filter"
              label={localize('com_ui_filter_prompts_name')}
              value={search}
              onChange={handleSearchChange}
              containerClassName="flex-1"
            />
            <TooltipAnchor
              description={localize('com_ui_create_prompt')}
              side="bottom"
              render={
                <Button
                  asChild
                  variant="outline"
                  size="icon"
                  className="size-9 shrink-0 bg-transparent"
                  aria-label={localize('com_ui_create_prompt')}
                >
                  <Link to="/prompts/new">
                    <Plus className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              }
            />
          </div>
          {!isLoading && categories.length > 0 && (
            <CategoryFilter categories={categories} selected={selected} onSelect={setSelected} />
          )}
          <AutoSendPrompt />
        </div>
        <section className="flex-grow" aria-label={localize('com_ui_prompt_groups')}>
          {isLoading &&
            Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="mb-1.5 h-[72px] w-full rounded-xl" />
            ))}
          {!isLoading && grouped.length === 0 && (
            <div className="border-border-medium my-2 flex flex-col items-center justify-center rounded-lg border bg-transparent p-6 text-center">
              <div className="bg-surface-tertiary mb-2 flex size-10 items-center justify-center rounded-full">
                <FileText className="text-text-secondary size-5" aria-hidden="true" />
              </div>
              <p className="text-text-primary text-sm font-medium">
                {localize('com_ui_no_prompts_title')}
              </p>
              <p className="text-text-secondary mt-0.5 text-xs">
                {localize('com_ui_add_first_prompt')}
              </p>
            </div>
          )}
          {!isLoading &&
            grouped.map((group) => {
              const { icon: Icon, labelKey, colorClass } = PROMPT_SCOPE_META[group.scope];
              const isCollapsed = collapsed[group.scope] ?? false;
              return (
                <div key={group.scope} className="mb-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.scope)}
                    aria-expanded={!isCollapsed}
                    className="hover:bg-surface-hover mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs font-semibold tracking-wide uppercase"
                  >
                    <Icon className={cn('size-3.5 shrink-0', colorClass)} aria-hidden="true" />
                    <span className={colorClass}>{localize(labelKey)}</span>
                    <span className="text-text-tertiary">({group.items.length})</span>
                    <ChevronDown
                      className={cn(
                        'text-text-secondary ml-auto size-3.5 shrink-0 transition-transform',
                        isCollapsed && '-rotate-90',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  {!isCollapsed &&
                    group.items.map((prompt) => (
                      <Item key={prompt.id} prompt={prompt} isChatRoute={isChatRoute} />
                    ))}
                </div>
              );
            })}
        </section>
      </div>
    </div>
  );
}
