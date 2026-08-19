import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsUserGroupWithMembers } from 'librechat-data-provider';
import { groupRoleNames, isGroupEnabled, memberCount } from './helpers';
import { StatusBadge, NameList } from '../Users/Fields';
import { formatDateTime } from '../Users/helpers';
import { useLocalize } from '~/hooks';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <div className="mt-0.5 text-sm text-text-primary">{children}</div>
    </div>
  );
}

export default function GroupDetailsModal({
  group,
  roles,
  locale,
  onOpenChange,
}: {
  group: TTarsUserGroupWithMembers;
  roles: Map<string, string>;
  locale: string;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const members = group.user_list ?? [];

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={group.name}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={localize('com_ui_description')}>{group.description || '—'}</Field>
              <Field label={localize('com_ui_tars_groups_member_count')}>
                {memberCount(group)}
              </Field>
              <Field label={localize('com_ui_tars_groups_roles')}>
                <NameList
                  names={groupRoleNames(group, roles)}
                  empty={localize('com_ui_tars_users_unassigned')}
                />
              </Field>
              <Field label={localize('com_ui_tars_users_status')}>
                <StatusBadge active={isGroupEnabled(group)} />
              </Field>
              <Field label={localize('com_ui_tars_users_created_at')}>
                {formatDateTime(group.created_at, locale) || '—'}
              </Field>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-text-secondary">
                {localize('com_ui_tars_groups_members')}
              </p>
              {members.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-secondary">
                  {localize('com_ui_tars_groups_members_empty')}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-border-light">
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
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((member) => (
                        <tr key={member.id} className="border-t border-border-light">
                          <td className="px-3 py-2 text-text-primary">{member.username}</td>
                          <td className="px-3 py-2 text-text-secondary">{member.email || '—'}</td>
                          <td className="px-3 py-2">
                            <StatusBadge active={member.status === 'active'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        }
      />
    </OGDialog>
  );
}
