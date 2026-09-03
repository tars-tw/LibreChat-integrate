import { useMemo, useState } from 'react';
import { TARS_FILE_PROTOCOLS } from 'librechat-data-provider';
import { CheckCircle2, PlugZap, Search, XCircle } from 'lucide-react';
import {
  Button,
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
  toFileSystemForm,
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
   * Switching protocol re-applies that protocol's default port and drops the
   * fields it does not use, as pwc_tars' own form does.
   */
  const selectProtocol = (protocol: TTarsFileProtocol) => {
    testMutation.reset();
    setForm((prev) => ({
      ...prev,
      protocol,
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
  const isSaving = createMutation.isLoading || updateMutation.isLoading;
  const canSave = !invalidName && !invalidConnection && !isSaving;

  const inputPayload = () => ({
    name: form.name.trim(),
    description: form.description,
    protocol: form.protocol,
    host: form.host.trim(),
    port: form.port.trim() === '' ? undefined : Number(form.port),
    path: form.path.trim(),
    hostName: form.hostName.trim(),
    account: form.account.trim(),
    password: form.password,
    allowedKmIds: form.allowedKmIds,
  });

  const test = () => testMutation.mutate({ ...inputPayload(), fileSystemId: fileSystem?.id });

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

  const rows = useMemo(() => toFileRows(testMutation.data?.files ?? []), [testMutation.data]);
  const needle = fileFilter.trim().toLowerCase();
  const matched = useMemo(
    () =>
      needle === ''
        ? rows
        : rows.filter(
            (row) =>
              row.name.toLowerCase().includes(needle) ||
              row.directory.toLowerCase().includes(needle),
          ),
    [rows, needle],
  );

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
              <p className="text-sm font-medium text-text-primary">
                {localize('com_ui_tars_fs_section_basic')}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tars-fs-name">
                    {localize('com_ui_tars_fs_name')}
                    <span className="ml-0.5 text-pwc-danger">*</span>
                  </Label>
                  <Input
                    id="tars-fs-name"
                    value={form.name}
                    onChange={(event) => set('name', event.target.value)}
                    placeholder={localize('com_ui_tars_fs_name_placeholder')}
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
              <p className="text-sm font-medium text-text-primary">
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
                    <span className="ml-0.5 text-pwc-danger">*</span>
                  </Label>
                  <Input
                    id="tars-fs-host"
                    value={form.host}
                    onChange={(event) => set('host', event.target.value)}
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
                      onChange={(event) => set('hostName', event.target.value)}
                      placeholder="FILESRV"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="tars-fs-port">
                    {localize('com_ui_tars_fs_port')}
                    <span className="ml-0.5 text-pwc-danger">*</span>
                  </Label>
                  <Input
                    id="tars-fs-port"
                    inputMode="numeric"
                    value={form.port}
                    onChange={(event) => set('port', event.target.value)}
                    placeholder={defaultPort(form.protocol)}
                  />
                  {form.port !== '' && portInvalid(form.port) && (
                    <p className="text-xs text-pwc-danger">
                      {localize('com_ui_tars_db_port_invalid')}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tars-fs-path">{localize('com_ui_tars_fs_path')}</Label>
                <Input
                  id="tars-fs-path"
                  value={form.path}
                  onChange={(event) => set('path', event.target.value)}
                  placeholder={smb ? 'public/reports' : '/public'}
                />
                <p className="text-xs text-text-secondary">
                  {localize(smb ? 'com_ui_tars_fs_path_smb_hint' : 'com_ui_tars_fs_path_hint')}
                </p>
              </div>

              {withCredentials && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tars-fs-account">
                      {localize('com_ui_tars_fs_account')}
                      {!isEdit && <span className="ml-0.5 text-pwc-danger">*</span>}
                    </Label>
                    <Input
                      id="tars-fs-account"
                      autoComplete="off"
                      value={form.account}
                      onChange={(event) => set('account', event.target.value)}
                      placeholder={isEdit ? localize('com_ui_tars_db_account_keep') : undefined}
                    />
                    {isEdit && (
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_tars_db_account_keep')}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tars-fs-password">
                      {localize('com_ui_tars_db_password')}
                      {!isEdit && <span className="ml-0.5 text-pwc-danger">*</span>}
                    </Label>
                    <Input
                      id="tars-fs-password"
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
              )}

              <div className="space-y-2 rounded-lg border border-border-light p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={test}
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
                    <span className="flex items-center gap-1.5 text-sm text-pwc-success">
                      <CheckCircle2 className="size-4" aria-hidden />
                      {localize('com_ui_tars_fs_test_success', { 0: String(rows.length) })}
                    </span>
                  )}

                  {testMutation.isError && (
                    <span className="flex items-center gap-1.5 text-sm text-pwc-danger">
                      <XCircle className="size-4" aria-hidden />
                      {errorMessage(testMutation.error) ?? localize('com_ui_tars_db_test_failed')}
                    </span>
                  )}
                </div>

                {testMutation.isSuccess && rows.length > 0 && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
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
                    <div className="max-h-56 overflow-y-auto rounded-md border border-border-light">
                      <table className="w-full border-collapse text-xs">
                        <thead className="sticky top-0 bg-surface-secondary text-left text-text-secondary">
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
                              className="border-t border-border-light"
                            >
                              <td className="px-3 py-1 text-text-primary" title={row.name}>
                                {row.name}
                              </td>
                              <td className="px-3 py-1 text-text-secondary" title={row.directory}>
                                {row.directory === '' ? '—' : row.directory}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {matched.length > FILE_PREVIEW_LIMIT && (
                      <p className="text-xs text-text-tertiary">
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

            <section className="space-y-3 rounded-lg border border-border-light p-3">
              <p className="text-sm font-medium text-text-primary">
                {localize('com_ui_tars_fs_section_access')}
              </p>
              <p className="text-xs text-text-secondary">
                {localize('com_ui_tars_fs_allowed_kbs_hint')}
              </p>
              <Picker
                id="tars-fs-kbs"
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
