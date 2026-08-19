import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Info,
  Star,
  Search,
  Pencil,
  Trash2,
  Download,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  Input,
  Button,
  Spinner,
  Dropdown,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsRoleDetail } from 'librechat-data-provider';
import {
  useTarsUsersQuery,
  useTarsRolesQuery,
  useTarsUserGroupsQuery,
  useDeleteTarsRoleMutation,
} from '~/data-provider';
import { EMPTY_USAGE, isRoleEnabled, roleMenuKeys, roleDomainIds, buildRoleUsage } from './helpers';
import { toNameMap, toCsvBlob, downloadBlob, formatDateTime } from '../Users/helpers';
import { adminMenuLeafKeys } from '~/components/Nav/Tars/AdminMenu';
import { StatusBadge, NameList } from '../Users/Fields';
import RoleDetailsModal from './Details';
import { useLocalize } from '~/hooks';
import RoleModal from './Modal';

const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

type SortField = 'name' | 'description' | 'status';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

export default function RoleManager() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();

  const { data, isLoading } = useTarsRolesQuery();
  /** Usage counts are derived from the listings the sibling admin pages cache. */
  const { data: users = [] } = useTarsUsersQuery();
  const { data: groupData } = useTarsUserGroupsQuery();

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsRoleDetail | null>(null);
  const [deleting, setDeleting] = useState<TTarsRoleDetail | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const roles = useMemo(() => data?.roles ?? [], [data?.roles]);
  const domains = useMemo(() => data?.domains ?? [], [data?.domains]);
  const domainNames = useMemo(() => toNameMap(domains), [domains]);
  const menuTotal = useMemo(() => adminMenuLeafKeys().length, []);

  const usage = useMemo(
    () => buildRoleUsage(users, groupData?.groups ?? []),
    [users, groupData?.groups],
  );

  const viewing = useMemo(
    () => roles.find((role) => String(role.id) === viewingId) ?? null,
    [roles, viewingId],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = !query
      ? roles
      : roles.filter((role) =>
          [role.name, role.description]
            .filter(Boolean)
            .some((field) => (field as string).toLowerCase().includes(query)),
        );
    return [...matched].sort((a, b) => {
      const compared = (a[sortField] ?? '')
        .toString()
        .toLowerCase()
        .localeCompare((b[sortField] ?? '').toString().toLowerCase());
      return sortAsc ? compared : -compared;
    });
  }, [roles, search, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filtered, currentPage, pageSize],
  );

  const deleteMutation = useDeleteTarsRoleMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_roles_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: (error) =>
      showToast({
        message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
        status: 'error',
      }),
  });

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      setSortAsc((prev) => !prev);
      return;
    }
    setSortField(field);
    setSortAsc(true);
  };

  const menuSummary = (role: TTarsRoleDetail): string => {
    const keys = roleMenuKeys(role);
    if (keys == null) {
      return localize('com_ui_tars_roles_menus_unset_short');
    }
    return `${keys.length}/${menuTotal}`;
  };

  const handleExport = () => {
    const headers = [
      localize('com_ui_tars_roles_name'),
      localize('com_ui_description'),
      localize('com_ui_tars_roles_domains'),
      localize('com_ui_tars_roles_menus'),
      localize('com_ui_tars_users_status'),
      localize('com_ui_tars_roles_is_default'),
      localize('com_ui_tars_roles_usage_users'),
      localize('com_ui_tars_roles_usage_groups'),
      localize('com_ui_tars_users_created_at'),
    ];
    const csvRows = filtered.map((role) => {
      const counts = usage.get(String(role.id)) ?? EMPTY_USAGE;
      return [
        role.name,
        role.description ?? '',
        roleDomainIds(role)
          .map((id) => domainNames.get(id))
          .filter(Boolean)
          .join(' / '),
        menuSummary(role),
        isRoleEnabled(role)
          ? localize('com_ui_tars_users_enabled')
          : localize('com_ui_tars_users_disabled'),
        role.is_default_role ? localize('com_ui_yes') : localize('com_ui_no'),
        String(counts.users),
        String(counts.groups),
        formatDateTime(role.created_at, i18n.language),
      ];
    });
    downloadBlob(
      toCsvBlob(headers, csvRows),
      `TARS_roles_${new Date().toISOString().slice(0, 10)}.csv`,
    );
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
              placeholder={localize('com_ui_tars_roles_search')}
              className="pl-9"
            />
          </div>
          <Button variant="submit" onClick={() => setCreating(true)}>
            <Plus className="icon-sm mr-1" />
            {localize('com_ui_tars_roles_add')}
          </Button>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="icon-sm mr-1" />
          {localize('com_ui_tars_users_export_csv')}
        </Button>
      </div>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_roles_empty')}
        </p>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border-light">
            <table className="w-full min-w-[60rem] text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  {sortableHeader('name', 'com_ui_tars_roles_name')}
                  {sortableHeader('description', 'com_ui_description')}
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_roles_domains')}</th>
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_roles_menus')}</th>
                  {sortableHeader('status', 'com_ui_tars_users_status')}
                  <th className="px-3 py-2 font-medium">
                    {localize('com_ui_tars_roles_is_default')}
                  </th>
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_roles_usage')}</th>
                  <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((role) => {
                  const counts = usage.get(String(role.id)) ?? EMPTY_USAGE;
                  return (
                    <tr
                      key={role.id}
                      className="border-t border-border-light hover:bg-surface-hover"
                    >
                      <td className="px-3 py-2 text-text-primary">{role.name}</td>
                      <td className="px-3 py-2 text-text-secondary">{role.description || '—'}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        <NameList
                          names={roleDomainIds(role)
                            .map((id) => domainNames.get(id))
                            .filter((name): name is string => !!name)}
                          empty={localize('com_ui_tars_roles_domains_none')}
                        />
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{menuSummary(role)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge active={isRoleEnabled(role)} />
                      </td>
                      <td className="px-3 py-2">
                        {role.is_default_role && (
                          <Star
                            className="icon-sm text-yellow-500"
                            aria-label={localize('com_ui_tars_roles_is_default')}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        {localize('com_ui_tars_roles_usage_summary', {
                          users: counts.users,
                          groups: counts.groups,
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            aria-label={localize('com_ui_tars_users_details')}
                            title={localize('com_ui_tars_users_details')}
                            onClick={() => setViewingId(String(role.id))}
                            className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                          >
                            <Info className="icon-sm" />
                          </button>
                          <button
                            type="button"
                            aria-label={localize('com_ui_edit')}
                            title={localize('com_ui_edit')}
                            onClick={() => setEditing(role)}
                            className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                          >
                            <Pencil className="icon-sm" />
                          </button>
                          <button
                            type="button"
                            aria-label={localize('com_ui_delete')}
                            title={localize('com_ui_delete')}
                            onClick={() => setDeleting(role)}
                            className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                          >
                            <Trash2 className="icon-sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <span id="tars-roles-page-size-label">
                {localize('com_ui_tars_users_rows_per_page')}
              </span>
              <Dropdown
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(0);
                }}
                options={PAGE_SIZE_OPTIONS}
                aria-labelledby="tars-roles-page-size-label"
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
        <RoleModal
          key={editing?.id ?? 'create'}
          open={true}
          role={editing ?? undefined}
          domains={domains}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}

      {viewing != null && (
        <RoleDetailsModal
          role={viewing}
          domains={domains}
          usage={usage.get(String(viewing.id)) ?? EMPTY_USAGE}
          locale={i18n.language}
          onOpenChange={(open) => !open && setViewingId(null)}
        />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_roles_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_roles_delete_confirm', { name: deleting.name })}
                </p>
                {(() => {
                  const counts = usage.get(String(deleting.id)) ?? EMPTY_USAGE;
                  if (counts.users === 0 && counts.groups === 0) {
                    return null;
                  }
                  return (
                    <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                      {localize('com_ui_tars_roles_delete_warning', {
                        users: counts.users,
                        groups: counts.groups,
                      })}
                    </p>
                  );
                })()}
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
