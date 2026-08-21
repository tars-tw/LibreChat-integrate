import { useEffect, useState } from 'react';
import {
  Button,
  Dropdown,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import {
  useTarsKnowledgeBaseModelBindingsQuery,
  useUpdateTarsKnowledgeBaseModelBindingsMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Shows which models this knowledge base uses, and rebinds the two that can
 * change. The embedding model is read-only: the stored vectors were built with
 * it, so swapping it would orphan every chunk.
 */
export default function ModelsDialog({
  knowledgeBaseId,
  onClose,
}: {
  knowledgeBaseId: string;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const bindingsQuery = useTarsKnowledgeBaseModelBindingsQuery(knowledgeBaseId);
  const [llmId, setLlmId] = useState('');
  const [rerankId, setRerankId] = useState('');

  useEffect(() => {
    const data = bindingsQuery.data;
    if (data == null) {
      return;
    }
    setLlmId((prev) => (prev !== '' ? prev : (data.llm.selected_id ?? '')));
    setRerankId((prev) => (prev !== '' ? prev : (data.rerank.selected_id ?? '')));
  }, [bindingsQuery.data]);

  const updateMutation = useUpdateTarsKnowledgeBaseModelBindingsMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
      onClose();
    },
    onError: () => showToast({ message: localize('com_ui_tars_kb_save_failed'), status: 'error' }),
  });

  const embeddingName =
    bindingsQuery.data?.embedding.options.find(
      (option) => option.id === bindingsQuery.data?.embedding.selected_id,
    )?.name ??
    bindingsQuery.data?.embedding.selected_id ??
    '—';

  const picker = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    options: { id: string; name: string; note?: string }[],
  ) => (
    <div className="space-y-1.5">
      <Label id={`${id}-label`}>{label}</Label>
      {!bindingsQuery.isFetching && options.length === 0 ? (
        <p className="flex h-10 items-center rounded-md border border-border-light px-3 text-sm text-text-secondary">
          {localize('com_ui_tars_kb_no_models')}
        </p>
      ) : (
        <Dropdown
          value={value}
          onChange={onChange}
          options={options.map((option) => ({
            value: option.id,
            label: option.note != null ? `${option.name} (${option.note})` : option.name,
          }))}
          aria-labelledby={`${id}-label`}
          searchable={options.length > 8}
          searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
          searchEmptyText={localize('com_ui_no_results_found')}
          disabled={bindingsQuery.isFetching}
          sizeClasses="w-full"
          className="w-full"
        />
      )}
    </div>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_ds_models')}
        className="w-11/12 md:max-w-lg"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={
          <div className="min-w-0 space-y-4">
            {bindingsQuery.isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <>
                {picker(
                  'tars-kb-bind-llm',
                  localize('com_ui_tars_kb_llm_model'),
                  llmId,
                  setLlmId,
                  bindingsQuery.data?.llm.options ?? [],
                )}
                {picker(
                  'tars-kb-bind-rerank',
                  localize('com_ui_tars_kb_rerank_model'),
                  rerankId,
                  setRerankId,
                  bindingsQuery.data?.rerank.options ?? [],
                )}
                <div className="space-y-1.5">
                  <Label>{localize('com_ui_tars_kb_embedding_model')}</Label>
                  <p className="flex h-10 items-center rounded-md border border-border-light px-3 text-sm text-text-secondary">
                    {embeddingName}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_tars_kb_batch_embedding_note')}
                  </p>
                </div>
              </>
            )}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            disabled={updateMutation.isLoading || bindingsQuery.isLoading}
            onClick={() =>
              updateMutation.mutate({
                id: knowledgeBaseId,
                data: {
                  ...(llmId !== '' ? { llmModelId: llmId } : {}),
                  ...(rerankId !== '' ? { rerankModelId: rerankId } : {}),
                },
              })
            }
          >
            {updateMutation.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
