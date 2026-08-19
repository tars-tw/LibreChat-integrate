import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dataService } from 'librechat-data-provider';
import {
  Input,
  Button,
  Spinner,
  Checkbox,
  Dropdown,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import {
  Plus,
  Info,
  Search,
  Pencil,
  Trash2,
  Upload,
  KeyRound,
  Download,
  ChevronUp,
  ChevronDown,
  FileSpreadsheet,
} from 'lucide-react';
import type { TTarsUser } from 'librechat-data-provider';
import {
  useTarsUsersQuery,
  useDeleteTarsUserMutation,
  useImportTarsUsersMutation,
  useTarsUserPrepareDataQuery,
} from '~/data-provider';
import {
  isActive,
  toNameMap,
  toCsvBlob,
  downloadBlob,
  formatDateTime,
  resolveRoleNames,
  resolveGroupNames,
} from './helpers';
import { BulkEditModal, BulkDeleteModal } from './Bulk';
import { StatusBadge, NameList } from './Fields';
import ResetPasswordModal from './Password';
import UserDetailsModal from './Details';
import { useLocalize } from '~/hooks';
import UserModal from './Modal';

const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

type SortField = 'display_name' | 'username' | 'email' | 'status' | 'last_login_at';

const sortValue = (user: TTarsUser, field: SortField): string =>
  (user[field] ?? '').toString().toLowerCase();

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

export default function UserManager() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: users = [], isLoading } = useTarsUsersQuery();
  const { data: prepareData } = useTarsUserPrepareDataQuery();

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('username');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsUser | null>(null);
  const [deleting, setDeleting] = useState<TTarsUser | null>(null);
  const [viewing, setViewing] = useState<TTarsUser | null>(null);
  const [resetting, setResetting] = useState<TTarsUser | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const roles = useMemo(() => prepareData?.roles ?? [], [prepareData?.roles]);
  const groups = useMemo(() => prepareData?.userGroups ?? [], [prepareData?.userGroups]);
  const roleNames = useMemo(() => toNameMap(roles), [roles]);
  const groupNames = useMemo(() => toNameMap(groups), [groups]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = !query
      ? users
      : users.filter((user) =>
          [user.display_name, user.username, user.email]
            .filter(Boolean)
            .some((field) => (field as string).toLowerCase().includes(query)),
        );
    return [...matched].sort((a, b) => {
      const compared = sortValue(a, sortField).localeCompare(sortValue(b, sortField));
      return sortAsc ? compared : -compared;
    });
  }, [users, search, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filtered, currentPage, pageSize],
  );

  const selectedUsers = useMemo(
    () => users.filter((user) => selectedIds.has(user.id)),
    [users, selectedIds],
  );
  const allRowsSelected = rows.length > 0 && rows.every((user) => selectedIds.has(user.id));

  const deleteMutation = useDeleteTarsUserMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_users_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: (error) =>
      showToast({
        message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const importMutation = useImportTarsUsersMutation({
    onSuccess: (result) =>
      showToast({
        message: result?.message ?? localize('com_ui_tars_users_import_success'),
        status: 'success',
      }),
    onError: (error) => {
      const data = (error as { response?: { data?: { error?: string; details?: string[] } } })
        ?.response?.data;
      const details = data?.details?.length ? `: ${data.details.join('; ')}` : '';
      showToast({
        message: `${data?.error ?? localize('com_ui_tars_users_import_failed')}${details}`,
        status: 'error',
      });
    },
  });

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortField(field);
    setSortAsc(true);
  };

  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const toggleAllRows = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const user of rows) {
        if (allRowsSelected) {
          next.delete(user.id);
        } else {
          next.add(user.id);
        }
      }
      return next;
    });

  const handleExport = () => {
    const headers = [
      localize('com_ui_tars_users_display_name'),
      localize('com_ui_tars_users_username'),
      localize('com_auth_email'),
      localize('com_ui_tars_users_role'),
      localize('com_ui_tars_users_group'),
      localize('com_ui_tars_users_status'),
      localize('com_ui_tars_users_created_at'),
      localize('com_ui_tars_users_last_login'),
    ];
    const csvRows = selectedUsers.map((user) => [
      user.display_name ?? '',
      user.username,
      user.email ?? '',
      resolveRoleNames(user, roleNames).join(' / '),
      resolveGroupNames(user, groupNames).join(' / '),
      isActive(user)
        ? localize('com_ui_tars_users_enabled')
        : localize('com_ui_tars_users_disabled'),
      formatDateTime(user.created_at, i18n.language),
      formatDateTime(user.last_login_at, i18n.language),
    ]);
    downloadBlob(
      toCsvBlob(headers, csvRows),
      `TARS_users_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const handleTemplateDownload = async () => {
    try {
      const buffer = await dataService.downloadTarsUserImportTemplate();
      downloadBlob(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'Bulk_User_Import_Template.xlsx',
      );
    } catch {
      showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' });
    }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    importMutation.mutate(formData);
    event.target.value = '';
  };

  const sortableHeader = (field: SortField, labelKey: Parameters<typeof localize>[0]) => (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className="flex items-center gap-1 hover:text-text-primary"
      >
        {localize(labelKey)}
        {field === sortField &&
          (sortAsc ? <ChevronUp className="icon-xs" /> : <ChevronDown className="icon-xs" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative w-64 max-w-full">
            <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder={localize('com_ui_tars_users_search')}
              className="pl-9"
            />
          </div>
          <Button variant="submit" onClick={() => setCreating(true)}>
            <Plus className="icon-sm mr-1" />
            {localize('com_ui_tars_users_add')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            aria-hidden="true"
            onChange={handleImport}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isLoading}
          >
            {importMutation.isLoading ? (
              <Spinner className="icon-sm mr-1" />
            ) : (
              <Upload className="icon-sm mr-1" />
            )}
            {localize('com_ui_tars_users_import')}
          </Button>
          <Button variant="outline" onClick={handleTemplateDownload}>
            <FileSpreadsheet className="icon-sm mr-1" />
            {localize('com_ui_tars_users_template')}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={selectedIds.size === 0}>
            <Download className="icon-sm mr-1" />
            {localize('com_ui_tars_users_export_csv')}
          </Button>
          <Button
            variant="outline"
            onClick={() => setBulkEditing(true)}
            disabled={selectedIds.size === 0}
          >
            {localize('com_ui_tars_users_bulk_edit')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setBulkDeleting(true)}
            disabled={selectedIds.size === 0}
          >
            {localize('com_ui_tars_users_bulk_delete')}
          </Button>
          {selectedIds.size > 0 && (
            <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
              {localize('com_ui_tars_users_clear_selection', { count: selectedIds.size })}
            </Button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_users_empty')}
        </p>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border-light">
            <table className="w-full min-w-[64rem] text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <Checkbox
                      aria-label={localize('com_ui_tars_users_select_all')}
                      checked={allRowsSelected}
                      onCheckedChange={toggleAllRows}
                    />
                  </th>
                  {sortableHeader('display_name', 'com_ui_tars_users_display_name')}
                  {sortableHeader('username', 'com_ui_tars_users_username')}
                  {sortableHeader('email', 'com_auth_email')}
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_users_role')}</th>
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_users_group')}</th>
                  {sortableHeader('status', 'com_ui_tars_users_status')}
                  {/* "AD" is the product name in every locale — nothing to translate. */}
                  <th className="px-3 py-2 font-medium">AD</th>
                  {sortableHeader('last_login_at', 'com_ui_tars_users_online_status')}
                  <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <tr key={user.id} className="border-t border-border-light hover:bg-surface-hover">
                    <td className="px-3 py-2">
                      <Checkbox
                        aria-label={localize('com_ui_tars_users_select_row', {
                          name: user.username,
                        })}
                        checked={selectedIds.has(user.id)}
                        onCheckedChange={() => toggleRow(user.id)}
                      />
                    </td>
                    <td className="px-3 py-2 text-text-primary">{user.display_name || '—'}</td>
                    <td className="px-3 py-2 text-text-primary">{user.username}</td>
                    <td className="px-3 py-2 text-text-secondary">{user.email || '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      <NameList
                        names={resolveRoleNames(user, roleNames)}
                        empty={localize('com_ui_tars_users_unassigned')}
                      />
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      <NameList
                        names={resolveGroupNames(user, groupNames)}
                        empty={localize('com_ui_tars_users_unassigned')}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge active={isActive(user)} />
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{user.is_syncbyad ? '✓' : ''}</td>
                    <td className="px-3 py-2">
                      <span
                        title={
                          user.last_login_at
                            ? formatDateTime(user.last_login_at, i18n.language)
                            : localize('com_ui_tars_users_not_logged_in')
                        }
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          user.is_online ? 'bg-green-500' : 'bg-surface-tertiary'
                        }`}
                      />
                      <span className="ml-2 text-xs text-text-secondary">
                        {user.is_online
                          ? localize('com_ui_tars_users_online')
                          : localize('com_ui_tars_users_offline')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          aria-label={localize('com_ui_tars_users_details')}
                          title={localize('com_ui_tars_users_details')}
                          onClick={() => setViewing(user)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                        >
                          <Info className="icon-sm" />
                        </button>
                        <button
                          type="button"
                          aria-label={localize('com_ui_edit')}
                          title={localize('com_ui_edit')}
                          onClick={() => setEditing(user)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                        >
                          <Pencil className="icon-sm" />
                        </button>
                        <button
                          type="button"
                          aria-label={localize('com_ui_tars_users_reset_password')}
                          title={localize('com_ui_tars_users_reset_password')}
                          onClick={() => setResetting(user)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                        >
                          <KeyRound className="icon-sm" />
                        </button>
                        <button
                          type="button"
                          aria-label={localize('com_ui_delete')}
                          title={localize('com_ui_delete')}
                          onClick={() => setDeleting(user)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                        >
                          <Trash2 className="icon-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <span id="tars-users-page-size-label">
                {localize('com_ui_tars_users_rows_per_page')}
              </span>
              <Dropdown
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(0);
                }}
                options={PAGE_SIZE_OPTIONS}
                aria-labelledby="tars-users-page-size-label"
                sizeClasses="min-w-[5rem]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span>
                {localize('com_ui_tars_users_page_of', {
                  current: currentPage + 1,
                  total: pageCount,
                })}
              </span>
              <Button
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {localize('com_ui_tars_users_prev_page')}
              </Button>
              <Button
                variant="outline"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                {localize('com_ui_tars_users_next_page')}
              </Button>
            </div>
          </div>
        </>
      )}

      {(creating || editing != null) && (
        <UserModal
          key={editing?.id ?? 'create'}
          open={true}
          user={editing ?? undefined}
          roles={roles}
          groups={groups}
          ssoEnabled={prepareData?.sso.enabled ?? false}
          ssoType={prepareData?.sso.type ?? null}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}

      {viewing != null && (
        <UserDetailsModal
          user={viewing}
          roles={roleNames}
          groups={groupNames}
          locale={i18n.language}
          onOpenChange={(open) => !open && setViewing(null)}
        />
      )}

      {resetting != null && (
        <ResetPasswordModal user={resetting} onOpenChange={(open) => !open && setResetting(null)} />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_users_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-sm text-text-secondary">
                {localize('com_ui_tars_users_delete_confirm', { name: deleting.username })}
              </p>
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

      {bulkEditing && (
        <BulkEditModal
          users={selectedUsers}
          roles={roles}
          groups={groups}
          onOpenChange={(open) => {
            if (!open) {
              setBulkEditing(false);
              setSelectedIds(new Set());
            }
          }}
        />
      )}

      {bulkDeleting && (
        <BulkDeleteModal
          users={selectedUsers}
          onOpenChange={(open) => {
            if (!open) {
              setBulkDeleting(false);
              setSelectedIds(new Set());
            }
          }}
        />
      )}
    </div>
  );
}
