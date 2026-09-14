import { Button } from '@librechat/client';
import { Info, Layers, Pencil, RefreshCw, Trash2, Wrench } from 'lucide-react';
import type { TTarsDocument } from 'librechat-data-provider';
import { DOC_STATUS } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * The action icons for one document row — shared by the documents table and
 * the document-group drill-down, so the two present identical behavior rather
 * than two slightly different takes on the same six actions.
 */
export default function DocumentRowActions({
  doc,
  isRetryingStuck,
  onDetails,
  onViewChunks,
  onRename,
  onReprocess,
  onRetryStuck,
  onDelete,
}: {
  doc: TTarsDocument;
  isRetryingStuck: boolean;
  onDetails: () => void;
  onViewChunks: () => void;
  onRename: () => void;
  onReprocess: () => void;
  onRetryStuck: () => void;
  onDelete: () => void;
}) {
  const localize = useLocalize();
  const processing = doc.status === DOC_STATUS.processing;

  return (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDetails}
        aria-label={localize('com_ui_tars_kb_document_details')}
        title={localize('com_ui_tars_kb_document_details')}
      >
        <Info className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onViewChunks}
        aria-label={localize('com_ui_tars_kb_view_chunks')}
        title={localize('com_ui_tars_kb_view_chunks')}
      >
        <Layers className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRename}
        aria-label={localize('com_ui_rename')}
        title={localize('com_ui_rename')}
      >
        <Pencil className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={processing}
        onClick={onReprocess}
        aria-label={localize('com_ui_tars_kb_reprocess')}
        title={localize(
          processing ? 'com_ui_tars_kb_reprocess_processing_hint' : 'com_ui_tars_kb_reprocess',
        )}
      >
        <RefreshCw className="size-4" aria-hidden />
      </Button>
      {processing && (
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={isRetryingStuck}
          onClick={onRetryStuck}
          aria-label={localize('com_ui_tars_kb_retry_stuck_one')}
          title={localize('com_ui_tars_kb_retry_stuck_one')}
        >
          <Wrench className="size-4" aria-hidden />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label={localize('com_ui_delete')}
        title={localize('com_ui_delete')}
        className="text-pwc-danger"
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
