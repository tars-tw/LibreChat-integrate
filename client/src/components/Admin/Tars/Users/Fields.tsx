import { useMemo } from 'react';
import { Label, Dropdown } from '@librechat/client';
import type { RoleOption, GroupOption } from './helpers';
import { useLocalize } from '~/hooks';

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
      <p className="mt-1 text-xs text-text-secondary">
        {localize('com_ui_tars_users_role_follows_group')}
      </p>
    </div>
  );
}

/** Multi-group picker. Groups are a scrollable checkbox list, as in the domain editor. */
export function GroupSelect({
  groups,
  selected,
  disabled,
  onToggle,
}: {
  groups: GroupOption[];
  selected: Set<string>;
  disabled?: boolean;
  onToggle: (id: string) => void;
}) {
  const localize = useLocalize();
  return (
    <div>
      <Label>{localize('com_ui_tars_users_group')}</Label>
      {groups.length === 0 ? (
        <p className="mt-1 text-sm text-text-secondary">
          {localize('com_ui_tars_users_groups_empty')}
        </p>
      ) : (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border-light p-2">
          {groups.map((group) => (
            <label
              key={group.id}
              className="flex cursor-pointer items-center gap-2 py-1 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              aria-disabled={disabled}
            >
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={disabled}
                checked={selected.has(group.id)}
                onChange={() => onToggle(group.id)}
              />
              <span className="truncate text-text-primary">{group.name}</span>
            </label>
          ))}
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
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
        active
          ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
          : 'bg-surface-tertiary text-text-secondary'
      }`}
    >
      {active ? localize('com_ui_tars_users_enabled') : localize('com_ui_tars_users_disabled')}
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
