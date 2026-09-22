import { useMemo, useState } from 'react';
import { RefreshCcw, RotateCcw, RotateCw, Search, Unlink } from 'lucide-react';
import { Button, Input, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TTarsDatasetFileSystemLink, TTarsDocument } from 'librechat-data-provider';
import {
  useDeleteTarsDocumentMutation,
  useReprocessTarsDocumentMutation,
  useRetryTarsStuckDocumentMutation,
} from '~/data-provider';
import { DOC_STATUS, docStatusMeta, fileSystemLabel, formatCount, matchesName } from './helpers';
import DocumentDetailsDialog from './DocumentDetailsDialog';
import Pagination, { usePagination } from '../Pagination';
import GroupScheduleSection from './GroupScheduleSection';
import DocumentRowActions from './DocumentRowActions';
import { formatDateTime } from '../../Users/helpers';
import ConfirmDialog from './ConfirmDialog';
import RenameDialog from './RenameDialog';
import StatusBadge from './StatusBadge';
import { useLocalize } from '~/hooks';

/** Every filterable status, worst-first so the files most worth a look sort to the top. */
const STATUS_FILTERS = [
  DOC_STATUS.failed,
  DOC_STATUS.processing,
  DOC_STATUS.uploaded,
  DOC_STATUS.completed,
] as const;
const STATUS_PRIORITY: Record<number, number> = Object.fromEntries(
  STATUS_FILTERS.map((status, index) => [status, index]),
);

/**
 * Every document one document group brought in, with the group-level actions
 * pwc_tars keeps on this same screen rather than the outer table: sync from
 * source, reprocess what has not finished, and unlink. The three still share
 * pwc_tars' own confirmation flow with the outer table's icons — this dialog
 * only asks for it, the caller owns the mutation and the confirm dialog.
 */
