import { Button } from '@librechat/client';
import { Info, Pencil, Trash2 } from 'lucide-react';
import type { TTarsDatasetDatabase } from 'librechat-data-provider';
import Pagination, { usePagination } from '../Knowledge/Pagination';
import { databaseIcon, knowledgeBaseNames } from './helpers';
import { useLocalize } from '~/hooks';

/** How many knowledge-base names fit in a cell before the rest become "+N". */
const KB_CHIP_LIMIT = 2;

/**
 * The application-database list.
 *
 * The knowledge-base column is the reason this table exists rather than a card
 * grid: a connection is only useful once it is granted to a base, and that
 * grant was previously invisible until the row was opened.
 */
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
      <div className="overflow-x-auto rounded-lg border border-border-light">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="bg-surface-secondary">
            <tr className="text-left text-text-secondary">
              <th className="w-[18%] px-3 py-2 font-medium">{localize('com_ui_tars_db_name')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_db_type')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_db_host')}</th>
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
              const shown = names.slice(0, KB_CHIP_LIMIT);
              const overflow = names.length - shown.length;

              return (
                <tr
                  key={database.id}
                  className="border-t border-border-light hover:bg-surface-hover"
                >
                  <td className="max-w-0 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(database)}
                      className="block w-full truncate text-left font-medium text-text-primary hover:underline"
                      title={database.name}
                    >
                      {database.name}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-4" aria-hidden />
                      {database.db_type ?? '—'}
                    </span>
                  </td>
                  <td className="max-w-0 px-3 py-1.5 text-text-secondary">
                    <span className="block truncate" title={database.host ?? undefined}>
                      {fileBacked ? '—' : (database.host ?? '—')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-text-secondary">
                    {fileBacked ? '—' : (database.port ?? '—')}
                  </td>
                  <td className="max-w-0 px-3 py-1.5 text-text-secondary">
                    <span className="block truncate" title={database.database_name ?? undefined}>
                      {database.database_name ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    {names.length === 0 ? (
                      <span className="text-text-tertiary">
                        {localize('com_ui_tars_db_allowed_kbs_none')}
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1" title={names.join(', ')}>
                        {shown.map((name) => (
                          <span
                            key={name}
                            className="max-w-[10rem] truncate rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary"
                          >
                            {name}
                          </span>
                        ))}
                        {overflow > 0 && (
                          <span className="text-xs text-text-tertiary">+{overflow}</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span
                      className={
                        database.status === 0 ? 'text-text-tertiary' : 'text-text-secondary'
                      }
                    >
                      {localize(
                        database.status === 0
                          ? 'com_ui_tars_db_status_disabled'
                          : 'com_ui_tars_db_status_enabled',
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDetails(database)}
                        aria-label={localize('com_ui_tars_db_details')}
                        title={localize('com_ui_tars_db_details')}
                      >
                        <Info className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onEdit(database)}
                        aria-label={localize('com_ui_edit')}
                        title={localize('com_ui_edit')}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDelete(database)}
                        aria-label={localize('com_ui_delete')}
                        title={localize('com_ui_delete')}
                        className="text-pwc-danger"
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
