import type { TTarsRole, TTarsUserGroupWithMembers } from 'librechat-data-provider';
import { csvToIds } from '../Users/helpers';

/** pwc_tars stores a group's status as numeric 1/0, unlike the user table's strings. */
export const GROUP_ENABLED = 1;
export const GROUP_DISABLED = 0;

export const isGroupEnabled = (group: TTarsUserGroupWithMembers): boolean =>
  Number(group.status) === GROUP_ENABLED;

/** A group grants several roles; `role_id` holds them comma separated. */
export const groupRoleIds = (group: TTarsUserGroupWithMembers): string[] =>
  csvToIds(group.role_id == null ? '' : String(group.role_id));

export const groupRoleNames = (
  group: TTarsUserGroupWithMembers,
  roles: Map<string, string>,
): string[] =>
  groupRoleIds(group)
    .map((id) => roles.get(id))
    .filter((name): name is string => !!name);

export const memberCount = (group: TTarsUserGroupWithMembers): number =>
  group.user_count ?? group.user_list?.length ?? 0;

export type GroupRoleOption = Pick<TTarsRole, 'id' | 'name'>;
