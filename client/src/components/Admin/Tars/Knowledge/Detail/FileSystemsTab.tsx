import { useMemo, useState } from 'react';
import { Button, Checkbox, useToastContext } from '@librechat/client';
import { Eye, RefreshCcw, RotateCcw, RotateCw, Unlink } from 'lucide-react';
import type {
  TTarsDatasetFileSystemLink,
  TTarsDatasetLimits,
  TTarsDocument,
} from 'librechat-data-provider';
import {
  useRebuildTarsFileSystemMutation,
  useRefreshTarsFileSystemMutation,
  useTarsFileSystemSourcesQuery,
  useReprocessTarsFileSystemMutation,
  useUnlinkTarsFileSystemMutation,
} from '~/data-provider';
import {
  DOC_STATUS,
  matchesName,
  recordedChunk,
  fileSystemLabel,
  boundFolderLabel,
  enabledStatusMeta,
  recordedChunkLabel,
} from './helpers';
import FileSystemImportDialog from './FileSystemImportDialog';
import GroupDocumentsDialog from './GroupDocumentsDialog';
import Pagination, { usePagination } from '../Pagination';
import { formatDateTime } from '../../Users/helpers';
import ConfirmDialog from './ConfirmDialog';
import StatusBadge from './StatusBadge';
import SyncDialog from './SyncDialog';
import { useLocalize } from '~/hooks';
import Toolbar from './Toolbar';

/**
 * The document groups a knowledge base pulls from file servers.
 *
 * A group is removed as a whole by unlinking it, one at a time or several at
 * once through pwc_tars' batch delete. Rows are selected by
 * `dataset_file_system_id`, which is what both unlink paths take.
 */
