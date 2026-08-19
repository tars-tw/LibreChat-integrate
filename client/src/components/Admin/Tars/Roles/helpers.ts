import type {
  TTarsUser,
  TTarsRoleDetail,
  TTarsUserGroupWithMembers,
} from 'librechat-data-provider';
import { csvToIds } from '../Users/helpers';

/** pwc_tars stores a role's status as numeric 1/0, like the group table. */
export const ROLE_ENABLED = 1;
export const ROLE_DISABLED = 0;

export const isRoleEnabled = (role: TTarsRoleDetail): boolean =>
  Number(role.status) === ROLE_ENABLED;

export const roleDomainIds = (role: TTarsRoleDetail): string[] => csvToIds(role.domain_ids);

/**
 * The LibreChat menu keys a role grants. A `null` column means the role predates
 * this feature and is treated as "every menu" — returning `null` lets callers
 * tell that apart from an explicit empty selection.
 */
export const roleMenuKeys = (role: TTarsRoleDetail): string[] | null =>
  role.librechat_menu_keys == null ? null : csvToIds(role.librechat_menu_keys);

export type RoleUsage = { users: number; groups: number };

/**
 * How many accounts and groups reference each role. Both are derived from the
 * listings the admin pages already cache, so this costs no extra request.
 * A user counts when the role is their own `role_id`; group grants are counted
 * separately under `groups`, matching how pwc_tars resolves permissions.
 */
export const buildRoleUsage = (
  users: TTarsUser[],
  groups: TTarsUserGroupWithMembers[],
): Map<string, RoleUsage> => {
  const usage = new Map<string, RoleUsage>();
  const bump = (roleId: string, key: keyof RoleUsage) => {
    const entry = usage.get(roleId) ?? { users: 0, groups: 0 };
    entry[key] += 1;
    usage.set(roleId, entry);
  };

  for (const user of users) {
    if (user.role_id != null) {
      bump(String(user.role_id), 'users');
    }
  }
  for (const group of groups) {
    for (const roleId of csvToIds(group.role_id == null ? '' : String(group.role_id))) {
      bump(roleId, 'groups');
    }
  }
  return usage;
};

export const EMPTY_USAGE: RoleUsage = { users: 0, groups: 0 };
