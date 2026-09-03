import { useMemo, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, Dropdown, Skeleton, FilterInput, TooltipAnchor } from '@librechat/client';
import { Plus, Cloud, User, FileText, BookText, ListFilter, ChevronDown } from 'lucide-react';
import type { TTarsPrompt, TTarsPromptScope } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import type { Option } from '~/common';
import AutoSendPrompt from '../buttons/AutoSendPrompt';
import { useTarsPromptsQuery } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import Item from './Item';

const ALL_CATEGORIES = '__all__';

const SCOPE_ORDER: TTarsPromptScope[] = ['domain', 'knowledge_base', 'personal'];

const SCOPE_META: Record<
  TTarsPromptScope,
  { icon: typeof Cloud; labelKey: TranslationKeys; colorClass: string }
> = {
  domain: { icon: Cloud, labelKey: 'com_ui_tars_prompts_domain', colorClass: 'text-blue-500' },
  knowledge_base: {
    icon: BookText,
    labelKey: 'com_ui_tars_prompts_kb',
    colorClass: 'text-purple-400',
  },
  personal: {
    icon: User,
    labelKey: 'com_ui_tars_prompts_personal',
    colorClass: 'text-text-secondary',
  },
};

/**
 * The prompts side panel, backed by pwc_tars prompts. On a chat route a card
 * inserts/sends its prompt; on `/prompts` it opens the prompt for editing.
 * Prompts are grouped by tier (specialized brain / knowledge base / personal),
 * matching the chat composer's prompt panel, with only the personal tier
 * editable/deletable here — brain and knowledge-base prompts are shared and
 * insert-only.
 */
export default function TarsPromptsPanel() {
  const location = useLocation();
  const localize = useLocalize();
  const { conversation } = useChatContext();
  const domainId = conversation?.domain_id ?? null;
  const { data, isLoading } = useTarsPromptsQuery(domainId, { enabled: true });
  const prompts = useMemo(() => data?.prompts ?? [], [data]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [collapsed, setCollapsed] = useState<Partial<Record<TTarsPromptScope, boolean>>>({});
  const isChatRoute = location.pathname?.startsWith('/c/') ?? false;

  const categories = useMemo(() => {
    const unique = new Set<string>();
    for (const prompt of prompts) {
      const name = prompt.category?.trim();
      if (name) {
        unique.add(name);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [prompts]);

  const filterOptions: Option[] = useMemo(
    () => [
      { value: ALL_CATEGORIES, label: localize('com_ui_all_proper') },
      ...categories.map((name) => ({ value: name, label: name })),
    ],
    [categories, localize],
  );

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = (prompt: TTarsPrompt) => {
      if (category !== ALL_CATEGORIES && (prompt.category ?? '') !== category) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        prompt.name.toLowerCase().includes(term) || prompt.content.toLowerCase().includes(term)
      );
    };

    return SCOPE_ORDER.map((scope) => ({
      scope,
      items: prompts.filter((prompt) => (prompt.scope ?? 'personal') === scope && matches(prompt)),
    })).filter((group) => group.items.length > 0);
  }, [prompts, category, search]);

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

  const toggleGroup = useCallback((scope: TTarsPromptScope) => {
    setCollapsed((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }, []);

  return (
    <div id="prompts-panel" className="flex h-full w-full flex-col space-y-2 pt-2">
      <div className="scrollbar-gutter-stable flex h-full min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pl-3 pr-1 text-text-primary">
        <div className="shrink-0 space-y-2">
          <div role="search" className="flex items-center gap-2">
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              {searchResultsAnnouncement}
            </div>
            <Dropdown
              value={category}
              onChange={setCategory}
              options={filterOptions}
              className="shrink-0 rounded-lg bg-transparent [&>button]:size-9"
              icon={<ListFilter className="h-4 w-4" />}
              label="Filter: "
              ariaLabel={localize('com_ui_filter_prompts')}
              iconOnly
            />
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
          <AutoSendPrompt />
        </div>
        <section className="flex-grow" aria-label={localize('com_ui_prompt_groups')}>
          {isLoading &&
            Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="mb-1.5 h-[72px] w-full rounded-xl" />
            ))}
          {!isLoading && grouped.length === 0 && (
            <div className="my-2 flex flex-col items-center justify-center rounded-lg border border-border-medium bg-transparent p-6 text-center">
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-surface-tertiary">
                <FileText className="size-5 text-text-secondary" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-text-primary">
                {localize('com_ui_no_prompts_title')}
              </p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {localize('com_ui_add_first_prompt')}
              </p>
            </div>
          )}
          {!isLoading &&
            grouped.map((group) => {
              const { icon: Icon, labelKey, colorClass } = SCOPE_META[group.scope];
              const isCollapsed = collapsed[group.scope] ?? false;
              return (
                <div key={group.scope} className="mb-2">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.scope)}
                    aria-expanded={!isCollapsed}
                    className="mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wide hover:bg-surface-hover"
                  >
                    <Icon className={cn('size-3.5 shrink-0', colorClass)} aria-hidden="true" />
                    <span className={colorClass}>{localize(labelKey)}</span>
                    <span className="text-text-tertiary">({group.items.length})</span>
                    <ChevronDown
                      className={cn(
                        'ml-auto size-3.5 shrink-0 text-text-secondary transition-transform',
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