export default function FileSystemsTab({
  knowledgeBaseId,
  links,
  documents,
  limits,
  locale,
  onRefresh,
  isRefreshing,
  onBatchUnlink,
  isBatchUnlinking,
  onViewChunks,
}: {
  knowledgeBaseId: string;
  links: TTarsDatasetFileSystemLink[];
  documents: TTarsDocument[];
  limits: TTarsDatasetLimits;
  locale: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  onBatchUnlink: (fileSystemIds: string[]) => void;
  isBatchUnlinking: boolean;
  onViewChunks: (document: TTarsDocument) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [unlinking, setUnlinking] = useState<TTarsDatasetFileSystemLink | null>(null);
  const [syncing, setSyncing] = useState<TTarsDatasetFileSystemLink | null>(null);
  const [reprocessingGroup, setReprocessingGroup] = useState<TTarsDatasetFileSystemLink | null>(
    null,
  );
  const [rebuilding, setRebuilding] = useState<TTarsDatasetFileSystemLink | null>(null);
  const [viewing, setViewing] = useState<TTarsDatasetFileSystemLink | null>(null);

  const visible = useMemo(
    () => links.filter((link) => matchesName(fileSystemLabel(link), search)),
    [links, search],
  );

  /**
   * The file servers behind the bindings, for the whole-source path and the
   * connection shown alongside each group. Listed only while this knowledge
   * base is still allowed to use them, so a binding may find none.
   */
  const sourcesQuery = useTarsFileSystemSourcesQuery(knowledgeBaseId);
  const sourcesById = useMemo(
    () => new Map((sourcesQuery.data ?? []).map((source) => [source.id, source])),
    [sourcesQuery.data],
  );

  /** The filtered list is what gets paged, so a search resets to page one
   *  by way of the clamp rather than by a separate effect. */
  const paged = usePagination(visible);

  /** A refetch can drop a group a background unlink finished, so stale ticks never count. */
  const selectedIds = useMemo(() => {
    const linked = new Set(links.map((link) => link.dataset_file_system_id));
    return selected.filter((id) => linked.has(id));
  }, [links, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  const allSelected =
    paged.rows.length > 0 &&
    paged.rows.every((link) => selectedIds.includes(link.dataset_file_system_id));

  /**
   * How many of the group's documents finished. pwc_tars ingests on a
   * background thread, so a freshly imported group sits well short of its total
   * for a while — showing both numbers is what makes that legible.
   */
  const progress = useMemo(() => {
    const counts = new Map<string, { done: number; total: number }>();
    documents.forEach((doc) => {
      const groupId = doc.dataset_file_system_id;
      if (groupId == null || groupId === '') {
        return;
      }
      const entry = counts.get(groupId) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (doc.status === DOC_STATUS.completed) {
        entry.done += 1;
      }
      counts.set(groupId, entry);
    });
    return counts;
  }, [documents]);

  const onError = () =>
    showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' });

  const refreshMutation = useRefreshTarsFileSystemMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_sync_started'), status: 'success' });
      setSyncing(null);
    },
    onError,
  });

  const reprocessMutation = useReprocessTarsFileSystemMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_reprocess_started'), status: 'success' });
      setReprocessingGroup(null);
    },
    onError,
  });

  const unlinkMutation = useUnlinkTarsFileSystemMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_unlinked'), status: 'success' });
      setUnlinking(null);
    },
    onError,
  });

  const rebuildMutation = useRebuildTarsFileSystemMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_rebuild_started'), status: 'success' });
      setRebuilding(null);
    },
    onError,
  });

  const isBusy =
    refreshMutation.isLoading || reprocessMutation.isLoading || rebuildMutation.isLoading;

  return (
    <div className="space-y-3">
      <Toolbar
        search={search}
        onSearchChange={setSearch}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        selectedCount={selectedIds.length}
        onBatchDelete={() => setConfirmingBatch(true)}
        batchDeleteLabel={localize('com_ui_tars_kb_ds_batch_unlink')}
        addLabel={localize('com_ui_tars_kb_ds_import_group')}
        onAdd={() => setShowImport(true)}
      />

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize(
            links.length === 0 ? 'com_ui_tars_kb_ds_no_groups' : 'com_ui_tars_kb_ds_no_match',
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full min-w-[64rem] border-collapse text-sm">
            <thead className="bg-surface-secondary">
              <tr className="text-left text-text-secondary">
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked === true
                          ? paged.rows.map((link) => link.dataset_file_system_id)
                          : [],
                      )
                    }
                    aria-label={localize('com_ui_tars_kb_ds_select_all')}
                  />
                </th>
                <th className="w-[24%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_name')}
                </th>
                <th className="w-[20%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_bind_folder')}
                </th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_status')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_ds_progress')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_ds_sync_mode')}</th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_chunk_settings')}
                </th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_created_at')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((link) => {
                const counts = progress.get(link.dataset_file_system_id) ?? { done: 0, total: 0 };
                const folder = boundFolderLabel(
                  link,
                  sourcesById.get(link.dataset_file_system_id)?.path,
                  localize,
                );
                return (
                  <tr key={link.id} className="border-t border-border-light hover:bg-surface-hover">
                    <td className="px-3 py-1.5">
                      <Checkbox
                        checked={selectedIds.includes(link.dataset_file_system_id)}
                        onCheckedChange={() => toggle(link.dataset_file_system_id)}
                        aria-label={localize('com_ui_tars_kb_ds_select_one', {
                          0: fileSystemLabel(link),
                        })}
                      />
                    </td>
                    <td className="max-w-0 px-3 py-1.5">
                      <span
                        className="block truncate text-text-primary"
                        title={fileSystemLabel(link)}
                      >
                        {fileSystemLabel(link)}
                      </span>
                    </td>
                    <td className="max-w-0 px-3 py-1.5">
                      <span className="block truncate text-text-secondary" title={folder}>
                        {folder}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge meta={enabledStatusMeta(link.status)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-text-secondary">
                      {counts.done} / {counts.total}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                      {localize(
                        link.is_sync_all === true
                          ? 'com_ui_tars_kb_ds_sync_all'
                          : 'com_ui_tars_kb_ds_sync_selected',
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-text-secondary">
                      {recordedChunkLabel(link, localize)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                      {formatDateTime(link.created_at, locale)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setViewing(link)}
                          aria-label={localize('com_ui_tars_kb_ds_view')}
                          title={localize('com_ui_tars_kb_ds_view')}
                        >
                          <Eye className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isBusy}
                          onClick={() => setSyncing(link)}
                          aria-label={localize('com_ui_tars_kb_ds_sync')}
                          title={localize('com_ui_tars_kb_ds_sync')}
                        >
                          <RefreshCcw className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isBusy}
                          onClick={() => setReprocessingGroup(link)}
                          aria-label={localize('com_ui_tars_kb_ds_reprocess_group')}
                          title={localize('com_ui_tars_kb_ds_reprocess_group')}
                        >
                          <RotateCw className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isBusy}
                          onClick={() => setRebuilding(link)}
                          aria-label={localize('com_ui_tars_kb_ds_rebuild')}
                          title={localize('com_ui_tars_kb_ds_rebuild')}
                          className="text-pwc-danger"
                        >
                          <RotateCcw className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setUnlinking(link)}
                          aria-label={localize('com_ui_tars_kb_ds_unlink')}
                          title={localize('com_ui_tars_kb_ds_unlink')}
                          className="text-pwc-danger"
                        >
                          <Unlink className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > 0 && <Pagination state={paged} />}

      {showImport && (
        <FileSystemImportDialog
          knowledgeBaseId={knowledgeBaseId}
          linked={links}
          limits={limits}
          onClose={() => setShowImport(false)}
        />
      )}

      {confirmingBatch && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_ds_batch_unlink')}
          message={localize('com_ui_tars_kb_ds_batch_unlink_confirm', {
            0: String(selectedIds.length),
          })}
          note={localize('com_ui_tars_kb_ds_unlink_note')}
          confirmLabel={localize('com_ui_tars_kb_ds_unlink')}
          destructive
          isBusy={isBatchUnlinking}
          onConfirm={() => {
            onBatchUnlink(selectedIds);
            setSelected([]);
            setConfirmingBatch(false);
          }}
          onClose={() => setConfirmingBatch(false)}
        />
      )}

      {unlinking != null && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_ds_unlink')}
          message={localize('com_ui_tars_kb_ds_unlink_confirm', { 0: fileSystemLabel(unlinking) })}
          note={localize('com_ui_tars_kb_ds_unlink_note')}
          confirmLabel={localize('com_ui_tars_kb_ds_unlink')}
          destructive
          isBusy={unlinkMutation.isLoading}
          onConfirm={() => unlinkMutation.mutate(unlinking.dataset_file_system_id)}
          onClose={() => setUnlinking(null)}
        />
      )}

      {syncing != null && (
        <SyncDialog
          link={syncing}
          limits={limits}
          isBusy={refreshMutation.isLoading}
          onConfirm={({ chunkSize, overlap }) =>
            refreshMutation.mutate({
              fileSystemId: syncing.dataset_file_system_id,
              chunkSize,
              overlap,
            })
          }
          onClose={() => setSyncing(null)}
        />
      )}

      {reprocessingGroup != null && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_ds_reprocess_group')}
          message={localize('com_ui_tars_kb_ds_reprocess_group_confirm', {
            0: fileSystemLabel(reprocessingGroup),
          })}
          confirmLabel={localize('com_ui_tars_kb_ds_reprocess_group')}
          isBusy={reprocessMutation.isLoading}
          onConfirm={() => reprocessMutation.mutate(reprocessingGroup.dataset_file_system_id)}
          onClose={() => setReprocessingGroup(null)}
        />
      )}

      {rebuilding != null && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_ds_rebuild')}
          message={localize('com_ui_tars_kb_ds_rebuild_confirm', {
            0: fileSystemLabel(rebuilding),
          })}
          note={localize('com_ui_tars_kb_ds_rebuild_note')}
          confirmLabel={localize('com_ui_tars_kb_ds_rebuild')}
          destructive
          isBusy={rebuildMutation.isLoading}
          onConfirm={() => {
            const { chunkSize, overlap } = recordedChunk(rebuilding);
            rebuildMutation.mutate({
              fileSystemId: rebuilding.dataset_file_system_id,
              chunkSize,
              overlap,
            });
          }}
          onClose={() => setRebuilding(null)}
        />
      )}

      {viewing != null && (
        <GroupDocumentsDialog
          knowledgeBaseId={knowledgeBaseId}
          link={viewing}
          source={sourcesById.get(viewing.dataset_file_system_id) ?? null}
          documents={documents}
          locale={locale}
          isGroupBusy={isBusy}
          onSync={() => setSyncing(viewing)}
          onReprocessGroup={() => setReprocessingGroup(viewing)}
          onRebuild={() => setRebuilding(viewing)}
          onUnlink={() => setUnlinking(viewing)}
          onViewChunks={onViewChunks}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
