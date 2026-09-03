import { useMemo, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, FileText, ListFilter } from 'lucide-react';
import {
  Button,
  Dropdown,
  Spinner,
  OGDialog,
  FilterInput,
  TooltipAnchor,
  OGDialogTemplate,
} from '@librechat/client';
import type { TTarsPrompt } from 'librechat-data-provider';
import type { Option } from '~/common';
import { useDeleteTarsPromptMutation } from '~/data-provider';
import useScopedTarsPrompts from './hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const ALL_CATEGORIES = '__all__';

/**
 * The `/prompts` management page's left panel: this scope's prompts (see
 * `useScopedTarsPrompts`), filterable, with create/delete. Unlike the chat
 * sidebar's `TarsPromptsPanel` (insert-on-click, personal-only edit), every
 * row here is fully manageable — this page IS the editor for its scope.
 */
export default function TarsPromptList({
  domainId,
  knowledgeBaseId,
  activePromptId,
}: {
  domainId?: string;
  knowledgeBaseId?: string;
  activePromptId?: string;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { prompts, categories, isLoading, basePath } = useScopedTarsPrompts({
    domainId,
    knowledgeBaseId,
  });

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [deleting, setDeleting] = useState<TTarsPrompt | null>(null);

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

  const deletePrompt = useDeleteTarsPromptMutation({
    onSuccess: () => {
      const wasActive = deleting != null && activePromptId === String(deleting.id);
      setDeleting(null);
      if (wasActive) {
        navigate(`${basePath}/new`, { replace: true });
      }
    },
  });

  return (
    <div className="flex h-full w-72 shrink-0 flex-col gap-2 overflow-hidden border-r border-border-light p-2 sm:w-80">
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
          inputId="tars-prompt-list-filter"
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
              <Link to={`${basePath}/new`}>
                <Plus className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {isLoading && (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <FileText className="size-6 text-text-tertiary" aria-hidden="true" />
            <p className="text-sm font-medium text-text-primary">
              {localize('com_ui_no_prompts_title')}
            </p>
            <p className="text-xs text-text-secondary">{localize('com_ui_add_first_prompt')}</p>
          </div>
        )}
        {filtered.map((prompt) => {
          const isActive = activePromptId === String(prompt.id);
          return (
            <div
              key={prompt.id}
              className={cn(
                'group/prompt relative rounded-xl border border-border-light bg-transparent transition-colors hover:bg-surface-secondary',
                isActive && 'bg-surface-hover',
              )}
            >
              <Link
                to={`${basePath}/${prompt.id}`}
                className="block min-w-0 px-3 py-2.5 pr-9"
                title={prompt.name}
              >
                <span className="block truncate text-sm font-semibold text-text-primary">
                  {prompt.name}
                </span>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-secondary">
                  {prompt.description?.trim() ? prompt.description : prompt.content}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => setDeleting(prompt)}
                aria-label={localize('com_ui_delete')}
                title={localize('com_ui_delete')}
                className="absolute right-2 top-2.5 flex size-6 items-center justify-center rounded-md text-text-secondary opacity-0 transition-opacity hover:bg-surface-hover focus-visible:opacity-100 group-hover/prompt:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <OGDialog open={deleting != null} onOpenChange={(open) => !open && setDeleting(null)}>
        <OGDialogTemplate
          title={localize('com_ui_delete_prompt')}
          className="w-11/12 max-w-md"
          main={
            deleting != null ? (
              <p className="text-sm text-text-secondary">
                {localize('com_ui_prompt_delete_confirm', { 0: deleting.name })}
              </p>
            ) : null
          }
          buttons={
            <Button
              variant="destructive"
              disabled={deletePrompt.isLoading}
              onClick={() =>
                deleting != null &&
                deletePrompt.mutate({ id: String(deleting.id), domainId, knowledgeBaseId })
              }
            >
              {deletePrompt.isLoading ? <Spinner className="size-4" /> : localize('com_ui_delete')}
            </Button>
          }
        />
      </OGDialog>
    </div>
  );
}
