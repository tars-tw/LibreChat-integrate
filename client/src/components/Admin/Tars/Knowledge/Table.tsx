import { Pencil, Trash2 } from 'lucide-react';
import { Button, Checkbox } from '@librechat/client';
import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import { accessSummaryKey, DEFAULT_MAX_RETRIEVE } from './helpers';
import Pagination, { usePagination } from './Pagination';
import { useLocalize } from '~/hooks';
import DatasetStats from './Stats';

/**
 * The list view of the knowledge-base list.
 *
 * The checkbox column feeds the batch-settings dialog, so it is the one place
 * a row click must not navigate.
 */
export default function KnowledgeTable({
  knowledgeBases,
  selected,
  onSelectedChange,
  onOpen,
  onEdit,
  onDelete,
}: {
  knowledgeBases: TTarsKnowledgeBase[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  onOpen: (kb: TTarsKnowledgeBase) => void;
  onEdit: (kb: TTarsKnowledgeBase) => void;
  onDelete: (kb: TTarsKnowledgeBase) => void;
}) {
  const localize = useLocalize();
  const paged = usePagination(knowledgeBases);

  const allSelected = paged.rows.length > 0 && paged.rows.every((row) => selected.includes(row.id));

  const toggle = (id: string) =>
    onSelectedChange(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border-light">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="bg-surface-secondary">
            <tr className="text-left text-text-secondary">
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    onSelectedChange(checked === true ? paged.rows.map((kb) => kb.id) : [])
                  }
                  aria-label={localize('com_ui_tars_kb_batch_select_all')}
                />
              </th>
              <th className="w-[18%] px-3 py-2 font-medium">{localize('com_ui_tars_kb_name')}</th>
              <th className="w-[26%] px-3 py-2 font-medium">{localize('com_ui_description')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_llm_model')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_max_retrieve')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_datasets')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_access')}</th>
              <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((kb) => (
              <tr key={kb.id} className="border-t border-border-light hover:bg-surface-hover">
                <td className="px-3 py-1.5">
                  <Checkbox
                    checked={selected.includes(kb.id)}
                    onCheckedChange={() => toggle(kb.id)}
                    aria-label={localize('com_ui_tars_kb_batch_select_one', { 0: kb.name })}
                  />
                </td>
                <td className="max-w-0 px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => onOpen(kb)}
                    className="block w-full truncate text-left font-medium text-text-primary hover:underline"
                    title={kb.name}
                  >
                    {kb.name}
                  </button>
                </td>
                <td className="max-w-0 px-3 py-1.5 text-text-secondary">
                  <span className="block truncate" title={kb.description ?? undefined}>
                    {kb.description ?? '—'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-text-secondary">{kb.llm_model ?? '—'}</td>
                <td className="px-3 py-1.5 tabular-nums text-text-secondary">
                  {kb.max_retrieve_count ?? DEFAULT_MAX_RETRIEVE}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <DatasetStats knowledgeBase={kb} />
                </td>
                <td className="px-3 py-1.5 text-text-secondary">
                  {localize(accessSummaryKey(kb))}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onEdit(kb)}
                      aria-label={localize('com_ui_edit')}
                      title={localize('com_ui_edit')}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onDelete(kb)}
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

      <Pagination state={paged} />
    </div>
  );
}
