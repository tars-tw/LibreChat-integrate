import { useMemo, useState, useCallback } from 'react';
import { Plus, ArrowLeft, Cloud, BookText, User } from 'lucide-react';
import { Spinner, Button, TextareaAutosize } from '@librechat/client';
import type {
  TTarsDomain,
  TTarsPrompt,
  TTarsPromptScope,
  TTarsPromptInput,
  TTarsPromptKnowledgeBase,
} from 'librechat-data-provider';
import { useTarsPromptsQuery, useCreateTarsPromptMutation } from '~/data-provider';
import { extractUniqueVariables, detectVariables } from '~/utils';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const SCOPE_ORDER: TTarsPromptScope[] = ['domain', 'knowledge_base', 'personal'];

const SCOPE_META: Record<TTarsPromptScope, { icon: typeof Cloud; labelKey: string }> = {
  domain: { icon: Cloud, labelKey: 'com_ui_tars_prompts_domain' },
  knowledge_base: { icon: BookText, labelKey: 'com_ui_tars_prompts_kb' },
  personal: { icon: User, labelKey: 'com_ui_tars_prompts_personal' },
};

const fillVariables = (content: string, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (acc, [name, value]) => acc.split(`{{${name}}}`).join(value),
    content,
  );

type Mode = { kind: 'list' } | { kind: 'variables'; prompt: TTarsPrompt } | { kind: 'create' };

/**
 * The "我的提示" panel: lists prompts grouped by tier (specialized brain /
 * knowledge base / personal), fills `{{variables}}` before insertion, and offers
 * quick creation of personal or brain-scoped prompts.
 */
function Panel({ domain, onInsert }: { domain: TTarsDomain; onInsert: (text: string) => void }) {
  const domainId = String(domain.id);
  const { data, isLoading } = useTarsPromptsQuery(domainId);
  const prompts = useMemo(() => data?.prompts ?? [], [data]);
  const knowledgeBases = useMemo(() => data?.knowledgeBases ?? [], [data]);
  const createPrompt = useCreateTarsPromptMutation();

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = (prompt: TTarsPrompt) =>
      !term ||
      prompt.name.toLowerCase().includes(term) ||
      (prompt.category ?? '').toLowerCase().includes(term) ||
      prompt.content.toLowerCase().includes(term);

    return SCOPE_ORDER.map((scope) => ({
      scope,
      items: prompts.filter((prompt) => (prompt.scope ?? 'personal') === scope && matches(prompt)),
    })).filter((group) => group.items.length > 0);
  }, [prompts, search]);

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
    <div className="w-80 rounded-2xl border border-border-light bg-surface-tertiary-alt p-2 shadow-lg sm:w-96">
      {mode.kind === 'list' && (
        <ListView
          isLoading={isLoading}
          grouped={grouped}
          search={search}
          setSearch={setSearch}
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
          domain={domain}
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
    <div className="mb-2 flex items-center gap-2 px-1">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="back"
          className="rounded p-1 text-text-secondary hover:bg-surface-hover"
        >
          <ArrowLeft size={16} aria-hidden={true} />
        </button>
      )}
      <span className="text-sm font-medium text-text-primary">{title}</span>
    </div>
  );
}

function ListView({
  isLoading,
  grouped,
  search,
  setSearch,
  onSelect,
  onCreate,
}: {
  isLoading: boolean;
  grouped: { scope: TTarsPromptScope; items: TTarsPrompt[] }[];
  search: string;
  setSearch: (value: string) => void;
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
        <div className="flex h-24 items-center justify-center px-3 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_prompts_empty')}
        </div>
      );
    }
    return (
      <div className="max-h-72 overflow-y-auto">
        {grouped.map((group) => {
          const { icon: Icon, labelKey } = SCOPE_META[group.scope];
          return (
            <div key={group.scope} className="mb-1">
              <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-secondary">
                <Icon size={13} aria-hidden={true} />
                {localize(labelKey)}
              </div>
              {group.items.map((prompt) => (
                <button
                  key={prompt.id}
                  type="button"
                  onClick={() => onSelect(prompt)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover"
                >
                  <span className="text-sm text-text-primary">{prompt.name}</span>
                  {prompt.category && (
                    <span className="text-xs text-text-secondary">{prompt.category}</span>
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
      <div className="mb-2 flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={localize('com_ui_tars_prompts_search')}
          className="w-full rounded-lg bg-surface-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none"
        />
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
      </div>
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
      <div className="max-h-72 space-y-2 overflow-y-auto px-1">
        {variables.map((variable) => (
          <div key={variable}>
            <label className="mb-1 block text-xs text-text-secondary">{variable}</label>
            <input
              value={values[variable] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [variable]: e.target.value }))}
              className="w-full rounded-lg bg-surface-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end px-1">
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
  domain,
  knowledgeBases,
  isSaving,
  onBack,
  onSubmit,
}: {
  domain: TTarsDomain;
  knowledgeBases: TTarsPromptKnowledgeBase[];
  isSaving: boolean;
  onBack: () => void;
  onSubmit: (input: TTarsPromptInput) => void;
}) {
  const localize = useLocalize();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  /** 'personal' | 'domain' | a knowledge-base id. */
  const [scope, setScope] = useState('personal');

  const variables = useMemo(() => extractUniqueVariables(content), [content]);
  const variableToken = `{{${localize('com_ui_tars_prompts_variable_token')}}}`;

  const canSave = name.trim() && category.trim() && content.trim() && !isSaving;

  const handleSubmit = () => {
    if (!canSave) {
      return;
    }
    const isDomain = scope === 'domain';
    const isKnowledgeBase = scope !== 'personal' && !isDomain;
    onSubmit({
      name: name.trim(),
      category: category.trim(),
      content: content.trim(),
      domain_id: isDomain ? domain.id : undefined,
      knowledge_base_id: isKnowledgeBase ? scope : undefined,
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
          className="w-full rounded-lg bg-surface-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={localize('com_ui_tars_prompts_category')}
          className="w-full rounded-lg bg-surface-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none"
        />
        <TextareaAutosize
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={localize('com_ui_tars_prompts_content_placeholder', { 0: variableToken })}
          minRows={3}
          maxRows={8}
          className="w-full rounded-lg bg-surface-secondary px-3 py-1.5 text-sm text-text-primary focus:outline-none"
        />
        <div>
          <div className="mb-1 text-xs font-medium text-text-secondary">
            {localize('com_ui_tars_prompts_variables')}
          </div>
          {variables.length === 0 ? (
            <span className="text-xs text-text-tertiary">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {variables.map((variable) => (
                <span
                  key={variable}
                  className="rounded bg-surface-tertiary px-1.5 py-0.5 text-xs text-text-primary"
                >
                  {`{{${variable}}}`}
                </span>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-text-secondary">
            {localize('com_ui_tars_prompts_variables_help', { 0: variableToken })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ScopeOption
            active={scope === 'personal'}
            label={localize('com_ui_tars_prompts_personal')}
            onClick={() => setScope('personal')}
          />
          <ScopeOption
            active={scope === 'domain'}
            label={domain.name}
            onClick={() => setScope('domain')}
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
