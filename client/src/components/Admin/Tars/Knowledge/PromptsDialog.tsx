import { useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import {
  Input,
  Button,
  Label,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  TextareaAutosize,
  useToastContext,
} from '@librechat/client';
import type { TTarsPrompt, TTarsPromptInput } from 'librechat-data-provider';
import {
  useTarsKnowledgeBasePromptsQuery,
  useCreateTarsPromptMutation,
  useUpdateTarsPromptMutation,
  useDeleteTarsPromptMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

type Mode = { kind: 'list' } | { kind: 'form'; prompt?: TTarsPrompt };

const emptyForm = { name: '', category: '', content: '', description: '' };

/**
 * A knowledge base's own "提示" (`prompt_to_knowledge_base`), reachable from
 * its admin card/row — mirrors pwc_tars's own KM-scoped prompt manager
 * (`/ai-factory/prompt-management/km/:id`). Deliberately its own list+form,
 * not the chat sidebar's `TarsPromptsPanel`/`TarsPromptForm`: this is an
 * admin dialog over one knowledge base, not a per-user page.
 */
export default function KnowledgePromptsDialog({
  knowledgeBaseId,
  knowledgeBaseName,
  onClose,
}: {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const promptsQuery = useTarsKnowledgeBasePromptsQuery(knowledgeBaseId);

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<TTarsPrompt | null>(null);
  const [form, setForm] = useState(emptyForm);

  const filtered = useMemo(() => {
    const prompts = promptsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) {
      return prompts;
    }
    return prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(term) || prompt.content.toLowerCase().includes(term),
    );
  }, [promptsQuery.data, search]);

  const createMutation = useCreateTarsPromptMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_prompt_saved'), status: 'success' });
      setMode({ kind: 'list' });
    },
    onError: () => showToast({ message: localize('com_ui_prompt_save_error'), status: 'error' }),
  });
  const updateMutation = useUpdateTarsPromptMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_prompt_saved'), status: 'success' });
      setMode({ kind: 'list' });
    },
    onError: () => showToast({ message: localize('com_ui_prompt_update_error'), status: 'error' }),
  });
  const deleteMutation = useDeleteTarsPromptMutation({
    onSuccess: () => setDeleting(null),
    onError: () => showToast({ message: localize('com_ui_prompt_delete_error'), status: 'error' }),
  });

  const isSaving = createMutation.isLoading || updateMutation.isLoading;
  const canSave = form.name.trim() && form.category.trim() && form.content.trim() && !isSaving;
  const saveLabel =
    mode.kind === 'form' && mode.prompt
      ? localize('com_ui_update')
      : localize('com_ui_create_prompt');

  const openCreate = () => {
    setForm(emptyForm);
    setMode({ kind: 'form' });
  };

  const openEdit = (prompt: TTarsPrompt) => {
    setForm({
      name: prompt.name,
      category: prompt.category ?? '',
      content: prompt.content,
      description: prompt.description ?? '',
    });
    setMode({ kind: 'form', prompt });
  };

  const handleSave = () => {
    const payload: TTarsPromptInput = {
      name: form.name.trim(),
      category: form.category.trim(),
      content: form.content,
      description: form.description.trim(),
      knowledge_base_id: knowledgeBaseId,
    };
    if (mode.kind === 'form' && mode.prompt) {
      updateMutation.mutate({ id: mode.prompt.id, data: payload });
      return;
    }
    createMutation.mutate(payload);
  };

  const listView = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('com_ui_filter_prompts_name')}
            aria-label={localize('com_ui_filter_prompts_name')}
            className="pl-9"
          />
        </div>
        <Button variant="submit" onClick={openCreate} className="shrink-0 gap-1.5">
          <Plus className="size-4" aria-hidden />
          {localize('com_ui_create_prompt')}
        </Button>
      </div>

      <div className="max-h-[26rem] space-y-1.5 overflow-y-auto">
        {promptsQuery.isLoading && (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        )}
        {!promptsQuery.isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-1 py-10 text-center text-sm text-text-secondary">
            <p className="font-medium text-text-primary">{localize('com_ui_no_prompts_title')}</p>
            <p className="text-xs">{localize('com_ui_add_first_prompt')}</p>
          </div>
        )}
        {filtered.map((prompt) => (
          <div
            key={prompt.id}
            className="flex items-start justify-between gap-2 rounded-xl border border-border-light p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary" title={prompt.name}>
                {prompt.name}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
                {prompt.description?.trim() ? prompt.description : prompt.content}
              </p>
            </div>
            <div className="flex shrink-0 items-center">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openEdit(prompt)}
                aria-label={localize('com_ui_edit')}
                title={localize('com_ui_edit')}
                className="text-text-secondary"
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleting(prompt)}
                aria-label={localize('com_ui_delete')}
                title={localize('com_ui_delete')}
                className="text-pwc-danger"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const formView = (
    <div className="space-y-3">
      <Input
        value={form.name}
        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
        placeholder={localize('com_ui_prompt_name')}
        aria-label={localize('com_ui_prompt_name')}
      />
      <Input
        value={form.category}
        onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
        placeholder={localize('com_ui_category')}
        aria-label={localize('com_ui_category')}
      />
      <div className="space-y-1.5">
        <Label htmlFor="tars-kb-prompt-content">{localize('com_ui_prompt_text')}</Label>
        <TextareaAutosize
          id="tars-kb-prompt-content"
          aria-label={localize('com_ui_prompt_text')}
          value={form.content}
          onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
          minRows={5}
          maxRows={14}
          className="w-full resize-none rounded-md border border-border-light bg-surface-primary px-3 py-2 font-mono text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-heavy"
        />
      </div>
    </div>
  );

  return (
    <>
      <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
        <OGDialogTemplate
          title={localize('com_ui_tars_kb_prompts')}
          description={knowledgeBaseName}
          className="w-11/12 md:max-w-2xl"
          showCloseButton={true}
          main={mode.kind === 'list' ? listView : formView}
          buttons={
            mode.kind === 'form' && (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setMode({ kind: 'list' })}>
                  {localize('com_ui_cancel')}
                </Button>
                <Button variant="submit" disabled={!canSave} onClick={handleSave}>
                  {isSaving ? <Spinner className="size-4" /> : saveLabel}
                </Button>
              </div>
            )
          }
        />
      </OGDialog>
      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_delete_prompt')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-sm text-text-secondary">
                {localize('com_ui_prompt_delete_confirm', { 0: deleting.name })}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                disabled={deleteMutation.isLoading}
                onClick={() => deleteMutation.mutate({ id: deleting.id, knowledgeBaseId })}
              >
                {deleteMutation.isLoading ? (
                  <Spinner className="size-4" />
                ) : (
                  localize('com_ui_delete')
                )}
              </Button>
            }
          />
        </OGDialog>
      )}
    </>
  );
}
