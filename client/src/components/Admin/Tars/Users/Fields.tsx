import { useMemo } from 'react';
import { Label, Dropdown } from '@librechat/client';
import type { RoleOption, GroupOption } from './helpers';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';

/**
 * Sentinel for "no role selected". `Dropdown` renders an empty trigger for an
 * empty value, so the placeholder needs to be a real option with a value.
 */
const NO_ROLE = 'none';

/** Single-role picker shared by the create, edit and bulk-edit forms. */
export function RoleSelect({
  id,
  value,
  roles,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  roles: RoleOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const localize = useLocalize();
  const options = useMemo(
    () => [
      { value: NO_ROLE, label: localize('com_ui_tars_users_select_role') },
      ...roles.map((role) => ({ value: String(role.id), label: role.name })),
    ],
    [roles, localize],
  );

  return (
    <div>
      <Label id={`${id}-label`}>{localize('com_ui_tars_users_role')}</Label>
      <Dropdown
        value={value === '' ? NO_ROLE : value}
        options={options}
        disabled={disabled}
        onChange={(next) => onChange(next === NO_ROLE ? '' : next)}
        aria-labelledby={`${id}-label`}
        className="mt-1 w-full"
      />
      <p className="text-text-secondary mt-1 text-xs">
        {localize('com_ui_tars_users_role_follows_group')}
      </p>
    </div>
  );
}

/** Multi-group picker with searchable options and selected chips. */
export function GroupSelect({
  groups,
  selected,
  disabled,
  onToggle,
}: {
  groups: GroupOption[];
  selected: Set<string>;
  disabled?: boolean;
  fill?: boolean;
  onToggle: (id: string) => void;
}) {
  const localize = useLocalize();

  const options = useMemo(
    () =>
      groups.map((group) => ({
        value: String(group.id),
        label: group.name,
      })),
    [groups],
  );

  return (
    <div>
      <Label>{localize('com_ui_tars_users_group')}</Label>
      {groups.length === 0 ? (
        <p className="text-text-secondary mt-1 text-sm">
          {localize('com_ui_tars_users_groups_empty')}
        </p>
      ) : (
        <div className="mt-1">
          <Picker
            id="tars-user-groups"
            options={options}
            selected={[...selected]}
            onChange={(values) => {
              const next = new Set(values);
              const changedIds = new Set([...selected, ...next]);

              changedIds.forEach((id) => {
                if (selected.has(id) !== next.has(id)) {
                  onToggle(id);
                }
              });
            }}
            placeholder={localize('com_ui_tars_users_select_group')}
            disabled={disabled}
            chips
          />
        </div>
      )}
    </div>
  );
}

/** Enabled / disabled pill used in the table and the details dialog. */
export function StatusBadge({ active }: { active: boolean }) {
  const localize = useLocalize();

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
        active
          ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
          : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
      }`}
    >
      {active ? localize('com_ui_tars_users_enabled') : localize('com_ui_tars_users_disabled')}
    </span>
  );
}

/** Marks an account pwc_tars is refusing sign-ins for after too many wrong passwords. */
export function LoginLockBadge({ failCount, seconds }: { failCount: number; seconds: number }) {
  const localize = useLocalize();
  const hint = localize('com_ui_tars_users_login_locked_hint', {
    count: failCount,
    minutes: Math.max(1, Math.ceil(seconds / 60)),
  });

  return (
    <span
      title={hint}
      aria-label={hint}
      className="bg-status-warning-subtle text-status-warning ml-1 inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
    >
      {localize('com_ui_tars_users_login_locked')}
    </span>
  );
}

/** Renders a multi-valued cell (role names, group names) as a compact list. */
export function NameList({ names, empty }: { names: string[]; empty: string }) {
  if (names.length === 0) {
    return <span className="text-text-secondary">{empty}</span>;
  }
  return (
    <ul className="m-0 list-inside list-disc">
      {names.map((name) => (
        <li key={name} className="truncate" title={name}>
          {name}
        </li>
      ))}
    </ul>
  );
}
