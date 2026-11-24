import { useMemo, useState } from 'react';
import { TARS_FILE_PROTOCOLS } from 'librechat-data-provider';
import { AlertTriangle, CheckCircle2, PlugZap, XCircle } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Switch,
  useToastContext,
  disabledInkClasses,
} from '@librechat/client';
import type { TTarsFileProtocol, TTarsFileSystemSource } from 'librechat-data-provider';
import type { FileSystemForm, SaveBlocker } from './helpers';
import type { TranslationKeys } from '~/hooks';
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
  nameRejected,
  portInvalid,
  saveBlockers,
  protocolIcon,
  toFileRows,
  folderOptions,
  missingFolder,
  listsNfsExports,
  listsSmbShares,
  groupPathLabel,
  toFileSystemForm,
  fileServerTestPath,
  folderWithinTested,
} from './helpers';
import {
  useCreateTarsFileSystemMutation,
  useUpdateTarsFileSystemMutation,
  useTestTarsFileSystemConnectionMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';
import Explorer from './Explorer';

/** The footer's reason for each thing that keeps the form from saving. */
const SAVE_BLOCKER_KEYS = {
  unchanged: 'com_ui_tars_fs_save_unchanged',
  name: 'com_ui_tars_fs_reason_name',
  host: 'com_ui_tars_fs_reason_host',
  credentials: 'com_ui_tars_fs_reason_credentials',
  port: 'com_ui_tars_fs_reason_port',
  smb_share: 'com_ui_tars_fs_reason_smb_share',
  nfs_export: 'com_ui_tars_fs_reason_nfs_export',
} as const satisfies Record<SaveBlocker, TranslationKeys>;

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

  /** The group as stored, which an edit is compared against; `null` for a new group. */
  const original = useMemo(
    () => (fileSystem != null ? toFileSystemForm(fileSystem) : null),
    [fileSystem],
  );
  const [form, setForm] = useState<FileSystemForm>(original ?? emptyFileSystemForm);
  const [tested, setTested] = useState<TestedFolder | null>(null);
  /** The folder being browsed. Browsing never changes the group path. */
  const [location, setLocation] = useState('/');

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
   * folder and the fields it does not use. Only a new group may switch: an
   * existing one's documents store their source paths in its protocol's form.
   */
  const selectProtocol = (protocol: TTarsFileProtocol) => {
    if (isEdit) {
      return;
    }
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
  const invalidName = nameRejected(form.name, fileSystem?.name);
  const invalidConnection = !connectionFieldsFilled(form, isEdit) || portInvalid(form.port);
  const folderNeeded = missingFolder(form);
  const isSaving = createMutation.isLoading || updateMutation.isLoading;
  const blockers = useMemo(() => saveBlockers(form, original), [form, original]);
  const canSave = blockers.length === 0 && !isSaving;

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
    enabled: form.enabled,
    allowedKmIds: form.allowedKmIds,
  });

  /**
   * Tests one folder and browses from there. "Test connection" runs it on the
   * group path (`/` until one is set); browsing runs it wherever the last test
   * did not reach. An NFS form with no export yet asks for the export list.
   */
  const runTest = (path: string) => {
    const next: TestedFolder = {
      path: fileServerTestPath(form.protocol, path),
      listExports: listsNfsExports({ protocol: form.protocol, path }),
    };
    setTested(next);
    setLocation(next.listExports ? '/' : groupPathLabel(next.path));
    testMutation.mutate({
      ...inputPayload(),
      path: next.path,
      listExports: next.listExports,
      fileSystemId: fileSystem?.id,
    });
  };

  const testConnection = () => runTest(form.path);

  /** A group path that is gone fails every test; this browses from the root and leaves the path as it is. */
  const testFromRoot = () => runTest('');

  /** What the group syncs from now, and — on an edit — what it will sync once saved. */
  const savedPath = groupPathLabel(fileSystem?.path);
  const pendingPath = groupPathLabel(form.path);
  const pathEdited = isEdit && pendingPath !== savedPath;
  const restorePath = () => set('path', fileSystem?.path ?? '');

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
  /** Set when pwc_tars listed only this many files of the tested folder. */
  const fileLimit = testResult?.fileLimit;
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
  /**
   * Opens a folder: at once when the last test walked it, otherwise by testing
   * there. A share or export list is names only, so whatever is picked from it
   * is tested; NFS's `/` is the export list itself.
   */
  const navigate = (path: string) => {
    const walked = testResult != null && !sharesListed && tested?.listExports !== true;
    if (walked && folderWithinTested(form.protocol, testedPath, path) != null) {
      setLocation(groupPathLabel(path));
      return;
    }
    runTest(form.protocol === 'NFS' && groupPathLabel(path) === '/' ? '' : path);
  };

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
    if (fileLimit != null) {
      return localize('com_ui_tars_fs_test_success_partial', { 0: String(rows.length) });
    }
    return localize('com_ui_tars_fs_test_success', { 0: String(rows.length) });
  };

  const testError = () =>
    isTimeout(testMutation.error)
      ? localize('com_ui_tars_fs_test_timeout')
      : (errorMessage(testMutation.error) ?? localize('com_ui_tars_db_test_failed'));

  const unreadableDirs = testResult?.unreadableDirs ?? [];
  const testsFromRoot = fileServerTestPath(form.protocol, tested?.path ?? form.path) === '/';
  const passwordEdgeSpace = form.password !== form.password.trim();

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

            <div className="flex items-center gap-2">
              <Label htmlFor="tars-fs-enabled">{localize('com_ui_active')}</Label>
              <Switch
                id="tars-fs-enabled"
                aria-label={localize('com_ui_active')}
                checked={form.enabled}
                onCheckedChange={(checked) => set('enabled', checked)}
              />
            </div>

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
                  const locked = isEdit && !active;
                  return (
                    <button
                      key={protocol}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={locked}
                      onClick={() => selectProtocol(protocol)}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors ${
                        active
                          ? 'border-brand-primary bg-brand-primary-subtle text-brand-primary'
                          : 'border-border-light text-text-secondary hover:bg-surface-hover'
                      } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${disabledInkClasses}`}
                    >
                      <Icon className="size-4" aria-hidden />
                      {protocol}
                    </button>
                  );
                })}
              </div>
              {isEdit && (
                <p className="text-text-secondary text-xs">
                  {localize('com_ui_tars_fs_protocol_locked')}
                </p>
              )}

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
                      aria-describedby="tars-fs-hostname-hint"
                    />
                    <p id="tars-fs-hostname-hint" className="text-text-secondary text-xs">
                      {localize('com_ui_tars_fs_server_name_hint')}
                    </p>
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
                    {passwordEdgeSpace && (
                      <p
                        role="status"
                        className="text-status-warning flex items-center gap-1.5 text-xs"
                      >
                        <AlertTriangle className="size-4 shrink-0" aria-hidden />
                        {localize('com_ui_tars_fs_password_edge_space')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-text-primary text-sm font-medium">
                  {localize('com_ui_tars_fs_path')}
                </p>
                {isEdit && (
                  <p className="text-text-primary text-sm break-all">
                    {localize('com_ui_tars_fs_path_current', { 0: savedPath })}
                  </p>
                )}
                {(pathEdited || !isEdit) && (
                  <p className="text-text-primary flex flex-wrap items-center gap-x-2 text-sm break-all">
                    {folderNeeded
                      ? localize(
                          form.protocol === 'NFS'
                            ? 'com_ui_tars_fs_path_unset_nfs'
                            : 'com_ui_tars_fs_path_unset_smb',
                        )
                      : localize(
                          isEdit ? 'com_ui_tars_fs_path_new' : 'com_ui_tars_fs_path_to_save',
                          { 0: pendingPath },
                        )}
                    {pathEdited && (
                      <button
                        type="button"
                        onClick={restorePath}
                        className="text-text-secondary hover:text-text-primary text-xs underline"
                      >
                        {localize('com_ui_tars_fs_path_restore')}
                      </button>
                    )}
                  </p>
                )}
                {pathEdited && (
                  <p className="text-text-secondary text-xs">
                    {localize('com_ui_tars_fs_path_change_hint')}
                  </p>
                )}
              </div>

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

                {fileLimit != null && (
                  <p className="text-text-secondary text-xs">
                    {localize('com_ui_tars_fs_test_partial')}
                  </p>
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

                {testResult != null && (
                  <Explorer
                    protocol={form.protocol}
                    testedPath={testedPath}
                    listedExports={tested?.listExports === true}
                    sharesListed={sharesListed}
                    exports={testResult.exports}
                    rows={rows}
                    folders={folders}
                    location={location}
                    groupPath={form.path}
                    onNavigate={navigate}
                    onSetGroupPath={(path) => set('path', path)}
                  />
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
        leftButtons={
          blockers.length > 0 ? (
            <p
              role="status"
              className={`max-w-md text-xs ${
                blockers[0] === 'unchanged' ? 'text-text-secondary' : 'text-pwc-danger'
              }`}
            >
              {blockers[0] === 'unchanged'
                ? localize('com_ui_tars_fs_save_unchanged')
                : localize('com_ui_tars_fs_save_blocked', {
                    0: blockers
                      .map((blocker) =>
                        localize(SAVE_BLOCKER_KEYS[blocker], {
                          0: String(NAME_MIN),
                          1: String(NAME_MAX),
                        }),
                      )
                      .join(' · '),
                  })}
            </p>
          ) : undefined
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
