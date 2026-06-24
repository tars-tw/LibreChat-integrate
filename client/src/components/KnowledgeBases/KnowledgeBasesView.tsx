import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, LayoutGrid, List, Search, FileText, Layers } from 'lucide-react';
import { Button, Input, Spinner, useToastContext } from '@librechat/client';
import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import { useTarsKnowledgeBasesQuery, useDeleteTarsKnowledgeBaseMutation } from '~/data-provider';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import CreateKnowledgeBaseModal from './CreateKnowledgeBaseModal';

type ViewMode = 'grid' | 'table';

export default function KnowledgeBasesView() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isTarsAdmin = useIsTarsAdmin();
  const { showToast } = useToastContext();
  const { data: knowledgeBases = [], isLoading } = useTarsKnowledgeBasesQuery();

  const [view, setView] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const deleteMutation = useDeleteTarsKnowledgeBaseMutation({
    onSuccess: () => showToast({ message: localize('com_ui_tars_kb_deleted'), status: 'success' }),
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return knowledgeBases;
    }
    return knowledgeBases.filter((kb) => kb.name.toLowerCase().includes(q));
  }, [knowledgeBases, search]);

  if (!isTarsAdmin) {
    navigate('/c/new', { replace: true });
    return null;
  }

  const open = (kb: TTarsKnowledgeBase) => navigate(`/knowledge-bases/${kb.id}`);

  const confirmDelete = (kb: TTarsKnowledgeBase, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(localize('com_ui_tars_kb_delete_confirm'))) {
      deleteMutation.mutate(kb.id);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-text-primary">
            {localize('com_ui_tars_knowledge_bases')}
          </h1>
          <Button variant="submit" onClick={() => setShowCreate(true)} className="gap-1">
            <Plus className="icon-sm" /> {localize('com_ui_tars_kb_new')}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={localize('com_ui_tars_kb_search')}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label={localize('com_ui_tars_kb_view_grid')}
              onClick={() => setView('grid')}
              className={`rounded p-2 ${view === 'grid' ? 'bg-surface-tertiary text-text-primary' : 'text-text-secondary hover:bg-surface-hover'}`}
            >
              <LayoutGrid className="icon-sm" />
            </button>
            <button
              type="button"
              aria-label={localize('com_ui_tars_kb_view_table')}
              onClick={() => setView('table')}
              className={`rounded p-2 ${view === 'table' ? 'bg-surface-tertiary text-text-primary' : 'text-text-secondary hover:bg-surface-hover'}`}
            >
              <List className="icon-sm" />
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="py-12 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_kb_empty')}
          </p>
        )}
        {!isLoading && filtered.length > 0 && view === 'grid' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((kb) => (
              <div
                key={kb.id}
                role="button"
                tabIndex={0}
                onClick={() => open(kb)}
                onKeyDown={(e) => e.key === 'Enter' && open(kb)}
                className="group flex cursor-pointer flex-col rounded-xl border border-border-light p-4 transition-colors hover:border-border-heavy hover:bg-surface-hover"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate font-medium text-text-primary">{kb.name}</span>
                  <button
                    type="button"
                    aria-label={localize('com_ui_delete')}
                    onClick={(e) => confirmDelete(kb, e)}
                    className="rounded p-1 text-red-500 opacity-0 hover:bg-surface-hover group-hover:opacity-100"
                  >
                    <Trash2 className="icon-sm" />
                  </button>
                </div>
                {kb.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{kb.description}</p>
                )}
                <div className="mt-auto flex flex-wrap gap-3 pt-4 text-xs text-text-secondary">
                  <span className="flex items-center gap-1">
                    <FileText className="icon-xs" /> {kb.document_count ?? 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <Layers className="icon-xs" /> {kb.total_chunk_count ?? 0}
                  </span>
                  {kb.llm_model && <span className="truncate">{kb.llm_model}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {!isLoading && filtered.length > 0 && view === 'table' && (
          <div className="overflow-hidden rounded-lg border border-border-light">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  <th className="px-4 py-2 font-medium">{localize('com_ui_name')}</th>
                  <th className="px-4 py-2 font-medium">{localize('com_ui_tars_kb_llm_model')}</th>
                  <th className="px-4 py-2 font-medium">{localize('com_ui_tars_kb_documents')}</th>
                  <th className="px-4 py-2 font-medium">{localize('com_ui_tars_kb_chunks')}</th>
                  <th className="px-4 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((kb) => (
                  <tr
                    key={kb.id}
                    onClick={() => open(kb)}
                    className="cursor-pointer border-t border-border-light hover:bg-surface-hover"
                  >
                    <td className="max-w-0 px-4 py-2">
                      <span className="block truncate text-text-primary">{kb.name}</span>
                    </td>
                    <td className="px-4 py-2 text-text-secondary">{kb.llm_model ?? '—'}</td>
                    <td className="px-4 py-2 text-text-secondary">{kb.document_count ?? 0}</td>
                    <td className="px-4 py-2 text-text-secondary">{kb.total_chunk_count ?? 0}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          aria-label={localize('com_ui_delete')}
                          onClick={(e) => confirmDelete(kb, e)}
                          className="rounded p-1.5 text-red-500 hover:bg-surface-hover"
                        >
                          <Trash2 className="icon-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <CreateKnowledgeBaseModal open={showCreate} onOpenChange={setShowCreate} />}
    </div>
  );
}
