import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Library, List, Plus, Search, SlidersHorizontal } from 'lucide-react';
import {
  Button,
  Input,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import {
  useTarsKnowledgeBaseOverviewQuery,
  useDeleteTarsKnowledgeBaseMutation,
} from '~/data-provider';
import { filterByName } from './helpers';
import BatchModal from './BatchModal';
import { useLocalize } from '~/hooks';
import KnowledgeModal from './Modal';
import KnowledgeCards from './Cards';
import KnowledgeTable from './Table';

type ViewMode = 'grid' | 'table';

/** Knowledge-base administration (知識庫管理): list, create, edit, batch settings. */
export default function KnowledgeManager() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();

  const overviewQuery = useTarsKnowledgeBaseOverviewQuery();
  const knowledgeBases = useMemo(
    () => overviewQuery.data?.knowledgeBases ?? [],
    [overviewQuery.data],
  );
  const users = useMemo(() => overviewQuery.data?.users ?? [], [overviewQuery.data]);
  const groups = useMemo(() => overviewQuery.data?.userGroups ?? [], [overviewQuery.data]);

  const [view, setView] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  /** `undefined` = closed, `null` = create, a base = edit. */
  const [editing, setEditing] = useState<TTarsKnowledgeBase | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TTarsKnowledgeBase | null>(null);
  const [showBatch, setShowBatch] = useState(false);

  const filtered = useMemo(() => filterByName(knowledgeBases, search), [knowledgeBases, search]);

  const deleteMutation = useDeleteTarsKnowledgeBaseMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: () =>
      showToast({ message: localize('com_ui_tars_kb_delete_failed'), status: 'error' }),
  });

  const open = (kb: TTarsKnowledgeBase) => navigate(`/knowledge-bases/${kb.id}`);

  const viewButton = (mode: ViewMode, icon: React.ReactNode, label: string) => (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setView(mode)}
      aria-label={label}
      title={label}
      aria-pressed={view === mode}
      className={view === mode ? 'bg-surface-tertiary text-text-primary' : 'text-text-secondary'}
    >
      {icon}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('com_ui_tars_kb_search')}
            aria-label={localize('com_ui_tars_kb_search')}
            className="pl-9"
          />
        </div>

        <Button
          variant="outline"
          onClick={() => setShowBatch(true)}
          disabled={knowledgeBases.length === 0}
          className="gap-1.5"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {localize('com_ui_tars_kb_batch')}
          {selected.length > 0 && (
            <span className="rounded-full bg-brand-primary-subtle px-1.5 text-xs tabular-nums text-brand-primary">
              {selected.length}
            </span>
          )}
        </Button>

        <Button variant="submit" onClick={() => setEditing(null)} className="gap-1.5">
          <Plus className="size-4" aria-hidden />
          {localize('com_ui_tars_kb_new')}
        </Button>

        <div className="ml-auto flex items-center rounded-lg border border-border-light p-0.5">
          {viewButton(
            'grid',
            <LayoutGrid className="size-4" aria-hidden />,
            localize('com_ui_tars_kb_view_grid'),
          )}
          {viewButton(
            'table',
            <List className="size-4" aria-hidden />,
            localize('com_ui_tars_kb_view_table'),
          )}
        </div>
      </div>

      {overviewQuery.isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!overviewQuery.isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-text-secondary">
          <Library className="size-10 text-text-tertiary" aria-hidden />
          {localize(
            knowledgeBases.length === 0
              ? 'com_ui_tars_kb_empty'
              : 'com_ui_tars_kb_no_search_results',
          )}
        </div>
      )}

      {!overviewQuery.isLoading && filtered.length > 0 && view === 'grid' && (
        <KnowledgeCards
          knowledgeBases={filtered}
          onOpen={open}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      )}

      {!overviewQuery.isLoading && filtered.length > 0 && view === 'table' && (
        <KnowledgeTable
          knowledgeBases={filtered}
          selected={selected}
          onSelectedChange={setSelected}
          onOpen={open}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      )}

      {editing !== undefined && (
        <KnowledgeModal
          knowledgeBase={editing}
          users={users}
          groups={groups}
          onClose={() => setEditing(undefined)}
        />
      )}

      {showBatch && (
        <BatchModal
          knowledgeBases={knowledgeBases}
          initialSelection={selected}
          onClose={() => setShowBatch(false)}
        />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_kb_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_kb_delete_confirm_named', { 0: deleting.name })}
                </p>
                {/* pwc_tars cascades to Milvus, chunks and documents. */}
                <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                  {localize('com_ui_tars_kb_delete_warning')}
                </p>
              </div>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleting.id)}
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
