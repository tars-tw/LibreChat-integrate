import { useMemo, useState } from 'react';
import { FileText, Table2, Unlink } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import type { TTarsDatasetDatabase } from 'librechat-data-provider';
import { useUnbindTarsDatabaseMutation } from '~/data-provider';
import { enabledStatusMeta, matchesName } from './helpers';
import DatabasePromptDialog from './DatabasePromptDialog';
import Pagination, { usePagination } from '../Pagination';
import DatabaseBindDialog from './DatabaseBindDialog';
import { formatDateTime } from '../../Users/helpers';
import ConfirmDialog from './ConfirmDialog';
import StatusBadge from './StatusBadge';
import { useLocalize } from '~/hooks';
import Toolbar from './Toolbar';

/** How a connection identifies itself when its name is not enough. */
const target = (database: TTarsDatasetDatabase): string => {
  const parts = [database.db_type, database.host, database.database_name].filter(
    (part) => part != null && part !== '',
  );
  return parts.length > 0 ? parts.join(' · ') : '—';
};

/**
 * The SQL connections bound to a knowledge base.
 *
 * Connections are defined elsewhere in pwc_tars; this page only binds existing
 * ones and chooses which of their tables the knowledge base may query.
 */
export default function DatabasesTab({
  knowledgeBaseId,
  databases,
  available,
  locale,
  onRefresh,
  isRefreshing,
}: {
  knowledgeBaseId: string;
  databases: TTarsDatasetDatabase[];
  available: TTarsDatasetDatabase[];
  locale: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [search, setSearch] = useState('');
  /** `undefined` = closed, `null` = bind a new one, a row = adjust its tables. */
  const [binding, setBinding] = useState<TTarsDatasetDatabase | null | undefined>(undefined);
  const [prompting, setPrompting] = useState<TTarsDatasetDatabase | null>(null);
  const [unbinding, setUnbinding] = useState<TTarsDatasetDatabase | null>(null);

  const visible = useMemo(
    () => databases.filter((database) => matchesName(database.name, search)),
    [databases, search],
  );

  /** The filtered list is what gets paged, so a search resets to page one
   *  by way of the clamp rather than by a separate effect. */
  const paged = usePagination(visible);

  /** Offering an already-bound connection again would just re-bind it. */
  const bindable = useMemo(() => {
    const bound = new Set(databases.map((database) => database.id));
    return available.filter((database) => !bound.has(database.id));
  }, [available, databases]);

  const unbindMutation = useUnbindTarsDatabaseMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_unbound'), status: 'success' });
      setUnbinding(null);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  return (
    <div className="space-y-3">
      <Toolbar
        search={search}
        onSearchChange={setSearch}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        addLabel={localize('com_ui_tars_kb_ds_bind_database')}
        onAdd={() => setBinding(null)}
        addDisabled={bindable.length === 0}
      />

      {available.length === 0 && (
        /* Connections are created in pwc_tars itself, so an empty list is a
           setup fact rather than a failure — say which, or it reads as a bug. */
        <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
          {localize('com_ui_tars_kb_ds_no_connections')}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize(
            databases.length === 0
              ? 'com_ui_tars_kb_ds_no_databases'
              : 'com_ui_tars_kb_ds_no_match',
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead className="bg-surface-secondary">
              <tr className="text-left text-text-secondary">
                <th className="w-[28%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_name')}
                </th>
                <th className="w-[32%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_connection')}
                </th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_status')}</th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_ui_tars_kb_ds_created_at')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((database) => (
                <tr
                  key={database.id}
                  className="border-t border-border-light hover:bg-surface-hover"
                >
                  <td className="max-w-0 px-3 py-1.5">
                    <span className="block truncate text-text-primary" title={database.name}>
                      {database.name}
                    </span>
                  </td>
                  <td className="max-w-0 px-3 py-1.5 text-text-secondary">
                    <span className="block truncate" title={target(database)}>
                      {target(database)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusBadge meta={enabledStatusMeta(database.status)} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                    {formatDateTime(database.created_at, locale)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setBinding(database)}
                        aria-label={localize('com_ui_tars_kb_ds_adjust_tables')}
                        title={localize('com_ui_tars_kb_ds_adjust_tables')}
                      >
                        <Table2 className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setPrompting(database)}
                        aria-label={localize('com_ui_tars_kb_ds_sql_prompt')}
                        title={localize('com_ui_tars_kb_ds_sql_prompt')}
                      >
                        <FileText className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setUnbinding(database)}
                        aria-label={localize('com_ui_tars_kb_ds_unbind')}
                        title={localize('com_ui_tars_kb_ds_unbind')}
                        className="text-pwc-danger"
                      >
                        <Unlink className="size-4" aria-hidden />
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

      {binding !== undefined && (
        <DatabaseBindDialog
          knowledgeBaseId={knowledgeBaseId}
          database={binding}
          bindable={bindable}
          onClose={() => setBinding(undefined)}
        />
      )}

      {prompting != null && (
        <DatabasePromptDialog
          knowledgeBaseId={knowledgeBaseId}
          database={prompting}
          onClose={() => setPrompting(null)}
        />
      )}

      {unbinding != null && (
        <ConfirmDialog
          title={localize('com_ui_tars_kb_ds_unbind')}
          message={localize('com_ui_tars_kb_ds_unbind_confirm', { 0: unbinding.name })}
          note={localize('com_ui_tars_kb_ds_unbind_note')}
          confirmLabel={localize('com_ui_tars_kb_ds_unbind')}
          destructive
          isBusy={unbindMutation.isLoading}
          onConfirm={() => unbindMutation.mutate(unbinding.id)}
          onClose={() => setUnbinding(null)}
        />
      )}
    </div>
  );
}
