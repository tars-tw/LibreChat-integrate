import { useMemo, useState } from 'react';
import { Checkbox, useToastContext } from '@librechat/client';
import type { TTarsDocument, TTarsDatasetLimits } from 'librechat-data-provider';
import {
  useDeleteTarsDocumentMutation,
  useReprocessTarsDocumentMutation,
  useRetryTarsStuckDocumentMutation,
  useRetryTarsStuckDocumentsMutation,
} from '~/data-provider';
import { docStatusMeta, formatCount, matchesName } from './helpers';
import DocumentDetailsDialog from './DocumentDetailsDialog';
import Pagination, { usePagination } from '../Pagination';
import DocumentRowActions from './DocumentRowActions';
import { formatDateTime } from '../../Users/helpers';
import ConfirmDialog from './ConfirmDialog';
import RenameDialog from './RenameDialog';
import UploadDialog from './UploadDialog';
import StatusBadge from './StatusBadge';
import { useLocalize } from '~/hooks';
import Toolbar from './Toolbar';

/** The file datasets of a knowledge base. */
export default function DocumentsTab({
  knowledgeBaseId,
  documents,
  limits,
  locale,
  onRefresh,
  isRefreshing,
  onViewChunks,
  onBatchDelete,
}: {
  knowledgeBaseId: string;
  documents: TTarsDocument[];
  limits: TTarsDatasetLimits;
  locale: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  onViewChunks: (document: TTarsDocument) => void;
  onBatchDelete: (documentIds: string[]) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [renaming, setRenaming] = useState<TTarsDocument | null>(null);
  const [deleting, setDeleting] = useState<TTarsDocument | null>(null);
  const [reprocessing, setReprocessing] = useState<TTarsDocument | null>(null);
  const [details, setDetails] = useState<TTarsDocument | null>(null);

  const visible = useMemo(
    () => documents.filter((doc) => matchesName(doc.filename, search)),
    [documents, search],
  );

  /** The filtered list is what gets paged, so a search resets to page one
   *  by way of the clamp rather than by a separate effect. */
  const paged = usePagination(visible);

  const deleteMutation = useDeleteTarsDocumentMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const reprocessMutation = useReprocessTarsDocumentMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_reprocess_started'), status: 'success' });
      setReprocessing(null);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const retryStuckMutation = useRetryTarsStuckDocumentsMutation(knowledgeBaseId, {
    onSuccess: (data) =>
      showToast({
        message: data.message || localize('com_ui_tars_kb_retry_stuck_success'),
        status: 'success',
      }),
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const retryStuckOneMutation = useRetryTarsStuckDocumentMutation(knowledgeBaseId, {
    onSuccess: (data) =>
      showToast({
        message: data.message || localize('com_ui_tars_kb_retry_stuck_success'),
        status: 'success',
      }),
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  const allSelected = paged.rows.length > 0 && paged.rows.every((row) => selected.includes(row.id));

  return (
    <div className="space-y-3">
      <Toolbar
        search={search}
        onSearchChange={setSearch}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        selectedCount={selected.length}
        onBatchDelete={() => {
          onBatchDelete(selected);
          setSelected([]);
        }}
        onRetryStuck={() => retryStuckMutation.mutate()}
        isRetryingStuck={retryStuckMutation.isLoading}
        addLabel={localize('com_ui_tars_kb_upload_documents')}
        onAdd={() => setShowUpload(true)}
      />

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize(
            documents.length === 0 ? 'com_ui_tars_kb_no_documents' : 'com_ui_tars_kb_ds_no_match',
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead className="bg-surface-secondary">
              <tr className="text-left text-text-secondary">
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelected(checked === true ? paged.rows.map((doc) => doc.id) : [])
                    }
                    aria-label={localize('com_ui_tars_kb_ds_select_all')}
                  />
                </th>
                <th className="w-[40%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_name')}
                </th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_status')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_ds_words')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_tokens')}</th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_created_at')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((doc) => (
                <tr key={doc.id} className="border-t border-border-light hover:bg-surface-hover">
                  <td className="px-3 py-1.5">
                    <Checkbox
                      checked={selected.includes(doc.id)}
                      onCheckedChange={() => toggle(doc.id)}
                      aria-label={localize('com_ui_tars_kb_ds_select_one', { 0: doc.filename })}
                    />
                  </td>
                  <td className="max-w-0 px-3 py-1.5">
                    <span className="block truncate text-text-primary" title={doc.filename}>
                      {doc.filename}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusBadge meta={docStatusMeta(doc.status)} />
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-text-secondary">
                    {formatCount(doc.word_count)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-text-secondary">
                    {formatCount(doc.tokens)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                    {formatDateTime(doc.created_at, locale)}
                  </td>
                  <td className="px-3 py-1.5">
                    <DocumentRowActions
                      doc={doc}
                      isRetryingStuck={retryStuckOneMutation.isLoading}
                      onDetails={() => setDetails(doc)}
                      onViewChunks={() => onViewChunks(doc)}
                      onRename={() => setRenaming(doc)}
                      onReprocess={() => setReprocessing(doc)}
                      onRetryStuck={() => retryStuckOneMutation.mutate(doc.id)}
                      onDelete={() => setDeleting(doc)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > 0 && <Pagination state={paged} />}

      {showUpload && (
        <UploadDialog
          knowledgeBaseId={knowledgeBaseId}
          limits={limits}
          onClose={() => setShowUpload(false)}
        />
      )}

      {renaming != null && (
        <RenameDialog
          knowledgeBaseId={knowledgeBaseId}
          document={renaming}
          onClose={() => setRenaming(null)}
        />
      )}

      {deleting != null && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_ds_delete_document')}
          message={localize('com_ui_tars_kb_ds_delete_confirm', { 0: deleting.filename })}
          note={localize('com_ui_tars_kb_ds_delete_warning')}
          confirmLabel={localize('com_ui_delete')}
          destructive
          isBusy={deleteMutation.isLoading}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}

      {reprocessing != null && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_reprocess')}
          message={localize('com_ui_tars_kb_reprocess_confirm')}
          confirmLabel={localize('com_ui_tars_kb_reprocess')}
          isBusy={reprocessMutation.isLoading}
          onConfirm={() =>
            reprocessMutation.mutate({
              docId: reprocessing.id,
              /** Keep whatever the document was originally chunked with. */
              data: {
                chunkSize: reprocessing.chunk_size ?? undefined,
                overlap: reprocessing.overlap_size ?? undefined,
              },
            })
          }
          onClose={() => setReprocessing(null)}
        />
      )}

      {details != null && (
        <DocumentDetailsDialog
          document={details}
          locale={locale}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
}
