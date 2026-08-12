import { useMemo, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, FileText, ListFilter } from 'lucide-react';
import { Button, Dropdown, Skeleton, FilterInput, TooltipAnchor } from '@librechat/client';
import type { Option } from '~/common';
import AutoSendPrompt from '../buttons/AutoSendPrompt';
import { useLocalize } from '~/hooks';
import useTarsPrompts from './hooks';
import Item from './Item';

const ALL_CATEGORIES = '__all__';

/**
 * The prompts side panel, backed by pwc_tars personal prompts. On a chat route a
 * card inserts/sends its prompt; on `/prompts` it opens the prompt for editing.
 */
export default function TarsPromptsPanel() {
  const location = useLocation();
  const localize = useLocalize();
  const { prompts, categories, isLoading } = useTarsPrompts();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const isChatRoute = location.pathname?.startsWith('/c/') ?? false;

  const filterOptions: Option[] = useMemo(
    () => [
      { value: ALL_CATEGORIES, label: localize('com_ui_all_proper') },
      ...categories.map((name) => ({ value: name, label: name })),
    ],
    [categories, localize],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return prompts.filter((prompt) => {
      if (category !== ALL_CATEGORIES && (prompt.category ?? '') !== category) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        prompt.name.toLowerCase().includes(term) || prompt.content.toLowerCase().includes(term)
      );
    });
  }, [prompts, category, search]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value),
    [],
  );

  return (
    <div id="prompts-panel" className="flex h-full w-full flex-col space-y-2 pt-2">
      <div className="scrollbar-gutter-stable flex h-full min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pl-3 pr-1 text-text-primary">
        <div className="shrink-0 space-y-2">
          <div role="search" className="flex items-center gap-2">
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
          {!isLoading && filtered.length === 0 && (
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
          {filtered.map((prompt) => (
            <Item key={prompt.id} prompt={prompt} isChatRoute={isChatRoute} />
          ))}
        </section>
      </div>
    </div>
  );
}
