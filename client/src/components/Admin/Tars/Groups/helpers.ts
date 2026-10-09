import type { TTarsRole, TTarsUser, TTarsUserGroupWithMembers } from 'librechat-data-provider';
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

/**
 * The accounts among `memberIds` that hold no role of their own and no group
 * besides `groupId`, so taking this group from them leaves no permission source.
 * Deleting a group only warns, since pwc_tars allows it and members get moved
 * between groups; removing one member is refused by pwc_tars, so that blocks.
 */
export const usersLosingAccess = (
  groupId: string,
  memberIds: string[],
  usersById: Map<string, TTarsUser>,
): TTarsUser[] =>
  memberIds.flatMap((id) => {
    const user = usersById.get(id);
    const losesAccess =
      user != null &&
      user.role_id == null &&
      csvToIds(user.user_group_id).every((groupIdOfUser) => groupIdOfUser === groupId);
    return losesAccess ? [user] : [];
  });

export type GroupRoleOption = Pick<TTarsRole, 'id' | 'name'>;
