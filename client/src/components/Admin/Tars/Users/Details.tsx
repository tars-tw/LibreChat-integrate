import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsUser } from 'librechat-data-provider';
import { formatDateTime, isActive, resolveRoleNames, resolveGroupNames } from './helpers';
import { StatusBadge, NameList } from './Fields';
import { useLocalize } from '~/hooks';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <div className="mt-0.5 text-sm text-text-primary">{children}</div>
    </div>
  );
}

export default function UserDetailsModal({
  user,
  roles,
  groups,
  locale,
  onOpenChange,
}: {
  user: TTarsUser;
  roles: Map<string, string>;
  groups: Map<string, string>;
  locale: string;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const unassigned = localize('com_ui_tars_users_unassigned');

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={user.username}
        showCloseButton={true}
        className="w-11/12 md:max-w-xl"
        main={
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={localize('com_ui_tars_users_display_name')}>
              {user.display_name || '—'}
            </Field>
            <Field label={localize('com_auth_email')}>{user.email || '—'}</Field>
            <Field label={localize('com_ui_tars_users_role')}>
              <NameList names={resolveRoleNames(user, roles)} empty={unassigned} />
            </Field>
            <Field label={localize('com_ui_tars_users_group')}>
              <NameList names={resolveGroupNames(user, groups)} empty={unassigned} />
            </Field>
            <Field label={localize('com_ui_tars_users_status')}>
              <StatusBadge active={isActive(user)} />
            </Field>
            <Field label={localize('com_ui_tars_users_sso_user')}>
              {user.is_sso_user ? localize('com_ui_yes') : localize('com_ui_no')}
            </Field>
            <Field label={localize('com_ui_tars_users_created_at')}>
              {formatDateTime(user.created_at, locale) || '—'}
            </Field>
            <Field label={localize('com_ui_tars_users_last_login')}>
              {formatDateTime(user.last_login_at, locale) ||
                localize('com_ui_tars_users_not_logged_in')}
            </Field>
            <Field label={localize('com_ui_tars_users_last_active')}>
              {formatDateTime(user.last_active_at, locale) || '—'}
            </Field>
            <Field label={localize('com_ui_tars_users_online_status')}>
              {user.is_online
                ? localize('com_ui_tars_users_online')
                : localize('com_ui_tars_users_offline')}
            </Field>
          </div>
        }
      />
    </OGDialog>
  );
}
