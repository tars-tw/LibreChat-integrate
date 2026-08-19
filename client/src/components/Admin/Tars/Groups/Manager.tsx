import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Info,
  Users,
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
import type { TTarsUserGroupWithMembers } from 'librechat-data-provider';
import { useTarsUserGroupsQuery, useDeleteTarsUserGroupMutation } from '~/data-provider';
import { toNameMap, toCsvBlob, downloadBlob, formatDateTime } from '../Users/helpers';
import { groupRoleNames, isGroupEnabled, memberCount } from './helpers';
import { StatusBadge, NameList } from '../Users/Fields';
import GroupMembersModal from './Members';
import GroupDetailsModal from './Details';
import { useLocalize } from '~/hooks';
import GroupModal from './Modal';

const PAGE_SIZES = [10, 25, 50, 100];
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

type SortField = 'name' | 'description' | 'status' | 'members';

const sortValue = (group: TTarsUserGroupWithMembers, field: SortField): string => {
  if (field === 'members') {
    return String(memberCount(group)).padStart(8, '0');
  }
  return (group[field] ?? '').toString().toLowerCase();
};

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

export default function GroupManager() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();

  const { data, isLoading } = useTarsUserGroupsQuery();

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsUserGroupWithMembers | null>(null);
  const [deleting, setDeleting] = useState<TTarsUserGroupWithMembers | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [membersId, setMembersId] = useState<string | null>(null);

  const groups = useMemo(() => data?.groups ?? [], [data?.groups]);
  const roles = useMemo(() => data?.roles ?? [], [data?.roles]);
  const roleNames = useMemo(() => toNameMap(roles), [roles]);

  /** Held by id so the dialogs re-read the refreshed group after a member change. */
  const viewing = useMemo(
    () => groups.find((group) => group.id === viewingId) ?? null,
    [groups, viewingId],
  );
  const members = useMemo(
    () => groups.find((group) => group.id === membersId) ?? null,
    [groups, membersId],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matched = !query
      ? groups
      : groups.filter((group) =>
          [group.name, group.description]
            .filter(Boolean)
            .some((field) => (field as string).toLowerCase().includes(query)),
        );
    return [...matched].sort((a, b) => {
      const compared = sortValue(a, sortField).localeCompare(sortValue(b, sortField));
      return sortAsc ? compared : -compared;
    });
  }, [groups, search, sortField, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filtered, currentPage, pageSize],
  );

  const deleteMutation = useDeleteTarsUserGroupMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_groups_deleted'), status: 'success' });
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

  const handleExport = () => {
    const headers = [
      localize('com_ui_tars_groups_name'),
      localize('com_ui_description'),
      localize('com_ui_tars_groups_roles'),
      localize('com_ui_tars_users_status'),
      localize('com_ui_tars_groups_member_count'),
      localize('com_ui_tars_users_created_at'),
    ];
    const csvRows = filtered.map((group) => [
      group.name,
      group.description ?? '',
      groupRoleNames(group, roleNames).join(' / '),
      isGroupEnabled(group)
        ? localize('com_ui_tars_users_enabled')
        : localize('com_ui_tars_users_disabled'),
      String(memberCount(group)),
      formatDateTime(group.created_at, i18n.language),
    ]);
    downloadBlob(
      toCsvBlob(headers, csvRows),
      `TARS_groups_${new Date().toISOString().slice(0, 10)}.csv`,
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
              placeholder={localize('com_ui_tars_groups_search')}
              className="pl-9"
            />
          </div>
          <Button variant="submit" onClick={() => setCreating(true)}>
            <Plus className="icon-sm mr-1" />
            {localize('com_ui_tars_groups_add')}
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
          {localize('com_ui_tars_groups_empty')}
        </p>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-border-light">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  {sortableHeader('name', 'com_ui_tars_groups_name')}
                  {sortableHeader('description', 'com_ui_description')}
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_groups_roles')}</th>
                  {sortableHeader('status', 'com_ui_tars_users_status')}
                  {sortableHeader('members', 'com_ui_tars_groups_member_count')}
                  <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((group) => (
                  <tr
                    key={group.id}
                    className="border-t border-border-light hover:bg-surface-hover"
                  >
                    <td className="px-3 py-2 text-text-primary">{group.name}</td>
                    <td className="px-3 py-2 text-text-secondary">{group.description || '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      <NameList
                        names={groupRoleNames(group, roleNames)}
                        empty={localize('com_ui_tars_users_unassigned')}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge active={isGroupEnabled(group)} />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setMembersId(group.id)}
                        aria-label={localize('com_ui_tars_groups_members')}
                        title={localize('com_ui_tars_groups_members')}
                        className="inline-flex items-center gap-1 rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary hover:text-text-primary"
                      >
                        <Users className="icon-xs" />
                        {memberCount(group)}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          aria-label={localize('com_ui_tars_users_details')}
                          title={localize('com_ui_tars_users_details')}
                          onClick={() => setViewingId(group.id)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                        >
                          <Info className="icon-sm" />
                        </button>
                        <button
                          type="button"
                          aria-label={localize('com_ui_edit')}
                          title={localize('com_ui_edit')}
                          onClick={() => setEditing(group)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                        >
                          <Pencil className="icon-sm" />
                        </button>
                        <button
                          type="button"
                          aria-label={localize('com_ui_delete')}
                          title={localize('com_ui_delete')}
                          onClick={() => setDeleting(group)}
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
              <span id="tars-groups-page-size-label">
                {localize('com_ui_tars_users_rows_per_page')}
              </span>
              <Dropdown
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(0);
                }}
                options={PAGE_SIZE_OPTIONS}
                aria-labelledby="tars-groups-page-size-label"
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
        <GroupModal
          key={editing?.id ?? 'create'}
          open={true}
          group={editing ?? undefined}
          roles={roles}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}

      {viewing != null && (
        <GroupDetailsModal
          group={viewing}
          roles={roleNames}
          locale={i18n.language}
          onOpenChange={(open) => !open && setViewingId(null)}
        />
      )}

      {members != null && (
        <GroupMembersModal group={members} onOpenChange={(open) => !open && setMembersId(null)} />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_groups_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_groups_delete_confirm', { name: deleting.name })}
                </p>
                <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                  {localize('com_ui_tars_groups_delete_warning', {
                    count: memberCount(deleting),
                  })}
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
