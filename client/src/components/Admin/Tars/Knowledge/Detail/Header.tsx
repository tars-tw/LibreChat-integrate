import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Info, Search, Sliders } from 'lucide-react';
import { Button, OGDialog, OGDialogTemplate } from '@librechat/client';
import type {
  TTarsKnowledgeBase,
  TTarsDatasetStats,
  TTarsDatasetLimits,
} from 'librechat-data-provider';
import { DEFAULT_MAX_RETRIEVE } from '../helpers';
import ModelsDialog from './ModelsDialog';
import { formatCount } from './helpers';
import { useLocalize } from '~/hooks';

/** Name, description and the settings that apply to the whole knowledge base. */
export default function Header({
  knowledgeBaseId,
  knowledgeBase,
  stats,
  limits,
}: {
  knowledgeBaseId: string;
  knowledgeBase: TTarsKnowledgeBase | null;
  stats: TTarsDatasetStats;
  limits: TTarsDatasetLimits;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [showInfo, setShowInfo] = useState(false);
  const [showModels, setShowModels] = useState(false);

  const fact = (label: string, value: string) => (
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="break-words text-sm text-text-primary">{value}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/knowledge-bases')}
            aria-label={localize('com_ui_back')}
            title={localize('com_ui_back')}
            className="shrink-0"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </Button>

          <h1 className="truncate text-2xl font-semibold text-text-primary">
            {knowledgeBase?.name ?? '—'}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowInfo(true)}
            aria-label={localize('com_ui_tars_kb_ds_info')}
            title={localize('com_ui_tars_kb_ds_info')}
          >
            <Info className="size-4" aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => setShowModels(true)} className="gap-1.5">
            <Sliders className="size-4" aria-hidden />
            {localize('com_ui_tars_kb_ds_models')}
          </Button>
        </div>
      </div>

      {knowledgeBase?.description != null && knowledgeBase.description !== '' && (
        <p className="break-words pl-12 text-sm text-text-secondary">{knowledgeBase.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 pl-12 text-sm text-text-secondary">
        <span className="flex items-center gap-1.5">
          <Sliders className="size-3.5 text-brand-primary" aria-hidden />
          {knowledgeBase?.llm_model ?? '—'}
        </span>
        <span className="flex items-center gap-1.5">
          <Search className="size-3.5 text-brand-primary" aria-hidden />
          {localize('com_ui_tars_kb_max_retrieve')}:{' '}
          {knowledgeBase?.max_retrieve_count ?? DEFAULT_MAX_RETRIEVE}
        </span>
        <span>
          {localize('com_ui_tars_kb_documents')}: {formatCount(stats.document_count)}
        </span>
        <span>
          {localize('com_ui_tars_kb_tokens')}: {formatCount(stats.total_token_count)}
        </span>
        {/*
          API datasets have no tab of their own, so without this count a
          knowledge base that has them would look as though it had none.
        */}
        {stats.api_count > 0 && (
          <span>
            {localize('com_ui_tars_kb_stat_apis')}: {formatCount(stats.api_count)}
          </span>
        )}
      </div>

      {showInfo && (
        <OGDialog open={true} onOpenChange={(open) => !open && setShowInfo(false)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_kb_ds_info')}
            className="w-11/12 max-w-lg"
            showCloseButton={true}
            main={
              <div className="grid gap-3 sm:grid-cols-2">
                {fact(
                  localize('com_ui_tars_kb_embedding_model'),
                  knowledgeBase?.embedding_model ?? '—',
                )}
                {fact(localize('com_ui_tars_kb_rerank_model'), knowledgeBase?.rerank_model ?? '—')}
                {fact(localize('com_ui_tars_kb_ds_words'), formatCount(stats.total_word_count))}
                {fact(localize('com_ui_tars_kb_tokens'), formatCount(stats.total_token_count))}
                {fact(
                  localize('com_ui_tars_kb_ds_upload_ceiling'),
                  String(limits.max_upload_counts),
                )}
                {fact(
                  localize('com_ui_tars_kb_chunk_size'),
                  `≤ ${formatCount(limits.max_chunk_size)}`,
                )}
                {fact(localize('com_ui_tars_kb_overlap'), `≤ ${formatCount(limits.max_overlap)}`)}
              </div>
            }
          />
        </OGDialog>
      )}

      {showModels && (
        <ModelsDialog
          knowledgeBaseId={knowledgeBaseId}
          maxRetrieveCount={knowledgeBase?.max_retrieve_count ?? null}
          onClose={() => setShowModels(false)}
        />
      )}
    </div>
  );
}
