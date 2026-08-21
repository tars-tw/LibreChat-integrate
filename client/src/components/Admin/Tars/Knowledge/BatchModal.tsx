import { useEffect, useMemo, useState } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { dataService } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Checkbox,
  Dropdown,
  Input,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import { useTarsKnowledgeBaseModelBindingsQuery } from '~/data-provider';
import { DEFAULT_MAX_RETRIEVE } from './helpers';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';

const RETRIEVE_MIN = 1;
const RETRIEVE_MAX = 100;

interface ApplyToggles {
  rerank: boolean;
  maxRetrieve: boolean;
  llm: boolean;
}

/**
 * Applies a rerank model, an LLM model and/or a max-retrieve count to several
 * knowledge bases at once.
 *
 * pwc_tars has no batch endpoint, so this walks the selection one base at a
 * time — and one failure must not discard the successes, so the results are
 * counted and reported rather than thrown.
 */
export default function BatchModal({
  knowledgeBases,
  initialSelection,
  onClose,
}: {
  knowledgeBases: TTarsKnowledgeBase[];
  initialSelection: string[];
  onClose: () => void;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();

  const [selected, setSelected] = useState<string[]>(initialSelection);
  const [apply, setApply] = useState<ApplyToggles>({
    rerank: false,
    maxRetrieve: false,
    llm: false,
  });
  const [rerankId, setRerankId] = useState('');
  const [llmId, setLlmId] = useState('');
  const [maxRetrieveCount, setMaxRetrieveCount] = useState(String(DEFAULT_MAX_RETRIEVE));
  const [isApplying, setIsApplying] = useState(false);

  /**
   * The option lists are the same for every base — they describe which models
   * the server currently considers usable — so one base's id fetches them.
   */
  const bindingsQuery = useTarsKnowledgeBaseModelBindingsQuery(knowledgeBases[0]?.id ?? null);
  const rerankOptions = useMemo(
    () => bindingsQuery.data?.rerank.options ?? [],
    [bindingsQuery.data],
  );
  const llmOptions = useMemo(() => bindingsQuery.data?.llm.options ?? [], [bindingsQuery.data]);

  useEffect(() => {
    setRerankId((prev) => (prev !== '' ? prev : (rerankOptions[0]?.id ?? '')));
    setLlmId((prev) => (prev !== '' ? prev : (llmOptions[0]?.id ?? '')));
  }, [rerankOptions, llmOptions]);

  const kbOptions = useMemo(
    () => knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name })),
    [knowledgeBases],
  );

  const retrieveCount = Number(maxRetrieveCount);
  const retrieveInvalid =
    !Number.isInteger(retrieveCount) ||
    retrieveCount < RETRIEVE_MIN ||
    retrieveCount > RETRIEVE_MAX;
  const nothingChosen = !apply.rerank && !apply.maxRetrieve && !apply.llm;
  const canApply =
    selected.length > 0 && !nothingChosen && !(apply.maxRetrieve && retrieveInvalid) && !isApplying;

  /** Models and the retrieve count live on two different pwc_tars endpoints. */
  const applyToOne = async (id: string) => {
    if (apply.rerank || apply.llm) {
      await dataService.updateTarsKnowledgeBaseModelBindings(id, {
        ...(apply.rerank ? { rerankModelId: rerankId } : {}),
        ...(apply.llm ? { llmModelId: llmId } : {}),
      });
    }
    if (apply.maxRetrieve) {
      await dataService.updateTarsKnowledgeBase(id, { new_max_retrieve_count: retrieveCount });
    }
  };

  const run = async () => {
    setIsApplying(true);
    const failed: string[] = [];
    for (const id of selected) {
      try {
        await applyToOne(id);
      } catch {
        failed.push(knowledgeBases.find((kb) => kb.id === id)?.name ?? id);
      }
    }
    setIsApplying(false);
    queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBases]);
    queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseModelBindings]);

    if (failed.length > 0) {
      showToast({
        message: localize('com_ui_tars_kb_batch_partial', {
          0: String(selected.length - failed.length),
          1: failed.join('、'),
        }),
        status: 'error',
      });
      return;
    }
    showToast({
      message: localize('com_ui_tars_kb_batch_done', { 0: String(selected.length) }),
      status: 'success',
    });
    onClose();
  };

  const row = (key: keyof ApplyToggles, label: string, control: React.ReactNode, hint?: string) => (
    <div className="grid items-start gap-3 sm:grid-cols-[auto_10rem_1fr]">
      <Checkbox
        checked={apply[key]}
        onCheckedChange={(checked) => setApply((prev) => ({ ...prev, [key]: checked === true }))}
        aria-label={label}
        className="mt-2"
      />
      <span className="mt-1.5 text-sm text-text-primary">{label}</span>
      <div className="min-w-0 space-y-1">
        {control}
        {hint != null && <p className="text-xs text-text-secondary">{hint}</p>}
      </div>
    </div>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !isApplying && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_batch')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        mainClassName="min-w-0"
        main={
          <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto pr-1">
            <Picker
              id="tars-kb-batch-targets"
              label={localize('com_ui_tars_kb_batch_targets')}
              options={kbOptions}
              selected={selected}
              onChange={setSelected}
              placeholder={localize('com_ui_tars_kb_batch_pick')}
            />

            {/* Only ticked rows are sent, so an untouched setting is left alone. */}
            <div className="space-y-4 rounded-lg border border-border-light p-3">
              <p className="text-xs text-text-secondary">{localize('com_ui_tars_kb_batch_hint')}</p>

              {row(
                'llm',
                localize('com_ui_tars_kb_llm_model'),
                <Dropdown
                  value={llmId}
                  onChange={setLlmId}
                  options={llmOptions.map((option) => ({
                    value: option.id,
                    label: option.name,
                  }))}
                  ariaLabel={localize('com_ui_tars_kb_llm_model')}
                  searchable={llmOptions.length > 8}
                  disabled={!apply.llm || bindingsQuery.isFetching}
                  sizeClasses="w-full"
                  className="w-full"
                />,
              )}

              {row(
                'rerank',
                localize('com_ui_tars_kb_rerank_model'),
                <Dropdown
                  value={rerankId}
                  onChange={setRerankId}
                  options={rerankOptions.map((option) => ({
                    value: option.id,
                    label: option.name,
                  }))}
                  ariaLabel={localize('com_ui_tars_kb_rerank_model')}
                  searchable={rerankOptions.length > 8}
                  disabled={!apply.rerank || bindingsQuery.isFetching}
                  sizeClasses="w-full"
                  className="w-full"
                />,
              )}

              {row(
                'maxRetrieve',
                localize('com_ui_tars_kb_max_retrieve'),
                <Input
                  type="number"
                  min={RETRIEVE_MIN}
                  max={RETRIEVE_MAX}
                  value={maxRetrieveCount}
                  onChange={(event) => setMaxRetrieveCount(event.target.value)}
                  disabled={!apply.maxRetrieve}
                  aria-label={localize('com_ui_tars_kb_max_retrieve')}
                />,
                apply.maxRetrieve && retrieveInvalid
                  ? localize('com_ui_tars_kb_max_retrieve_invalid', {
                      0: String(RETRIEVE_MIN),
                      1: String(RETRIEVE_MAX),
                    })
                  : undefined,
              )}
            </div>

            {/* The embedding model is intentionally absent: the stored vectors
                were built with it, so swapping it would orphan every chunk. */}
            <p className="text-xs text-text-secondary">
              {localize('com_ui_tars_kb_batch_embedding_note')}
            </p>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={() => void run()} disabled={!canApply}>
            {isApplying ? <Spinner className="size-4" /> : localize('com_ui_tars_kb_batch_apply')}
          </Button>
        }
      />
    </OGDialog>
  );
}
