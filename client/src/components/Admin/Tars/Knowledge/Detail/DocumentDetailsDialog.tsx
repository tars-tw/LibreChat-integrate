import { Button, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsDocument } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { formatDateTime } from '../../Users/helpers';
import { docStatusMeta } from './helpers';
import StatusBadge from './StatusBadge';
import { useLocalize } from '~/hooks';

const bytesToMb = (bytes: number | null | undefined): string =>
  bytes == null ? '—' : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

/**
 * The metadata pwc_tars keeps per document but has no column for: where it
 * came from, how big it is on disk, and the chunk/overlap it was split with.
 */
export default function DocumentDetailsDialog({
  document,
  locale,
  onClose,
}: {
  document: TTarsDocument;
  locale: string;
  onClose: () => void;
}) {
  const localize = useLocalize();

  const row = (label: string, value: ReactNode) => (
    <tr className="border-t border-border-light">
      <th className="w-1/3 px-3 py-2 text-left text-sm font-medium text-text-secondary">{label}</th>
      <td className="px-3 py-2 text-sm text-text-primary">{value}</td>
    </tr>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_document_details')}
        className="w-11/12 max-w-lg"
        showCloseButton={true}
        main={
          <div className="overflow-hidden rounded-lg border border-border-light">
            <table className="w-full border-collapse">
              <tbody>
                {row(localize('com_ui_tars_kb_ds_name'), document.filename)}
                {row(
                  localize('com_ui_tars_kb_status'),
                  <StatusBadge meta={docStatusMeta(document.status)} />,
                )}
                {row(
                  localize('com_ui_tars_kb_ds_created_at'),
                  formatDateTime(document.created_at, locale),
                )}
                {document.file_source != null &&
                  document.file_source !== '' &&
                  row(
                    localize('com_ui_tars_kb_ds_file_source'),
                    document.file_source.toUpperCase(),
                  )}
                {row(localize('com_ui_tars_kb_ds_file_size'), bytesToMb(document.size))}
                {row(
                  localize('com_ui_tars_kb_ds_words'),
                  (document.word_count ?? 0).toLocaleString(),
                )}
                {row(localize('com_ui_tars_kb_tokens'), (document.tokens ?? 0).toLocaleString())}
                {row(
                  localize('com_ui_tars_kb_chunk_size'),
                  document.chunk_size != null ? document.chunk_size.toLocaleString() : '—',
                )}
                {row(
                  localize('com_ui_tars_kb_overlap'),
                  document.overlap_size != null ? document.overlap_size.toLocaleString() : '—',
                )}
              </tbody>
            </table>
          </div>
        }
        buttons={
          <Button variant="secondary" onClick={onClose}>
            {localize('com_ui_close')}
          </Button>
        }
      />
    </OGDialog>
  );
}
