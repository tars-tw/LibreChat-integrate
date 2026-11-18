import { useMemo, useState, useCallback } from 'react';
import { Plus, ArrowLeft, ChevronDown } from 'lucide-react';
import { Spinner, Button, TextareaAutosize } from '@librechat/client';
import type {
  TTarsPrompt,
  TTarsPromptInput,
  TTarsPromptKnowledgeBase,
} from 'librechat-data-provider';
import type { ChatPromptScope } from '~/components/Prompts/Tars/scopes';
import type { PromptCategory } from '~/components/Prompts/Tars/filter';
import { CHAT_PROMPT_SCOPES, PROMPT_SCOPE_META } from '~/components/Prompts/Tars/scopes';
import { usePromptCategoryFilter } from '~/components/Prompts/Tars/filter';
import CategoryFilter from '~/components/Prompts/Tars/CategoryFilter';
import { extractUniqueVariables, detectVariables } from '~/utils';
import useTarsChatPrompts from '~/hooks/Tars/useTarsChatPrompts';
import { useCreateTarsPromptMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Quick-create ("+") is hidden in TARS; prompts are created from the prompts side panel. */
const SHOW_QUICK_CREATE = false;

const fillVariables = (content: string, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (acc, [name, value]) => acc.split(`{{${name}}}`).join(value),
    content,
  );

type Mode = { kind: 'list' } | { kind: 'variables'; prompt: TTarsPrompt } | { kind: 'create' };

/**
 * The "我的提示" panel: lists prompts grouped by tier (the selected agent's picked
 * knowledge bases / personal), each group collapsible, narrowed by search and by
 * one category across every tier; fills `{{variables}}` before insertion, and
 * offers quick creation of personal or knowledge-base prompts.
 */
function Panel({
  onInsert,
  maxHeight,
}: {
  onInsert: (text: string) => void;
  /** The room above the composer button, so a tall list scrolls instead of leaving the screen. */
  maxHeight?: number;
}) {
  const { data, isLoading } = useTarsChatPrompts();
  const prompts = useMemo(() => data?.prompts ?? [], [data]);
  const knowledgeBases = useMemo(() => data?.knowledgeBases ?? [], [data]);
  const createPrompt = useCreateTarsPromptMutation();

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Partial<Record<ChatPromptScope, boolean>>>({});
  const { categories, selected, setSelected, matchesCategory } = usePromptCategoryFilter(prompts);

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchesTerm = (prompt: TTarsPrompt) =>
      !term ||
      prompt.name.toLowerCase().includes(term) ||
      (prompt.command ?? '').toLowerCase().includes(term) ||
      (prompt.category ?? '').toLowerCase().includes(term) ||
      prompt.content.toLowerCase().includes(term);

    return CHAT_PROMPT_SCOPES.map((scope) => ({
      scope,
      items: prompts.filter(
        (prompt) =>
          (prompt.scope ?? 'personal') === scope && matchesCategory(prompt) && matchesTerm(prompt),
      ),
    })).filter((group) => group.items.length > 0);
  }, [prompts, search, matchesCategory]);

  const toggleGroup = useCallback((scope: ChatPromptScope) => {
    setCollapsed((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }, []);

  const handleSelect = useCallback(
    (prompt: TTarsPrompt) => {
      if (detectVariables(prompt.content)) {
        setMode({ kind: 'variables', prompt });
        return;
      }
      onInsert(prompt.content);
    },
    [onInsert],
  );

  return (
    <div
      className="border-border-light bg-surface-tertiary-alt flex w-80 flex-col rounded-2xl border p-2 shadow-lg sm:w-96"
      style={{ maxHeight }}
    >
      {mode.kind === 'list' && (
        <ListView
          isLoading={isLoading}
          grouped={grouped}
          search={search}
          setSearch={setSearch}
          categories={categories}
          selectedCategory={selected}
          onSelectCategory={setSelected}
          collapsed={collapsed}
          onToggleGroup={toggleGroup}
          onSelect={handleSelect}
          onCreate={() => setMode({ kind: 'create' })}
        />
      )}
      {mode.kind === 'variables' && (
        <VariablesView
          prompt={mode.prompt}
          onBack={() => setMode({ kind: 'list' })}
          onInsert={onInsert}
        />
      )}
      {mode.kind === 'create' && (
        <CreateView
          knowledgeBases={knowledgeBases}
          isSaving={createPrompt.isLoading}
          onBack={() => setMode({ kind: 'list' })}
          onSubmit={(input) =>
            createPrompt.mutate(input, { onSuccess: () => setMode({ kind: 'list' }) })
          }
        />
      )}
    </div>
  );
}

function PanelHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="mb-2 flex shrink-0 items-center gap-2 px-1">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="back"
          className="text-text-secondary hover:bg-surface-hover rounded p-1"
        >
          <ArrowLeft size={16} aria-hidden={true} />
        </button>
      )}
      <span className="text-text-primary text-sm font-medium">{title}</span>
    </div>
  );
}

