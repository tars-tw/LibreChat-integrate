import { useEffect, useMemo, useState } from 'react';
import { Eye, Search, Table2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dropdown,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsDatasetDatabase } from 'librechat-data-provider';
import { useBindTarsDatabaseMutation, useTarsDatabaseTablesQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Binds a database's tables to a knowledge base.
 *
 * Listing the tables opens a real connection, so it is a deliberate step rather
 * than something that happens as soon as the dialog opens. pwc_tars treats a
 * re-bind with a different list as an adjustment, so the same dialog serves
 * both cases.
 */
export default function DatabaseBindDialog({
  knowledgeBaseId,
  database,
  bindable,
  onClose,
}: {
  knowledgeBaseId: string;
  /** `null` opens the picker for a connection not yet bound. */
  database: TTarsDatasetDatabase | null;
  bindable: TTarsDatasetDatabase[];
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isAdjusting = database != null;

  const [chosenId, setChosenId] = useState(database?.id ?? bindable[0]?.id ?? '');
  /** Only set once the operator asks, so the connection is not opened on open. */
  const [inspectId, setInspectId] = useState<string | null>(
    isAdjusting ? (database?.id ?? null) : null,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const tablesQuery = useTarsDatabaseTablesQuery(knowledgeBaseId, inspectId);

  useEffect(() => {
    if (tablesQuery.data != null) {
      setSelected(tablesQuery.data.bound);
    }
  }, [tablesQuery.data]);

  const entries = useMemo(() => {
    const data = tablesQuery.data;
    if (data == null) {
      return [] as { name: string; isView: boolean }[];
    }
    return [
      ...data.tables.map((name) => ({ name, isView: false })),
      ...data.views.map((name) => ({ name, isView: true })),
    ];
  }, [tablesQuery.data]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === ''
      ? entries
      : entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [entries, filter]);

  const bindMutation = useBindTarsDatabaseMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_bound'), status: 'success' });
      onClose();
    },
    onError: () =>
      showToast({ message: localize('com_ui_tars_kb_ds_bind_failed'), status: 'error' }),
  });

  const toggle = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((v) => v !== name) : [...prev, name]));

  /**
   * Three states — not connected yet, connecting, connected — read better as
   * early returns than as a nested ternary in the middle of the markup.
   */
  const tablePicker = () => {
    if (inspectId !== chosenId || tablesQuery.isError) {
      return (
        <div className="space-y-2 rounded-lg border border-border-light p-4 text-center">
          <p className="text-sm text-text-secondary">
            {localize(
              tablesQuery.isError
                ? 'com_ui_tars_kb_ds_connect_failed'
                : 'com_ui_tars_kb_ds_connect_hint',
            )}
          </p>
          <Button
            variant="outline"
            onClick={() => setInspectId(chosenId)}
            disabled={chosenId === ''}
            className="gap-1.5"
          >
            <Eye className="size-4" aria-hidden />
            {localize('com_ui_tars_kb_ds_list_tables')}
          </Button>
        </div>
      );
    }

    if (tablesQuery.isFetching) {
      return (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-text-secondary">
          <Spinner className="size-4" />
          {localize('com_ui_tars_kb_ds_connecting')}
        </div>
      );
    }

    return (
      <>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
              aria-hidden
            />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={localize('com_ui_tars_audit_search_placeholder')}
              aria-label={localize('com_ui_tars_kb_ds_filter_tables')}
              className="pl-9"
            />
          </div>
          <span className="shrink-0 text-sm text-text-secondary">
            {localize('com_ui_tars_audit_selected_count', { 0: String(selected.length) })}
          </span>
        </div>

        {entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_kb_ds_no_tables')}
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-border-light overflow-y-auto rounded-lg border border-border-light">
            {visible.map((entry) => (
              <li key={`${entry.isView ? 'view' : 'table'}-${entry.name}`}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover">
                  <Checkbox
                    checked={selected.includes(entry.name)}
                    onCheckedChange={() => toggle(entry.name)}
                    aria-label={entry.name}
                  />
                  <Table2 className="size-4 shrink-0 text-text-secondary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-text-primary">{entry.name}</span>
                  {entry.isView && (
                    <span className="shrink-0 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                      {localize('com_ui_tars_kb_ds_view')}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}

        {/* Binding re-reads and re-embeds every chosen table. */}
        <p className="text-xs text-text-secondary">{localize('com_ui_tars_kb_ds_import_slow')}</p>
      </>
    );
  };

  const canBind = chosenId !== '' && selected.length > 0 && !bindMutation.isLoading;

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !bindMutation.isLoading && onClose()}>
      <OGDialogTemplate
        title={localize(
          isAdjusting ? 'com_ui_tars_kb_ds_adjust_tables' : 'com_ui_tars_kb_ds_bind_database',
        )}
        className="w-11/12 md:max-w-2xl"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={
          <div className="max-h-[70vh] min-w-0 space-y-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label id="tars-db-pick-label">{localize('com_ui_tars_kb_ds_connection')}</Label>
              {isAdjusting ? (
                <p className="flex h-10 items-center rounded-md border border-border-light px-3 text-sm text-text-primary">
                  {database?.name}
                </p>
              ) : (
                <Dropdown
                  value={chosenId}
                  onChange={(value) => {
                    setChosenId(value);
                    setInspectId(null);
                    setSelected([]);
                  }}
                  options={bindable.map((row) => ({ value: row.id, label: row.name }))}
                  aria-labelledby="tars-db-pick-label"
                  searchable={bindable.length > 8}
                  searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
                  searchEmptyText={localize('com_ui_no_results_found')}
                  sizeClasses="w-full"
                  className="w-full"
                />
              )}
            </div>

            {tablePicker()}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            disabled={!canBind}
            onClick={() => bindMutation.mutate({ databaseId: chosenId, tables: selected })}
          >
            {bindMutation.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
