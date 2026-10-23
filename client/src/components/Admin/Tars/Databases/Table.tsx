import { Button } from '@librechat/client';
import { Info, Pencil, Trash2 } from 'lucide-react';
import type { TTarsDatasetDatabase } from 'librechat-data-provider';
import Pagination, { usePagination } from '../Knowledge/Pagination';
import KnowledgeBaseChips from '../Sources/KnowledgeBaseChips';
import { databaseIcon, knowledgeBaseNames } from './helpers';
import { StatusBadge } from '../Users/Fields';
import { useLocalize } from '~/hooks';

/** The application-database list, with the knowledge bases each is granted to. */
export default function DatabaseTable({
  databases,
  knowledgeBaseNamesById,
  onEdit,
  onDelete,
  onDetails,
}: {
  databases: TTarsDatasetDatabase[];
  knowledgeBaseNamesById: Map<string, string>;
  onEdit: (database: TTarsDatasetDatabase) => void;
  onDelete: (database: TTarsDatasetDatabase) => void;
  onDetails: (database: TTarsDatasetDatabase) => void;
}) {
  const localize = useLocalize();
  const paged = usePagination(databases);

  return (
    <div className="space-y-3">
      <div className="border-border-light overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="bg-surface-secondary">
            <tr className="text-text-secondary text-left">
              <th className="w-[15%] px-3 py-2 font-medium">{localize('com_ui_tars_db_name')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_db_type')}</th>
              <th className="w-[10%] px-3 py-2 font-medium">{localize('com_ui_tars_db_host')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_db_port')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_db_database')}</th>
              <th className="w-[22%] px-3 py-2 font-medium">
                {localize('com_ui_tars_db_allowed_kbs')}
              </th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_users_status')}</th>
              <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((database) => {
              const Icon = databaseIcon(database.db_type);
              const fileBacked = database.db_type === 'SQLite';
              const names = knowledgeBaseNames(
                database.allowed_km_ids ?? [],
                knowledgeBaseNamesById,
              );

              return (
                <tr
                  key={database.id}
                  className="border-border-light hover:bg-surface-hover border-t"
                >
                  <td className="max-w-0 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(database)}
                      className="text-text-primary block w-full truncate text-left font-medium hover:underline"
                      title={database.name}
                    >
                      {database.name}
                    </button>
                  </td>
                  <td className="text-text-secondary px-3 py-1.5 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-4" aria-hidden />
                      {database.db_type ?? '—'}
                    </span>
                  </td>
                  <td className="text-text-secondary max-w-0 px-3 py-1.5">
                    <span className="block truncate" title={database.host ?? undefined}>
                      {fileBacked ? '—' : (database.host ?? '—')}
                    </span>
                  </td>
                  <td className="text-text-secondary px-3 py-1.5 tabular-nums">
                    {fileBacked ? '—' : (database.port ?? '—')}
                  </td>
                  <td className="text-text-secondary max-w-0 px-3 py-1.5">
                    <span className="block truncate" title={database.database_name ?? undefined}>
                      {database.database_name ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <KnowledgeBaseChips names={names} />
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusBadge active={database.status !== 0} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDetails(database)}
                        aria-label={localize('com_ui_tars_db_details')}
                        title={localize('com_ui_tars_db_details')}
                        className="hover:text-pwc-info text-[rgb(var(--pwc-info))]"
                      >
                        <Info className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onEdit(database)}
                        aria-label={localize('com_ui_edit')}
                        title={localize('com_ui_edit')}
                        className="text-text-secondary"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDelete(database)}
                        aria-label={localize('com_ui_delete')}
                        title={localize('com_ui_delete')}
                        className="text-pwc-danger hover:text-pwc-danger"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination state={paged} />
    </div>
  );
}
