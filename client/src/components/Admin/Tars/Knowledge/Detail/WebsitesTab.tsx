import { useMemo, useState } from 'react';
import { ExternalLink, Layers, Pencil, Trash2 } from 'lucide-react';
import { Button, Checkbox, useToastContext } from '@librechat/client';
import type { TTarsDatasetWebsite } from 'librechat-data-provider';
import { enabledStatusMeta, formatCount, matchesName, websiteLabel } from './helpers';
import { useDeleteTarsWebsiteMutation } from '~/data-provider';
import Pagination, { usePagination } from '../Pagination';
import { formatDateTime } from '../../Users/helpers';
import WebsiteDialog from './WebsiteDialog';
import ConfirmDialog from './ConfirmDialog';
import StatusBadge from './StatusBadge';
import { useLocalize } from '~/hooks';
import Toolbar from './Toolbar';

/** The crawled-website datasets of a knowledge base. */
export default function WebsitesTab({
  knowledgeBaseId,
  websites,
  locale,
  onRefresh,
  isRefreshing,
  onBatchDelete,
  onViewChunks,
}: {
  knowledgeBaseId: string;
  websites: TTarsDatasetWebsite[];
  locale: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  onBatchDelete: (websiteIds: string[]) => void;
  onViewChunks: (website: TTarsDatasetWebsite) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  /** `undefined` = closed, `null` = import, a row = edit. */
  const [editing, setEditing] = useState<TTarsDatasetWebsite | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TTarsDatasetWebsite | null>(null);

  const visible = useMemo(
    () => websites.filter((site) => matchesName(websiteLabel(site), search)),
    [websites, search],
  );

  /** The filtered list is what gets paged, so a search resets to page one
   *  by way of the clamp rather than by a separate effect. */
  const paged = usePagination(visible);

  const deleteMutation = useDeleteTarsWebsiteMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_deleted'), status: 'success' });
      setDeleting(null);
    },
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
        addLabel={localize('com_ui_tars_kb_ds_import_website')}
        onAdd={() => setEditing(null)}
      />

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize(
            websites.length === 0 ? 'com_ui_tars_kb_ds_no_websites' : 'com_ui_tars_kb_ds_no_match',
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
                      setSelected(checked === true ? paged.rows.map((site) => site.id) : [])
                    }
                    aria-label={localize('com_ui_tars_kb_ds_select_all')}
                  />
                </th>
                <th className="w-[24%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_name')}
                </th>
                <th className="w-[30%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_url')}
                </th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_status')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_tokens')}</th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_created_at')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((site) => (
                <tr key={site.id} className="border-t border-border-light hover:bg-surface-hover">
                  <td className="px-3 py-1.5">
                    <Checkbox
                      checked={selected.includes(site.id)}
                      onCheckedChange={() => toggle(site.id)}
                      aria-label={localize('com_ui_tars_kb_ds_select_one', {
                        0: websiteLabel(site),
                      })}
                    />
                  </td>
                  <td className="max-w-0 px-3 py-1.5">
                    <span className="block truncate text-text-primary" title={site.name ?? ''}>
                      {site.name ?? '—'}
                    </span>
                  </td>
                  <td className="max-w-0 px-3 py-1.5">
                    {site.url == null || site.url === '' ? (
                      <span className="text-text-secondary">—</span>
                    ) : (
                      /* The crawled site is external, so it opens in its own tab. */
                      <a
                        href={site.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex min-w-0 items-center gap-1 text-brand-primary hover:underline"
                        title={site.url}
                      >
                        <span className="truncate">{site.url}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusBadge meta={enabledStatusMeta(site.status)} />
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-text-secondary">
                    {formatCount(site.tokens)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                    {formatDateTime(site.created_at, locale)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onViewChunks(site)}
                        aria-label={localize('com_ui_tars_kb_view_chunks')}
                        title={localize('com_ui_tars_kb_view_chunks')}
                      >
                        <Layers className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setEditing(site)}
                        aria-label={localize('com_ui_edit')}
                        title={localize('com_ui_edit')}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setDeleting(site)}
                        aria-label={localize('com_ui_delete')}
                        title={localize('com_ui_delete')}
                        className="text-pwc-danger"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > 0 && <Pagination state={paged} />}

      {editing !== undefined && (
        <WebsiteDialog
          knowledgeBaseId={knowledgeBaseId}
          website={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      {deleting != null && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_ds_delete_website')}
          message={localize('com_ui_tars_kb_ds_delete_confirm', { 0: websiteLabel(deleting) })}
          note={localize('com_ui_tars_kb_ds_delete_warning')}
          confirmLabel={localize('com_ui_delete')}
          destructive
          isBusy={deleteMutation.isLoading}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
