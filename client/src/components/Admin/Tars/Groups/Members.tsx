import { useMemo, useState } from 'react';
import { Plus, Search, Trash2, UserX } from 'lucide-react';
import {
  Input,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsGroupMember, TTarsUserGroupWithMembers } from 'librechat-data-provider';
import {
  useTarsUsersQuery,
  useAddTarsUserGroupMembersMutation,
  useRemoveTarsUserGroupMemberMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

/**
 * A group's member list, with add and remove. Candidates come from the shared
 * user listing minus whoever is already a member, so the dialog never offers a
 * duplicate.
 */
export default function GroupMembersModal({
  group,
  onOpenChange,
}: {
  group: TTarsUserGroupWithMembers;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<TTarsGroupMember | null>(null);

  const { data: users = [], isLoading: usersLoading } = useTarsUsersQuery({ enabled: adding });

  const members = useMemo(() => group.user_list ?? [], [group.user_list]);
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users
      .filter((user) => !memberIds.has(user.id))
      .filter(
        (user) =>
          !query ||
          [user.username, user.display_name, user.email]
            .filter(Boolean)
            .some((field) => (field as string).toLowerCase().includes(query)),
      );
  }, [users, memberIds, search]);

  const onError = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const addMutation = useAddTarsUserGroupMembersMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_groups_members_added'), status: 'success' });
      setAdding(false);
      setSelectedIds(new Set());
      setSearch('');
    },
    onError,
  });

  const removeMutation = useRemoveTarsUserGroupMemberMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_groups_member_removed'), status: 'success' });
      setRemoving(null);
    },
    onError,
  });

  const toggleCandidate = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  if (removing != null) {
    return (
      <OGDialog open={true} onOpenChange={(open) => !open && setRemoving(null)}>
        <OGDialogTemplate
          title={localize('com_ui_tars_groups_remove_member')}
          showCloseButton={true}
          className="w-11/12 max-w-md"
          main={
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_groups_remove_member_confirm', {
                name: removing.username,
                group: group.name,
              })}
            </p>
          }
          buttons={
            <Button
              variant="destructive"
              onClick={() => removeMutation.mutate({ id: group.id, userId: removing.id })}
              disabled={removeMutation.isLoading}
            >
              {removeMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
            </Button>
          }
        />
      </OGDialog>
    );
  }

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={`${group.name} — ${localize('com_ui_tars_groups_members')}`}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            {!adding && (
              <>
                <Button variant="outline" onClick={() => setAdding(true)}>
                  <Plus className="icon-sm mr-1" />
                  {localize('com_ui_tars_groups_add_members')}
                </Button>
                {members.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-text-secondary">
                    <UserX className="h-6 w-6" aria-hidden="true" />
                    <p className="text-sm">{localize('com_ui_tars_groups_members_empty')}</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border-light">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-secondary text-left text-text-secondary">
                        <tr>
                          <th className="px-3 py-2 font-medium">
                            {localize('com_ui_tars_users_username')}
                          </th>
                          <th className="px-3 py-2 font-medium">{localize('com_auth_email')}</th>
                          <th className="px-3 py-2 font-medium">
                            {localize('com_ui_tars_users_status')}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {localize('com_ui_actions')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((member) => (
                          <tr key={member.id} className="border-t border-border-light">
                            <td className="px-3 py-2 text-text-primary">{member.username}</td>
                            <td className="px-3 py-2 text-text-secondary">{member.email || '—'}</td>
                            <td className="px-3 py-2 text-text-secondary">
                              {member.status === 'active'
                                ? localize('com_ui_tars_users_enabled')
                                : localize('com_ui_tars_users_disabled')}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  aria-label={localize('com_ui_tars_groups_remove_member')}
                                  title={localize('com_ui_tars_groups_remove_member')}
                                  onClick={() => setRemoving(member)}
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
                )}
              </>
            )}

            {adding && (
              <>
                <div className="relative">
                  <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={localize('com_ui_tars_users_search')}
                    className="pl-9"
                  />
                </div>
                {usersLoading && (
                  <div className="flex h-32 items-center justify-center">
                    <Spinner />
                  </div>
                )}
                {!usersLoading && candidates.length === 0 && (
                  <p className="py-8 text-center text-sm text-text-secondary">
                    {localize('com_ui_tars_groups_no_candidates')}
                  </p>
                )}
                {!usersLoading && candidates.length > 0 && (
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-border-light p-2">
                    {candidates.map((user) => (
                      <label
                        key={user.id}
                        className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selectedIds.has(user.id)}
                          onChange={() => toggleCandidate(user.id)}
                        />
                        <span className="truncate text-text-primary">{user.username}</span>
                        <span className="truncate text-xs text-text-secondary">
                          {user.email ?? ''}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        }
        buttons={
          adding ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setAdding(false);
                  setSelectedIds(new Set());
                  setSearch('');
                }}
              >
                {localize('com_ui_cancel')}
              </Button>
              <Button
                variant="submit"
                disabled={selectedIds.size === 0 || addMutation.isLoading}
                onClick={() => addMutation.mutate({ id: group.id, userIds: [...selectedIds] })}
              >
                {addMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
              </Button>
            </>
          ) : undefined
        }
      />
    </OGDialog>
  );
}