export default function GroupDocumentsDialog({
  knowledgeBaseId,
  link,
  documents,
  locale,
  isGroupBusy,
  onSync,
  onReprocessGroup,
  onRebuild,
  onUnlink,
  onViewChunks,
  onClose,
}: {
  knowledgeBaseId: string;
  link: TTarsDatasetFileSystemLink;
  documents: TTarsDocument[];
  locale: string;
  isGroupBusy: boolean;
  onSync: () => void;
  onReprocessGroup: () => void;
  onRebuild: () => void;
  onUnlink: () => void;
  onViewChunks: (document: TTarsDocument) => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<TTarsDocument | null>(null);
  const [deleting, setDeleting] = useState<TTarsDocument | null>(null);
  const [reprocessing, setReprocessing] = useState<TTarsDocument | null>(null);
  const [details, setDetails] = useState<TTarsDocument | null>(null);

  const groupDocuments = useMemo(
    () => documents.filter((doc) => doc.dataset_file_system_id === link.dataset_file_system_id),
    [documents, link.dataset_file_system_id],
  );

  const counts = useMemo(() => {
    const byStatus = new Map<number, number>();
    groupDocuments.forEach((doc) => byStatus.set(doc.status, (byStatus.get(doc.status) ?? 0) + 1));
    return byStatus;
  }, [groupDocuments]);

  const visible = useMemo(() => {
    const sorted = [...groupDocuments].sort(
      (a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99),
    );
    const scoped =
      statusFilter === null ? sorted : sorted.filter((doc) => doc.status === statusFilter);
    return scoped.filter((doc) => matchesName(doc.filename, search));
  }, [groupDocuments, statusFilter, search]);

  const paged = usePagination(visible);

  const onError = () =>
    showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' });

  const deleteMutation = useDeleteTarsDocumentMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError,
  });

  const reprocessMutation = useReprocessTarsDocumentMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_reprocess_started'), status: 'success' });
      setReprocessing(null);
    },
    onError,
  });

  const retryStuckOneMutation = useRetryTarsStuckDocumentMutation(knowledgeBaseId, {
    onSuccess: (data) =>
      showToast({
        message: data.message || localize('com_ui_tars_kb_retry_stuck_success'),
        status: 'success',
      }),
    onError,
  });

  const statusBadge = (status: number | null, label: string, count: number) => {
    const active = statusFilter === status;
    const className =
      status === null ? 'bg-brand-primary/10 text-brand-primary' : docStatusMeta(status).className;
    return (
      <button
        type="button"
        onClick={() => setStatusFilter((prev) => (prev === status ? null : status))}
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition-shadow ${className} ${
          active ? 'ring-2 ring-inset ring-text-primary/40' : ''
        }`}
      >
        {label}: {count}
      </button>
    );
  };

  return (
    <>
      <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
        <OGDialogTemplate
          title={localize('com_ui_tars_kb_ds_group_documents', { 0: fileSystemLabel(link) })}
          className="w-11/12 md:max-w-5xl"
          showCloseButton={true}
          mainClassName="min-w-0"
          main={
            <div className="max-h-[75vh] min-w-0 space-y-4 overflow-y-auto pr-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[14rem]">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
                      aria-hidden
                    />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={localize('com_ui_tars_kb_ds_search')}
                      aria-label={localize('com_ui_tars_kb_ds_search')}
                      className="pl-9"
                    />
                  </div>
                  {statusBadge(null, localize('com_ui_tars_kb_ds_total'), groupDocuments.length)}
                  {statusBadge(
                    DOC_STATUS.completed,
                    localize('com_ui_tars_kb_status_completed'),
                    counts.get(DOC_STATUS.completed) ?? 0,
                  )}
                  {statusBadge(
                    DOC_STATUS.uploaded,
                    localize('com_ui_tars_kb_status_uploaded'),
                    counts.get(DOC_STATUS.uploaded) ?? 0,
                  )}
                  {statusBadge(
                    DOC_STATUS.processing,
                    localize('com_ui_tars_kb_status_processing'),
                    counts.get(DOC_STATUS.processing) ?? 0,
                  )}
                  {statusBadge(
                    DOC_STATUS.failed,
                    localize('com_ui_tars_kb_status_failed'),
                    counts.get(DOC_STATUS.failed) ?? 0,
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isGroupBusy}
                    onClick={onSync}
                    className="gap-1.5"
                  >
                    <RefreshCcw className="size-4" aria-hidden />
                    {localize('com_ui_tars_kb_ds_sync')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isGroupBusy}
                    onClick={onReprocessGroup}
                    className="gap-1.5"
                  >
                    <RotateCw className="size-4" aria-hidden />
                    {localize('com_ui_tars_kb_ds_reprocess_group')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isGroupBusy}
                    onClick={onRebuild}
                    className="gap-1.5 text-pwc-danger hover:text-pwc-danger"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    {localize('com_ui_tars_kb_ds_rebuild')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onUnlink}
                    className="gap-1.5 text-pwc-danger hover:text-pwc-danger"
                  >
                    <Unlink className="size-4" aria-hidden />
                    {localize('com_ui_tars_kb_ds_unlink')}
                  </Button>
                </div>
              </div>

              {visible.length === 0 ? (
                <p className="py-12 text-center text-sm text-text-secondary">
                  {localize(
                    groupDocuments.length === 0
                      ? 'com_ui_tars_kb_no_documents'
                      : 'com_ui_tars_kb_ds_no_match',
                  )}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border-light">
                  <table className="w-full min-w-[48rem] border-collapse text-sm">
                    <thead className="bg-surface-secondary">
                      <tr className="text-left text-text-secondary">
                        <th className="w-[36%] px-3 py-2 font-medium">
                          {localize('com_ui_tars_kb_ds_name')}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {localize('com_ui_tars_kb_status')}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {localize('com_ui_tars_kb_ds_words')}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {localize('com_ui_tars_kb_tokens')}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {localize('com_ui_tars_kb_ds_created_at')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {localize('com_ui_actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.rows.map((doc) => (
                        <tr
                          key={doc.id}
                          className="border-t border-border-light hover:bg-surface-hover"
                        >
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

              <GroupScheduleSection knowledgeBaseId={knowledgeBaseId} link={link} />
            </div>
          }
          buttons={
            <Button variant="secondary" onClick={onClose}>
              {localize('com_ui_close')}
            </Button>
          }
        />
      </OGDialog>

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
    </>
  );
}
