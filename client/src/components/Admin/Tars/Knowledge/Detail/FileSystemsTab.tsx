import { useMemo, useState } from 'react';
import { RefreshCcw, RotateCw, Unlink } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import type { TTarsDatasetFileSystemLink, TTarsDocument } from 'librechat-data-provider';
import {
  useRefreshTarsFileSystemMutation,
  useReprocessTarsFileSystemMutation,
  useUnlinkTarsFileSystemMutation,
} from '~/data-provider';
import { DOC_STATUS, enabledStatusMeta, fileSystemLabel, matchesName } from './helpers';
import FileSystemImportDialog from './FileSystemImportDialog';
import Pagination, { usePagination } from '../Pagination';
import { formatDateTime } from '../../Users/helpers';
import ConfirmDialog from './ConfirmDialog';
import StatusBadge from './StatusBadge';
import { useLocalize } from '~/hooks';
import Toolbar from './Toolbar';

/**
 * The document groups a knowledge base pulls from file servers.
 *
 * pwc_tars has no batch-delete list for these, so there is no selection column:
 * a group is removed as a whole by unlinking it.
 */
export default function FileSystemsTab({
  knowledgeBaseId,
  links,
  documents,
  locale,
  onRefresh,
  isRefreshing,
}: {
  knowledgeBaseId: string;
  links: TTarsDatasetFileSystemLink[];
  documents: TTarsDocument[];
  locale: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [search, setSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [unlinking, setUnlinking] = useState<TTarsDatasetFileSystemLink | null>(null);

  const visible = useMemo(
    () => links.filter((link) => matchesName(fileSystemLabel(link), search)),
    [links, search],
  );

  /** The filtered list is what gets paged, so a search resets to page one
   *  by way of the clamp rather than by a separate effect. */
  const paged = usePagination(visible);

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
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_kb_ds_sync_started'), status: 'success' }),
    onError,
  });

  const reprocessMutation = useReprocessTarsFileSystemMutation(knowledgeBaseId, {
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_kb_reprocess_started'), status: 'success' }),
    onError,
  });

  const unlinkMutation = useUnlinkTarsFileSystemMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_unlinked'), status: 'success' });
      setUnlinking(null);
    },
    onError,
  });

  const isBusy = refreshMutation.isLoading || reprocessMutation.isLoading;

  return (
    <div className="space-y-3">
      <Toolbar
        search={search}
        onSearchChange={setSearch}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
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
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead className="bg-surface-secondary">
              <tr className="text-left text-text-secondary">
                <th className="w-[36%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_name')}
                </th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_status')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_ds_progress')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_ds_sync_mode')}</th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_created_at')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((link) => {
                const counts = progress.get(link.dataset_file_system_id) ?? { done: 0, total: 0 };
                return (
                  <tr key={link.id} className="border-t border-border-light hover:bg-surface-hover">
                    <td className="max-w-0 px-3 py-1.5">
                      <span
                        className="block truncate text-text-primary"
                        title={fileSystemLabel(link)}
                      >
                        {fileSystemLabel(link)}
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
                    <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                      {formatDateTime(link.created_at, locale)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isBusy}
                          onClick={() =>
                            refreshMutation.mutate({ fileSystemId: link.dataset_file_system_id })
                          }
                          aria-label={localize('com_ui_tars_kb_ds_sync')}
                          title={localize('com_ui_tars_kb_ds_sync')}
                        >
                          <RefreshCcw className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={isBusy}
                          onClick={() => reprocessMutation.mutate(link.dataset_file_system_id)}
                          aria-label={localize('com_ui_tars_kb_ds_reprocess_group')}
                          title={localize('com_ui_tars_kb_ds_reprocess_group')}
                        >
                          <RotateCw className="size-4" aria-hidden />
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
          onClose={() => setShowImport(false)}
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
    </div>
  );
}
