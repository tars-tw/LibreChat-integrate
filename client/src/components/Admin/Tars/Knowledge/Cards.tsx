import { Button } from '@librechat/client';
import { Library, BookText, Pencil, Search, Trash2 } from 'lucide-react';
import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import { accessSummaryKey, DEFAULT_MAX_RETRIEVE } from './helpers';
import { useLocalize } from '~/hooks';
import DatasetStats from './Stats';

/** The grid view of the knowledge-base list. */
export default function KnowledgeCards({
  knowledgeBases,
  onOpen,
  onEdit,
  onDelete,
  onManagePrompts,
}: {
  knowledgeBases: TTarsKnowledgeBase[];
  onOpen: (kb: TTarsKnowledgeBase) => void;
  onEdit: (kb: TTarsKnowledgeBase) => void;
  onDelete: (kb: TTarsKnowledgeBase) => void;
  onManagePrompts: (kb: TTarsKnowledgeBase) => void;
}) {
  const localize = useLocalize();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {knowledgeBases.map((kb) => (
        <div
          key={kb.id}
          className="flex flex-col gap-3 rounded-xl border border-border-light p-4 transition-colors hover:border-border-heavy"
        >
          <div className="flex items-start justify-between gap-2">
            {/*
              The whole heading opens the base. A button rather than a link so
              the menu beside it can stop propagation without fighting a
              navigation that already started.
            */}
            <button
              type="button"
              onClick={() => onOpen(kb)}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
            >
              <Library className="mt-0.5 size-5 shrink-0 text-brand-primary" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate font-medium text-text-primary" title={kb.name}>
                  {kb.name}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-text-secondary">
                  <span className="truncate" title={kb.llm_model ?? undefined}>
                    {kb.llm_model ?? '—'}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Search className="size-3" aria-hidden />
                    <span className="sr-only">{localize('com_ui_tars_kb_max_retrieve')} </span>
                    {kb.max_retrieve_count ?? DEFAULT_MAX_RETRIEVE}
                  </span>
                </span>
              </span>
            </button>

            {/* Inline actions, matching every other Tars admin list. */}
            <div className="flex shrink-0 items-center">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onManagePrompts(kb)}
                aria-label={localize('com_ui_tars_kb_prompts')}
                title={localize('com_ui_tars_kb_prompts')}
                className="text-brand-primary"
              >
                <BookText className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(kb)}
                aria-label={localize('com_ui_edit')}
                title={localize('com_ui_edit')}
                className="text-text-secondary"
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete(kb)}
                aria-label={localize('com_ui_delete')}
                title={localize('com_ui_delete')}
                className="text-pwc-danger"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>

          <p
            className="line-clamp-2 min-h-[2.5rem] text-sm text-text-secondary"
            title={kb.description ?? undefined}
          >
            {kb.description ?? ''}
          </p>

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-light pt-3">
            <DatasetStats knowledgeBase={kb} />
            <span className="shrink-0 text-xs text-text-tertiary">
              {localize(accessSummaryKey(kb))}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
