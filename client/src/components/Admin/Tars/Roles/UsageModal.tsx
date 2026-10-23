import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsUser, TTarsUserGroupWithMembers } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

function UsersList({
  users,
  localize,
}: {
  users: TTarsUser[];
  localize: ReturnType<typeof useLocalize>;
}) {
  if (users.length === 0) {
    return (
      <p className="text-text-secondary py-8 text-center text-sm">
        {localize('com_ui_tars_roles_usage_users_empty')}
      </p>
    );
  }

  return (
    <div className="border-border-light overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-text-secondary text-left">
          <tr>
            <th className="px-3 py-2 font-medium">{localize('com_ui_tars_users_username')}</th>
            <th className="px-3 py-2 font-medium">{localize('com_auth_email')}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-border-light border-t">
              <td className="text-text-primary px-3 py-2">{user.username}</td>
              <td className="text-text-secondary px-3 py-2">{user.email || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupsList({
  groups,
  localize,
}: {
  groups: TTarsUserGroupWithMembers[];
  localize: ReturnType<typeof useLocalize>;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-text-secondary py-8 text-center text-sm">
        {localize('com_ui_tars_roles_usage_groups_empty')}
      </p>
    );
  }

  return (
    <div className="border-border-light overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-text-secondary text-left">
          <tr>
            <th className="px-3 py-2 font-medium">{localize('com_ui_tars_groups_name')}</th>
            <th className="px-3 py-2 font-medium">{localize('com_ui_description')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.id} className="border-border-light border-t">
              <td className="text-text-primary px-3 py-2">{group.name}</td>
              <td className="text-text-secondary px-3 py-2">{group.description || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RoleUsageModal({
  title,
  type,
  users,
  groups,
  onOpenChange,
}: {
  title: string;
  type: 'users' | 'groups';
  users: TTarsUser[];
  groups: TTarsUserGroupWithMembers[];
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={title}
        showCloseButton={true}
        className="w-11/12 md:max-w-lg"
        main={
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            {type === 'users' ? (
              <UsersList users={users} localize={localize} />
            ) : (
              <GroupsList groups={groups} localize={localize} />
            )}
          </div>
        }
      />
    </OGDialog>
  );
}
