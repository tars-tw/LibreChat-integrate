import { useMemo, useState } from 'react';
import { CheckCircle2, PlugZap, Search, XCircle } from 'lucide-react';
import { TARS_DATABASE_TYPES, TARS_SQLITE_EXTENSIONS } from 'librechat-data-provider';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Switch,
  useToastContext,
} from '@librechat/client';
import type { TTarsDatabaseType, TTarsDatasetDatabase } from 'librechat-data-provider';
import type { DatabaseForm } from './helpers';
import {
  NAME_MAX,
  NAME_MIN,
  databaseIcon,
  defaultPort,
  emptyDatabaseForm,
  connectionFieldsFilled,
  knowledgeBasePickerOptions,
  nameInvalid,
  portInvalid,
  toDatabaseForm,
} from './helpers';
import {
  useCreateTarsDatabaseMutation,
  useUpdateTarsDatabaseMutation,
  useUploadTarsSqliteDatabaseMutation,
  useTestTarsDatabaseConnectionMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';

const isFile = (dbType: TTarsDatabaseType): boolean => dbType === 'SQLite';

/**
 * Create or edit an application-database connection.
 *
 * Three sections in the order an operator fills them: what the connection is,
 * how to reach it, and who may use it. The connection test sits inside the
 * middle section and reports its result in place, so the tables it found are
 * read next to the fields that produced them rather than in a second dialog.
 */
export default function DatabaseModal({
  database,
  knowledgeBases,
  onClose,
}: {
  /** `null` opens the create form. */
  database: TTarsDatasetDatabase | null;
  knowledgeBases: { id: string; name: string }[];
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = database != null;

  const [form, setForm] = useState<DatabaseForm>(
    database != null ? toDatabaseForm(database) : emptyDatabaseForm,
  );
  const [file, setFile] = useState<File | null>(null);
  const [tableFilter, setTableFilter] = useState('');

  const kbOptions = useMemo(() => knowledgeBasePickerOptions(knowledgeBases), [knowledgeBases]);

  const onSaved = () => {
    showToast({ message: localize('com_ui_tars_db_saved'), status: 'success' });
    onClose();
  };
  const onSaveFailed = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? localize('com_ui_tars_db_save_failed'),
      status: 'error',
    });

  const createMutation = useCreateTarsDatabaseMutation({
    onSuccess: onSaved,
    onError: onSaveFailed,
  });
  const uploadMutation = useUploadTarsSqliteDatabaseMutation({
    onSuccess: onSaved,
    onError: onSaveFailed,
  });
  const updateMutation = useUpdateTarsDatabaseMutation({
    onSuccess: onSaved,
    onError: onSaveFailed,
  });
  const testMutation = useTestTarsDatabaseConnectionMutation();

  const set = <K extends keyof DatabaseForm>(key: K, value: DatabaseForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** Switching kind re-applies that kind's default port, as pwc_tars' form does. */
  const selectType = (dbType: TTarsDatabaseType) => {
    testMutation.reset();
    setForm((prev) => ({ ...prev, dbType, port: defaultPort(dbType) }));
  };

  const fileBacked = isFile(form.dbType);
  const oracle = form.dbType === 'Oracle';
  /** A new SQLite row has no file on the pwc_tars side yet, so nothing to open. */
  const canTest = fileBacked
    ? isEdit
    : connectionFieldsFilled(form, isEdit) && !portInvalid(form.port);

  const invalidName = nameInvalid(form.name);
  const missingFile = !isEdit && fileBacked && file == null;
  const invalidConnection =
    !fileBacked && (!connectionFieldsFilled(form, isEdit) || portInvalid(form.port));
  const isSaving = createMutation.isLoading || uploadMutation.isLoading || updateMutation.isLoading;
  const canSave = !invalidName && !missingFile && !invalidConnection && !isSaving;

  const inputPayload = () => ({
    name: form.name.trim(),
    description: form.description,
    dbType: form.dbType,
    host: form.host.trim(),
    port: form.port.trim() === '' ? undefined : Number(form.port),
    databaseName: form.databaseName.trim(),
    username: form.username.trim(),
    password: form.password,
    enabled: form.enabled,
    allowedKmIds: form.allowedKmIds,
  });

  const test = () => testMutation.mutate({ ...inputPayload(), databaseId: database?.id });

  const submit = () => {
    if (!canSave) {
      return;
    }
    if (isEdit) {
      updateMutation.mutate({ id: database.id, data: inputPayload() });
      return;
    }
    if (!fileBacked) {
      createMutation.mutate(inputPayload());
      return;
    }

    const data = new FormData();
    data.append('name', form.name.trim());
    data.append('description', form.description);
    data.append('allowedKmIds', JSON.stringify(form.allowedKmIds));
    if (file != null) {
      data.append('file', file);
    }
    uploadMutation.mutate(data);
  };

  const result = testMutation.data;
  const needle = tableFilter.trim().toLowerCase();
  const matches = (names: string[]) =>
    needle === '' ? names : names.filter((name) => name.toLowerCase().includes(needle));

  const nameList = (title: string, names: string[]) => (
    <div className="space-y-1">
      <p className="text-xs font-medium text-text-secondary">
        {title} ({names.length})
      </p>
      <div className="max-h-32 overflow-y-auto rounded-md border border-border-light">
        {names.length === 0 ? (
          <p className="px-3 py-2 text-xs text-text-tertiary">
            {localize('com_ui_tars_db_no_tables')}
          </p>
        ) : (
          <ul className="divide-y divide-border-light">
            {names.map((name) => (
              <li
                key={name}
                className="truncate px-3 py-1.5 text-xs text-text-primary"
                title={name}
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize(isEdit ? 'com_ui_tars_db_edit' : 'com_ui_tars_db_new')}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        mainClassName="min-w-0"
        main={
          <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto pr-1">
            <section className="space-y-3">
              <p className="text-sm font-medium text-text-primary">
                {localize('com_ui_tars_db_section_basic')}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tars-db-name">
                    {localize('com_ui_tars_db_name')}
                    <span className="ml-0.5 text-pwc-danger">*</span>
                  </Label>
                  <Input
                    id="tars-db-name"
                    value={form.name}
                    onChange={(event) => set('name', event.target.value)}
                    placeholder={localize('com_ui_tars_db_name_placeholder')}
                  />
                  {form.name !== '' && invalidName && (
                    <p className="text-xs text-pwc-danger">
                      {localize('com_ui_tars_db_name_invalid', {
                        0: String(NAME_MIN),
                        1: String(NAME_MAX),
                      })}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tars-db-description">{localize('com_ui_description')}</Label>
                  <Input
                    id="tars-db-description"
                    value={form.description}
                    onChange={(event) => set('description', event.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="tars-db-enabled">{localize('com_ui_tars_db_enabled')}</Label>
                <Switch
                  id="tars-db-enabled"
                  aria-label={localize('com_ui_tars_db_enabled')}
                  checked={form.enabled}
                  onCheckedChange={(checked) => set('enabled', checked)}
                />
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-sm font-medium text-text-primary">
                {localize('com_ui_tars_db_section_connection')}
              </p>

              <div
                role="radiogroup"
                aria-label={localize('com_ui_tars_db_type')}
                className="grid grid-cols-2 gap-2 sm:grid-cols-5"
              >
                {TARS_DATABASE_TYPES.map((type) => {
                  const Icon = databaseIcon(type);
                  const active = form.dbType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      /** The stored kind decides which columns pwc_tars writes;
                       *  changing it on an existing row would orphan its data. */
                      disabled={isEdit}
                      onClick={() => selectType(type)}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors disabled:opacity-60 ${
                        active
                          ? 'border-brand-primary bg-brand-primary-subtle text-text-primary'
                          : 'border-border-light text-text-secondary hover:bg-surface-hover'
                      }`}
                    >
                      <Icon className="size-4" aria-hidden />
                      {type}
                    </button>
                  );
                })}
              </div>

              {fileBacked ? (
                <div className="space-y-1.5">
                  <Label htmlFor="tars-db-file">{localize('com_ui_tars_db_sqlite_file')}</Label>
                  {isEdit ? (
                    <p className="rounded-md border border-border-light px-3 py-2 text-sm text-text-secondary">
                      {form.databaseName || '—'}
                      <span className="ml-2 text-xs text-text-tertiary">
                        {localize('com_ui_tars_db_sqlite_locked')}
                      </span>
                    </p>
                  ) : (
                    <>
                      <Input
                        id="tars-db-file"
                        type="file"
                        accept={TARS_SQLITE_EXTENSIONS.join(',')}
                        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                      />
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_tars_db_sqlite_hint')}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="tars-db-host">
                        {localize('com_ui_tars_db_host')}
                        <span className="ml-0.5 text-pwc-danger">*</span>
                      </Label>
                      <Input
                        id="tars-db-host"
                        value={form.host}
                        onChange={(event) => set('host', event.target.value)}
                        placeholder="10.0.0.1"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tars-db-port">
                        {localize('com_ui_tars_db_port')}
                        <span className="ml-0.5 text-pwc-danger">*</span>
                      </Label>
                      <Input
                        id="tars-db-port"
                        inputMode="numeric"
                        value={form.port}
                        onChange={(event) => set('port', event.target.value)}
                        placeholder={defaultPort(form.dbType)}
                      />
                      {form.port !== '' && portInvalid(form.port) && (
                        <p className="text-xs text-pwc-danger">
                          {localize('com_ui_tars_db_port_invalid')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="tars-db-database">
                      {localize(oracle ? 'com_ui_tars_db_service_name' : 'com_ui_tars_db_database')}
                      <span className="ml-0.5 text-pwc-danger">*</span>
                    </Label>
                    <Input
                      id="tars-db-database"
                      value={form.databaseName}
                      onChange={(event) => set('databaseName', event.target.value)}
                    />
                    {oracle && (
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_tars_db_oracle_hint')}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="tars-db-username">
                        {localize('com_ui_tars_db_username')}
                        {!isEdit && <span className="ml-0.5 text-pwc-danger">*</span>}
                      </Label>
                      <Input
                        id="tars-db-username"
                        autoComplete="off"
                        value={form.username}
                        onChange={(event) => set('username', event.target.value)}
                        placeholder={isEdit ? localize('com_ui_tars_db_account_keep') : undefined}
                      />
                      {isEdit && (
                        <p className="text-xs text-text-secondary">
                          {localize('com_ui_tars_db_account_keep')}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tars-db-password">
                        {localize('com_ui_tars_db_password')}
                        {!isEdit && <span className="ml-0.5 text-pwc-danger">*</span>}
                      </Label>
                      <Input
                        id="tars-db-password"
                        type="password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(event) => set('password', event.target.value)}
                        placeholder={isEdit ? localize('com_ui_tars_db_password_keep') : undefined}
                      />
                      {isEdit && (
                        <p className="text-xs text-text-secondary">
                          {localize('com_ui_tars_db_password_keep')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2 rounded-lg border border-border-light p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={test}
                    disabled={!canTest || testMutation.isLoading}
                    className="gap-1.5"
                  >
                    {testMutation.isLoading ? (
                      <Spinner className="size-4" />
                    ) : (
                      <PlugZap className="size-4" aria-hidden />
                    )}
                    {localize(
                      testMutation.isLoading ? 'com_ui_tars_db_testing' : 'com_ui_tars_db_test',
                    )}
                  </Button>

                  {testMutation.isSuccess && result != null && (
                    <span className="flex items-center gap-1.5 text-sm text-pwc-success">
                      <CheckCircle2 className="size-4" aria-hidden />
                      {localize('com_ui_tars_db_test_success', {
                        0: String(result.tables.length),
                        1: String(result.views.length),
                      })}
                    </span>
                  )}

                  {testMutation.isError && (
                    <span className="flex items-center gap-1.5 text-sm text-pwc-danger">
                      <XCircle className="size-4" aria-hidden />
                      {errorMessage(testMutation.error) ?? localize('com_ui_tars_db_test_failed')}
                    </span>
                  )}
                </div>

                {testMutation.isSuccess && result != null && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
                        aria-hidden
                      />
                      <Input
                        value={tableFilter}
                        onChange={(event) => setTableFilter(event.target.value)}
                        placeholder={localize('com_ui_tars_db_search_table')}
                        aria-label={localize('com_ui_tars_db_search_table')}
                        className="pl-9"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {nameList(localize('com_ui_tars_db_tables'), matches(result.tables))}
                      {nameList(localize('com_ui_tars_db_views'), matches(result.views))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3 rounded-lg border border-border-light p-3">
              <p className="text-sm font-medium text-text-primary">
                {localize('com_ui_tars_db_section_access')}
              </p>
              <p className="text-xs text-text-secondary">
                {localize('com_ui_tars_db_allowed_kbs_hint')}
              </p>
              <Picker
                id="tars-db-kbs"
                label={localize('com_ui_tars_db_allowed_kbs')}
                options={kbOptions}
                selected={form.allowedKmIds}
                onChange={(values) => set('allowedKmIds', values)}
                placeholder={localize('com_ui_tars_db_allowed_kbs_none')}
              />
            </section>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={submit} disabled={!canSave}>
            {isSaving ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}

/** pwc_tars explains why it refused a connection; that beats a generic string. */
function errorMessage(error: unknown): string | null {
  const response = (error as { response?: { data?: { error?: unknown } } })?.response;
  const detail = response?.data?.error;
  return typeof detail === 'string' && detail !== '' ? detail : null;
}
