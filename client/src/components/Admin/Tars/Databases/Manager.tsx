import { useMemo, useState } from 'react';
import { Database, Plus, Search } from 'lucide-react';
import { TARS_DATABASE_TYPES } from 'librechat-data-provider';
import {
  Button,
  Dropdown,
  Input,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsDatasetDatabase } from 'librechat-data-provider';
import {
  useTarsDatabasesQuery,
  useDeleteTarsDatabaseMutation,
  useTarsKnowledgeBaseOverviewQuery,
} from '~/data-provider';
import { filterDatabases } from './helpers';
import DatabaseDetails from './Details';
import { useLocalize } from '~/hooks';
import DatabaseTable from './Table';
import DatabaseModal from './Modal';

const ALL_TYPES = '';

/**
 * Application-database administration (資料源管理 → 應用資料庫): the master list
 * of the connections a knowledge base can query, and which bases may use each.
 */
export default function DatabaseManager() {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const databasesQuery = useTarsDatabasesQuery();
  const overviewQuery = useTarsKnowledgeBaseOverviewQuery();

  const databases = useMemo(() => databasesQuery.data ?? [], [databasesQuery.data]);
  const knowledgeBases = useMemo(
    () => overviewQuery.data?.knowledgeBases ?? [],
    [overviewQuery.data],
  );
  const knowledgeBaseNamesById = useMemo(
    () => new Map(knowledgeBases.map((kb) => [kb.id, kb.name])),
    [knowledgeBases],
  );

  const [search, setSearch] = useState('');
  const [dbType, setDbType] = useState<string>(ALL_TYPES);
  /** `undefined` = closed, `null` = create, a row = edit. */
  const [editing, setEditing] = useState<TTarsDatasetDatabase | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TTarsDatasetDatabase | null>(null);
  const [details, setDetails] = useState<TTarsDatasetDatabase | null>(null);

  const filtered = useMemo(
    () => filterDatabases(databases, search, dbType),
    [databases, search, dbType],
  );

  const deleteMutation = useDeleteTarsDatabaseMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_db_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: () =>
      showToast({ message: localize('com_ui_tars_db_delete_failed'), status: 'error' }),
  });

  const typeOptions = [
    { value: ALL_TYPES, label: localize('com_ui_tars_db_all_types') },
    ...TARS_DATABASE_TYPES.map((type) => ({ value: type, label: type })),
  ];

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
            placeholder={localize('com_ui_tars_db_search')}
            aria-label={localize('com_ui_tars_db_search')}
            className="pl-9"
          />
        </div>

        <Dropdown
          value={dbType}
          onChange={setDbType}
          options={typeOptions}
          aria-label={localize('com_ui_tars_db_type')}
          sizeClasses="min-w-[9rem]"
        />

        <Button variant="submit" onClick={() => setEditing(null)} className="gap-1.5">
          <Plus className="size-4" aria-hidden />
          {localize('com_ui_tars_db_new')}
        </Button>
      </div>

      {databasesQuery.isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!databasesQuery.isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-text-secondary">
          <Database className="size-10 text-text-tertiary" aria-hidden />
          {localize(
            databases.length === 0 ? 'com_ui_tars_db_empty' : 'com_ui_tars_db_no_search_results',
          )}
        </div>
      )}

      {!databasesQuery.isLoading && filtered.length > 0 && (
        <DatabaseTable
          databases={filtered}
          knowledgeBaseNamesById={knowledgeBaseNamesById}
          onEdit={setEditing}
          onDelete={setDeleting}
          onDetails={setDetails}
        />
      )}

      {editing !== undefined && (
        <DatabaseModal
          database={editing}
          knowledgeBases={knowledgeBases}
          onClose={() => setEditing(undefined)}
        />
      )}

      {details != null && (
        <DatabaseDetails
          database={details}
          knowledgeBaseNamesById={knowledgeBaseNamesById}
          onClose={() => setDetails(null)}
        />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_db_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_db_delete_confirm_named', { 0: deleting.name })}
                </p>
                {/* Knowledge bases bound to the connection lose their tables with it. */}
                <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                  {localize('com_ui_tars_db_delete_warning')}
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
