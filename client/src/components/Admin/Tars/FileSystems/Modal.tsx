import { useMemo, useState } from 'react';
import { TARS_FILE_PROTOCOLS } from 'librechat-data-provider';
import { AlertTriangle, CheckCircle2, PlugZap, Search, XCircle } from 'lucide-react';
import {
  Button,
  Dropdown,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsFileProtocol, TTarsFileSystemSource } from 'librechat-data-provider';
import type { FileSystemForm } from './helpers';
import {
  NAME_MAX,
  NAME_MIN,
  defaultPort,
  errorMessage,
  emptyFileSystemForm,
  needsCredentials,
  usesHostName,
  connectionFieldsFilled,
  knowledgeBasePickerOptions,
  nameInvalid,
  portInvalid,
  protocolIcon,
  toFileRows,
  folderOptions,
  missingFolder,
  listsNfsExports,
  listsSmbShares,
  toFileSystemForm,
  fileServerTestPath,
  folderWithinTested,
  buildFullFolderPath,
  selectedFolderOption,
} from './helpers';
import {
  useCreateTarsFileSystemMutation,
  useUpdateTarsFileSystemMutation,
  useTestTarsFileSystemConnectionMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';

/** How many walked files the preview lists before it asks for a filter. */
const FILE_PREVIEW_LIMIT = 200;
/** How many skipped folders the warning lists before it scrolls. */
const UNREADABLE_PREVIEW_LIMIT = 50;

/** What the last connection test walked. */
interface TestedFolder {
  path: string;
  /** NFS only: it asked for the server's exports instead of walking `path`. */
  listExports: boolean;
}

const isTimeout = (error: unknown): boolean =>
  (error as { response?: { status?: number } })?.response?.status === 504;

/**
 * Create or edit a document group.
 *
 * Three sections in the order an operator fills them: what the group is, how to
 * reach the share, and who may import from it. The connection test sits inside
 * the middle section and reports in place, so the files it found are read next
 * to the fields that produced them rather than in a second dialog.
 */
export default function FileSystemModal({
  fileSystem,
  knowledgeBases,
  onClose,
}: {
  /** `null` opens the create form. */
  fileSystem: TTarsFileSystemSource | null;
  knowledgeBases: { id: string; name: string }[];
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = fileSystem != null;

  const [form, setForm] = useState<FileSystemForm>(
    fileSystem != null ? toFileSystemForm(fileSystem) : emptyFileSystemForm,
  );
  const [fileFilter, setFileFilter] = useState('');
  const [tested, setTested] = useState<TestedFolder | null>(null);

  const kbOptions = useMemo(() => knowledgeBasePickerOptions(knowledgeBases), [knowledgeBases]);

  const onSaved = () => {
    showToast({ message: localize('com_ui_tars_fs_saved'), status: 'success' });
    onClose();
  };
  const onSaveFailed = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? localize('com_ui_tars_fs_save_failed'),
      status: 'error',
    });

  const createMutation = useCreateTarsFileSystemMutation({
    onSuccess: onSaved,
    onError: onSaveFailed,
  });
  const updateMutation = useUpdateTarsFileSystemMutation({
    onSuccess: onSaved,
    onError: onSaveFailed,
  });
  const testMutation = useTestTarsFileSystemConnectionMutation();

  const set = <K extends keyof FileSystemForm>(key: K, value: FileSystemForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /**
   * Any change to how pwc_tars would connect invalidates a previous test: the
   * folders it found belonged to the old host/credentials, not the new ones.
   */
  const resetConnectionTest = () => {
    testMutation.reset();
    setTested(null);
  };

  const setConnectionField = <K extends keyof FileSystemForm>(key: K, value: FileSystemForm[K]) => {
    resetConnectionTest();
    set(key, value);
  };

  /**
   * Switching protocol re-applies that protocol's default port and drops the
   * folder and the fields it does not use, as pwc_tars' own form does.
   */
  const selectProtocol = (protocol: TTarsFileProtocol) => {
    resetConnectionTest();
    setForm((prev) => ({
      ...prev,
      protocol,
      path: '',
      port: defaultPort(protocol),
      hostName: usesHostName(protocol) ? prev.hostName : '',
      account: needsCredentials(protocol) ? prev.account : '',
      password: needsCredentials(protocol) ? prev.password : '',
    }));
  };

  const smb = usesHostName(form.protocol);
  const withCredentials = needsCredentials(form.protocol);
  const invalidName = nameInvalid(form.name);
  const invalidConnection = !connectionFieldsFilled(form, isEdit) || portInvalid(form.port);
  const folderNeeded = missingFolder(form);
  const isSaving = createMutation.isLoading || updateMutation.isLoading;
  const canSave = !invalidName && !invalidConnection && !folderNeeded && !isSaving;

  const inputPayload = () => ({
    name: form.name.trim(),
    description: form.description,
    protocol: form.protocol,
    host: form.host.trim(),
    port: form.port.trim() === '' ? undefined : Number(form.port),
    path: fileServerTestPath(form.protocol, form.path),
    hostName: form.hostName.trim(),
    account: form.account.trim(),
    password: form.password,
    allowedKmIds: form.allowedKmIds,
  });

  /**
   * Tests the folder on the form — `/` until one is picked, the stored one on
   * an edit form — so picking a folder and testing again drills into it, as
   * pwc_tars' own form does. An NFS form with no export yet asks for the list.
   */
  const runTest = (path: string) => {
    const next: TestedFolder = {
      path: fileServerTestPath(form.protocol, path),
      listExports: listsNfsExports({ protocol: form.protocol, path }),
    };
    setTested(next);
    setFileFilter('');
    testMutation.mutate({
      ...inputPayload(),
      path: next.path,
      listExports: next.listExports,
      fileSystemId: fileSystem?.id,
    });
  };

  const testConnection = () => runTest(form.path);

  /** A stored or picked folder that is gone fails every test; this starts over at the root. */
  const testFromRoot = () => {
    set('path', '');
    runTest('');
  };

  /** Picking a folder does not itself invalidate the test — it is what lets testing again drill deeper into it. */
  const selectFolder = (value: string) => set('path', value);

  const submit = () => {
    if (!canSave) {
      return;
    }
    if (isEdit) {
      updateMutation.mutate({ id: fileSystem.id, data: inputPayload() });
      return;
    }
    createMutation.mutate(inputPayload());
  };

  const testResult = testMutation.isSuccess ? testMutation.data : undefined;
  const testedPath = tested?.path ?? '/';
  const sharesListed = listsSmbShares(form.protocol, testedPath);

  const rows = useMemo(
    () => toFileRows(form.protocol, testedPath, testResult?.files ?? []),
    [form.protocol, testedPath, testResult],
  );

  const folders = useMemo(
    () =>
      testResult == null
        ? []
        : folderOptions(form.protocol, testedPath, testResult.files, testResult.exports),
    [form.protocol, testedPath, testResult],
  );
  const choices = useMemo(() => {
    const current = buildFullFolderPath(testedPath, '');
    return folders.map((path) => ({
      value: path,
      label: path === current ? localize('com_ui_tars_fs_folder_use_current', { 0: path }) : path,
    }));
  }, [folders, testedPath, localize]);
  const selectedFolder = selectedFolderOption(folders, form);

  /**
   * The picked folder relative to the tested one, same as `rows[].directory`,
   * so the preview narrows to it — or `null` when it lies outside what the
   * test walked (a folder above it, another export), whose files it never saw.
   */
  const scope =
    selectedFolder == null ? '' : folderWithinTested(form.protocol, testedPath, selectedFolder);

  const scoped = useMemo(() => {
    if (scope == null) {
      return [];
    }
    return scope === ''
      ? rows
      : rows.filter((row) => row.directory === scope || row.directory.startsWith(`${scope}/`));
  }, [rows, scope]);

  const needle = fileFilter.trim().toLowerCase();
  const matched = useMemo(
    () =>
      needle === ''
        ? scoped
        : scoped.filter(
            (row) =>
              row.name.toLowerCase().includes(needle) ||
              row.directory.toLowerCase().includes(needle),
          ),
    [scoped, needle],
  );

  const successMessage = () => {
    if (tested?.listExports === true) {
      return localize('com_ui_tars_fs_test_success_exports', {
        0: String(testResult?.exports?.length ?? 0),
      });
    }
    if (sharesListed) {
      return localize('com_ui_tars_fs_test_success_shares', {
        0: String(testResult?.files.length ?? 0),
      });
    }
    return localize('com_ui_tars_fs_test_success', { 0: String(rows.length) });
  };

  const testError = () =>
    isTimeout(testMutation.error)
      ? localize('com_ui_tars_fs_test_timeout')
      : (errorMessage(testMutation.error) ?? localize('com_ui_tars_db_test_failed'));

  const unreadableDirs = testResult?.unreadableDirs ?? [];
  const testsFromRoot = fileServerTestPath(form.protocol, form.path) === '/';

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize(isEdit ? 'com_ui_tars_fs_edit' : 'com_ui_tars_fs_new')}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        mainClassName="min-w-0"
        main={
          <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto pr-1">
            <section className="space-y-3">
              <p className="text-text-primary text-sm font-medium">
                {localize('com_ui_tars_fs_section_basic')}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tars-fs-name">
                    {localize('com_ui_tars_fs_name')}
                    <span className="text-pwc-danger ml-0.5">*</span>
                  </Label>
                  <Input
                    id="tars-fs-name"
                    value={form.name}
                    onChange={(event) => set('name', event.target.value)}
                    placeholder={localize('com_ui_tars_fs_name_placeholder')}
                  />
                  {form.name !== '' && invalidName && (
                    <p className="text-pwc-danger text-xs">
                      {localize('com_ui_tars_db_name_invalid', {
                        0: String(NAME_MIN),
                        1: String(NAME_MAX),
                      })}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tars-fs-description">{localize('com_ui_description')}</Label>
                  <Input
                    id="tars-fs-description"
                    value={form.description}
                    onChange={(event) => set('description', event.target.value)}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-text-primary text-sm font-medium">
                {localize('com_ui_tars_fs_section_connection')}
              </p>

              <div
                role="radiogroup"
                aria-label={localize('com_ui_tars_fs_protocol')}
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {TARS_FILE_PROTOCOLS.map((protocol) => {
                  const Icon = protocolIcon(protocol);
                  const active = form.protocol === protocol;
                  return (
                    <button
                      key={protocol}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => selectProtocol(protocol)}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors ${
                        active
                          ? 'border-brand-primary bg-brand-primary-subtle text-brand-primary'
                          : 'border-border-light text-text-secondary hover:bg-surface-hover'
                      }`}
                    >
                      <Icon className="size-4" aria-hidden />
                      {protocol}
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className={smb ? 'space-y-1.5' : 'space-y-1.5 sm:col-span-2'}>
                  <Label htmlFor="tars-fs-host">
                    {localize('com_ui_tars_fs_host')}
                    <span className="text-pwc-danger ml-0.5">*</span>
                  </Label>
                  <Input
                    id="tars-fs-host"
                    value={form.host}
                    onChange={(event) => setConnectionField('host', event.target.value)}
                    placeholder="192.168.1.100"
                  />
                </div>
                {smb && (
                  <div className="space-y-1.5">
                    <Label htmlFor="tars-fs-hostname">
                      {localize('com_ui_tars_fs_server_name')}
                    </Label>
                    <Input
                      id="tars-fs-hostname"
                      value={form.hostName}
                      onChange={(event) => setConnectionField('hostName', event.target.value)}
                      placeholder="FILESRV"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="tars-fs-port">
                    {localize('com_ui_tars_fs_port')}
                    <span className="text-pwc-danger ml-0.5">*</span>
                  </Label>
                  <Input
                    id="tars-fs-port"
                    inputMode="numeric"
                    value={form.port}
                    onChange={(event) => setConnectionField('port', event.target.value)}
                    placeholder={defaultPort(form.protocol)}
                  />
                  {form.port !== '' && portInvalid(form.port) && (
                    <p className="text-pwc-danger text-xs">
                      {localize('com_ui_tars_db_port_invalid')}
                    </p>
                  )}
                </div>
              </div>

              {withCredentials && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tars-fs-account">
                      {localize('com_ui_tars_fs_account')}
                      {!isEdit && <span className="text-pwc-danger ml-0.5">*</span>}
                    </Label>
                    <Input
                      id="tars-fs-account"
                      autoComplete="off"
                      value={form.account}
                      onChange={(event) => setConnectionField('account', event.target.value)}
                      placeholder={isEdit ? localize('com_ui_tars_db_account_keep') : undefined}
                    />
                    {isEdit && (
                      <p className="text-text-secondary text-xs">
                        {localize('com_ui_tars_db_account_keep')}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tars-fs-password">
                      {localize('com_ui_tars_db_password')}
                      {!isEdit && <span className="text-pwc-danger ml-0.5">*</span>}
                    </Label>
                    <Input
                      id="tars-fs-password"
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(event) => setConnectionField('password', event.target.value)}
                      placeholder={isEdit ? localize('com_ui_tars_db_password_keep') : undefined}
                    />
                    {isEdit && (
                      <p className="text-text-secondary text-xs">
                        {localize('com_ui_tars_db_password_keep')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="border-border-light space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={testConnection}
                    disabled={invalidConnection || testMutation.isLoading}
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

                  {testMutation.isSuccess && (
                    <span className="text-pwc-success flex items-center gap-1.5 text-sm">
                      <CheckCircle2 className="size-4" aria-hidden />
                      {successMessage()}
                    </span>
                  )}
                </div>

                {testMutation.isError && (
                  <div className="text-pwc-danger flex items-start gap-1.5 text-sm">
                    <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <p className="max-h-32 min-w-0 overflow-y-auto break-words whitespace-pre-line">
                      {testError()}
                    </p>
                  </div>
                )}

                {testMutation.isError && !testsFromRoot && (
                  <Button variant="link" onClick={testFromRoot} className="h-auto p-0 text-xs">
                    {localize('com_ui_tars_fs_test_from_root')}
                  </Button>
                )}

                {unreadableDirs.length > 0 && (
                  <div className="text-pwc-warning space-y-1 text-xs">
                    <p className="flex items-center gap-1.5">
                      <AlertTriangle className="size-4 shrink-0" aria-hidden />
                      {localize('com_ui_tars_fs_unreadable_dirs', {
                        0: String(unreadableDirs.length),
                      })}
                    </p>
                    <ul className="max-h-24 space-y-0.5 overflow-y-auto pl-6">
                      {unreadableDirs.slice(0, UNREADABLE_PREVIEW_LIMIT).map((dir) => (
                        <li key={dir.path} className="break-words">
                          {`${dir.path === '' ? '/' : dir.path}: ${dir.reason}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {testMutation.isSuccess && (
                  <div className="space-y-1.5">
                    <Label htmlFor="tars-fs-folder">
                      {localize('com_ui_tars_fs_select_folder')}
                    </Label>
                    <Dropdown
                      value={selectedFolder}
                      label={selectedFolder == null ? localize('com_ui_tars_fs_select_folder') : ''}
                      onChange={selectFolder}
                      options={choices}
                      variant="field"
                      className="w-full"
                      sizeClasses="max-h-64 overflow-y-auto"
                      ariaLabel={localize('com_ui_tars_fs_select_folder')}
                      searchable={choices.length > 8}
                      searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
                      searchEmptyText={localize('com_ui_no_results_found')}
                    />
                    <p className="text-text-secondary text-xs">
                      {localize(
                        form.protocol === 'NFS'
                          ? 'com_ui_tars_fs_select_folder_hint_nfs'
                          : 'com_ui_tars_fs_select_folder_hint',
                      )}
                    </p>
                  </div>
                )}

                {folderNeeded && (
                  <p
                    className={`text-xs ${testMutation.isSuccess ? 'text-pwc-danger' : 'text-text-secondary'}`}
                  >
                    {localize(
                      form.protocol === 'NFS'
                        ? 'com_ui_tars_fs_select_nfs_export'
                        : 'com_ui_tars_fs_select_smb_share',
                    )}
                  </p>
                )}

                {testMutation.isSuccess && scope == null && (
                  <p className="text-text-secondary text-xs">
                    {localize('com_ui_tars_fs_folder_outside_tested')}
                  </p>
                )}

                {testMutation.isSuccess && scope != null && rows.length > 0 && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search
                        className="text-text-secondary pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                        aria-hidden
                      />
                      <Input
                        value={fileFilter}
                        onChange={(event) => setFileFilter(event.target.value)}
                        placeholder={localize('com_ui_tars_fs_search_file')}
                        aria-label={localize('com_ui_tars_fs_search_file')}
                        className="pl-9"
                      />
                    </div>
                    <div className="border-border-light max-h-56 overflow-y-auto rounded-md border">
                      <table className="w-full border-collapse text-xs">
                        <thead className="bg-surface-secondary text-text-secondary sticky top-0 text-left">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">
                              {localize('com_ui_tars_fs_file_name')}
                            </th>
                            <th className="px-3 py-1.5 font-medium">
                              {localize('com_ui_tars_fs_file_directory')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {matched.slice(0, FILE_PREVIEW_LIMIT).map((row) => (
                            <tr
                              key={`${row.directory}/${row.name}`}
                              className="border-border-light border-t"
                            >
                              <td className="text-text-primary px-3 py-1" title={row.name}>
                                {row.name}
                              </td>
                              <td className="text-text-secondary px-3 py-1" title={row.directory}>
                                {row.directory === '' ? '—' : row.directory}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {matched.length > FILE_PREVIEW_LIMIT && (
                      <p className="text-text-tertiary text-xs">
                        {localize('com_ui_tars_fs_file_truncated', {
                          0: String(FILE_PREVIEW_LIMIT),
                          1: String(matched.length),
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="border-border-light space-y-3 rounded-lg border p-3">
              <p className="text-text-primary text-sm font-medium">
                {localize('com_ui_tars_fs_section_access')}
              </p>
              <p className="text-text-secondary text-xs">
                {localize('com_ui_tars_fs_allowed_kbs_hint')}
              </p>
              <Picker
                id="tars-fs-kbs"
                label={localize('com_ui_tars_db_allowed_kbs')}
                options={kbOptions}
                selected={form.allowedKmIds}
                onChange={(values) => set('allowedKmIds', values)}
                placeholder={localize('com_ui_tars_db_allowed_kbs_none')}
                chips
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