function ListView({
  isLoading,
  grouped,
  search,
  setSearch,
  categories,
  selectedCategory,
  onSelectCategory,
  collapsed,
  onToggleGroup,
  onSelect,
  onCreate,
}: {
  isLoading: boolean;
  grouped: { scope: ChatPromptScope; items: TTarsPrompt[] }[];
  search: string;
  setSearch: (value: string) => void;
  categories: PromptCategory[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  collapsed: Partial<Record<ChatPromptScope, boolean>>;
  onToggleGroup: (scope: ChatPromptScope) => void;
  onSelect: (prompt: TTarsPrompt) => void;
  onCreate: () => void;
}) {
  const localize = useLocalize();

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      );
    }
    if (grouped.length === 0) {
      return (
        <div className="text-text-secondary flex h-24 items-center justify-center px-3 text-center text-sm">
          {localize('com_ui_tars_prompts_empty')}
        </div>
      );
    }
    return (
      <div className="max-h-72 min-h-0 overflow-y-auto">
        {grouped.map((group) => {
          const { icon: Icon, labelKey, colorClass } = PROMPT_SCOPE_META[group.scope];
          const isCollapsed = collapsed[group.scope] ?? false;
          return (
            <div
              key={group.scope}
              className="border-border-light mb-1 border-t pt-1 first:border-t-0 first:pt-0"
            >
              <button
                type="button"
                onClick={() => onToggleGroup(group.scope)}
                aria-expanded={!isCollapsed}
                className="hover:bg-surface-hover flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold"
              >
                <Icon className={cn('size-3.5 shrink-0', colorClass)} aria-hidden={true} />
                <span className={colorClass}>{localize(labelKey)}</span>
                <span className="text-text-tertiary">({group.items.length})</span>
                <ChevronDown
                  className={cn(
                    'text-text-secondary ml-auto size-3.5 shrink-0 transition-transform',
                    isCollapsed && '-rotate-90',
                  )}
                  aria-hidden={true}
                />
              </button>
              {!isCollapsed &&
                group.items.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => onSelect(prompt)}
                    className="hover:bg-surface-hover flex w-full flex-col items-start gap-0.5 rounded-lg py-1.5 pr-2 pl-7 text-left"
                  >
                    <span className="text-text-primary text-sm">{prompt.name}</span>
                    {prompt.category && (
                      <span className="text-text-secondary text-xs">{prompt.category}</span>
                    )}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={localize('com_ui_tars_prompts_search')}
          className="bg-surface-secondary text-text-primary w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        />
        {SHOW_QUICK_CREATE && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={localize('com_ui_tars_prompts_new')}
            onClick={onCreate}
            className="shrink-0"
          >
            <Plus size={16} aria-hidden={true} />
          </Button>
        )}
      </div>
      {!isLoading && categories.length > 0 && (
        <CategoryFilter
          categories={categories}
          selected={selectedCategory}
          onSelect={onSelectCategory}
          className="shrink-0"
        />
      )}
      {renderBody()}
    </>
  );
}

function VariablesView({
  prompt,
  onBack,
  onInsert,
}: {
  prompt: TTarsPrompt;
  onBack: () => void;
  onInsert: (text: string) => void;
}) {
  const localize = useLocalize();
  const variables = useMemo(() => extractUniqueVariables(prompt.content), [prompt.content]);
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <>
      <PanelHeader title={prompt.name} onBack={onBack} />
      <div className="max-h-72 min-h-0 space-y-2 overflow-y-auto px-1">
        {variables.map((variable) => (
          <div key={variable}>
            <label className="text-text-secondary mb-1 block text-xs">{variable}</label>
            <input
              value={values[variable] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [variable]: e.target.value }))}
              className="bg-surface-secondary text-text-primary w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex shrink-0 justify-end px-1">
        <Button
          type="button"
          variant="submit"
          size="sm"
          onClick={() => onInsert(fillVariables(prompt.content, values))}
        >
          {localize('com_ui_tars_prompts_insert')}
        </Button>
      </div>
    </>
  );
}

function CreateView({
  knowledgeBases,
  isSaving,
  onBack,
  onSubmit,
}: {
  knowledgeBases: TTarsPromptKnowledgeBase[];
  isSaving: boolean;
  onBack: () => void;
  onSubmit: (input: TTarsPromptInput) => void;
}) {
  const localize = useLocalize();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  /** 'personal' | a knowledge-base id. */
  const [scope, setScope] = useState('personal');

  const variables = useMemo(() => extractUniqueVariables(content), [content]);
  const variableToken = `{{${localize('com_ui_tars_prompts_variable_token')}}}`;

  const canSave = name.trim() && category.trim() && content.trim() && !isSaving;

  const handleSubmit = () => {
    if (!canSave) {
      return;
    }
    onSubmit({
      name: name.trim(),
      category: category.trim(),
      content: content.trim(),
      knowledge_base_id: scope !== 'personal' ? scope : undefined,
    });
  };

  return (
    <>
      <PanelHeader title={localize('com_ui_tars_prompts_new')} onBack={onBack} />
      <div className="space-y-2 px-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={localize('com_ui_tars_prompts_name')}
          className="bg-surface-secondary text-text-primary w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={localize('com_ui_tars_prompts_category')}
          className="bg-surface-secondary text-text-primary w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        />
        <TextareaAutosize
          aria-label={localize('com_ui_tars_prompts_content')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={localize('com_ui_tars_prompts_content_placeholder', { 0: variableToken })}
          minRows={3}
          maxRows={8}
          className="bg-surface-secondary text-text-primary w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        />
        <div>
          <div className="text-text-secondary mb-1 text-xs font-medium">
            {localize('com_ui_tars_prompts_variables')}
          </div>
          {variables.length === 0 ? (
            <span className="text-text-tertiary text-xs">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {variables.map((variable) => (
                <span
                  key={variable}
                  className="bg-surface-tertiary text-text-primary rounded px-1.5 py-0.5 text-xs"
                >
                  {`{{${variable}}}`}
                </span>
              ))}
            </div>
          )}
          <p className="text-text-secondary mt-1 text-xs">
            {localize('com_ui_tars_prompts_variables_help', { 0: variableToken })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ScopeOption
            active={scope === 'personal'}
            label={localize('com_ui_tars_prompts_personal')}
            onClick={() => setScope('personal')}
          />
          {knowledgeBases.map((kb) => (
            <ScopeOption
              key={kb.id}
              active={scope === kb.id}
              label={kb.name}
              onClick={() => setScope(kb.id)}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 flex justify-end px-1">
        <Button type="button" variant="submit" size="sm" disabled={!canSave} onClick={handleSubmit}>
          {isSaving ? <Spinner className="size-4" /> : localize('com_ui_save')}
        </Button>
      </div>
    </>
  );
}

function ScopeOption({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 truncate rounded-lg border px-2 py-1 text-xs transition-colors',
        active
          ? 'border-border-medium bg-surface-secondary text-text-primary'
          : 'border-border-light text-text-secondary hover:bg-surface-hover',
      )}
    >
      {label}
    </button>
  );
}

export default Panel;
