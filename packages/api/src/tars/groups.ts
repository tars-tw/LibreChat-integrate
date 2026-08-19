import type { TarsUserGroup } from './users';
import type { TarsRole } from './domains';
import { tarsFetch } from './client';

/** A member row of the `user_list` pwc_tars attaches to each group. */
export interface TarsGroupMember {
  id: string;
  username: string;
  email: string | null;
  status: string;
}

/**
 * A pwc_tars user group as the group admin page sees it: `SysUserGroup.to_dict()`
 * plus the `user_count` / `user_list` that `user_group_prepare_data` computes.
 * `role_id` is a comma-separated id string — groups grant several roles.
 */
export interface TarsUserGroupWithMembers extends TarsUserGroup {
  user_count?: number;
  user_list?: TarsGroupMember[];
}

export interface TarsGroupPrepareData {
  roles: TarsRole[];
  groups: TarsUserGroupWithMembers[];
}

/** Create/update payload. `status` is pwc_tars' numeric 1/0, not the user table's string. */
export interface TarsUserGroupInput {
  name: string;
  description?: string;
  roleIds?: string;
  status?: number;
}

/**
 * pwc_tars wraps every group endpoint in `{success, status, data}` — unlike the
 * user endpoints, which return their payload at the top level. Failures come
 * back non-2xx, so `tarsFetch` has already thrown by the time this runs.
 */
interface TarsGroupEnvelope<T> {
  success?: boolean;
  data?: T;
}

interface PrepareDataPayload {
  roles?: TarsRole[];
  user_groups?: TarsUserGroupWithMembers[];
}

/**
 * Every group and role in one call (`GET /api/user_settings/user_group_prepare_data`).
 * pwc_tars embeds each group's full member list here, which is what the member
 * dialog and the user-count column read.
 */
export async function fetchTarsGroupPrepareData(baseUrl?: string): Promise<TarsGroupPrepareData> {
  const response = await tarsFetch<TarsGroupEnvelope<PrepareDataPayload>>(
    '/api/user_settings/user_group_prepare_data',
    { baseUrl },
  );
  return {
    roles: response?.data?.roles ?? [],
    groups: response?.data?.user_groups ?? [],
  };
}

export async function createTarsUserGroup(
  tarsId: string,
  input: TarsUserGroupInput,
  baseUrl?: string,
): Promise<TarsUserGroupWithMembers> {
  const response = await tarsFetch<TarsGroupEnvelope<TarsUserGroupWithMembers>>(
    '/api/user_settings/create_user_group',
    {
      method: 'POST',
      body: {
        user_id: tarsId,
        group_name: input.name,
        group_description: input.description ?? '',
        role_id: input.roleIds ?? null,
        status: input.status ?? 1,
      },
      baseUrl,
    },
  );
  return response.data as TarsUserGroupWithMembers;
}

/** pwc_tars takes the group id in the body here, not the path. */
export async function updateTarsUserGroup(
  tarsId: string,
  groupId: string,
  input: TarsUserGroupInput,
  baseUrl?: string,
): Promise<TarsUserGroupWithMembers> {
  const response = await tarsFetch<TarsGroupEnvelope<TarsUserGroupWithMembers>>(
    '/api/user_settings/update_user_group',
    {
      method: 'PUT',
      body: {
        user_id: tarsId,
        group_id: groupId,
        group_name: input.name,
        group_description: input.description ?? '',
        role_id: input.roleIds ?? null,
        status: input.status ?? 1,
      },
      baseUrl,
    },
  );
  return response.data as TarsUserGroupWithMembers;
}

/**
 * Deletes a group. pwc_tars also strips the group id out of every member's
 * `user_group_id` in the same transaction, so members are never left pointing
 * at a group that no longer exists.
 */
export async function deleteTarsUserGroup(
  tarsId: string,
  groupId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/user_settings/delete_user_group/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
    query: { user_id: tarsId },
    baseUrl,
  });
}

/** Adds users to a group, keeping whatever other groups they already belong to. */
export async function assignTarsUsersToGroup(
  tarsId: string,
  groupId: string,
  userIds: string[],
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/user_settings/assign_users_to_group', {
    method: 'PUT',
    body: { users_id: userIds, group_id: groupId, operator_id: tarsId },
    baseUrl,
  });
}

/** Removes one member from one group, leaving their other groups intact. */
export async function removeTarsUserFromGroup(
  tarsId: string,
  groupId: string,
  userId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/user_settings/update_user_remove_group', {
    method: 'POST',
    body: { user_id: userId, group_id: groupId, operator_id: tarsId },
    baseUrl,
  });
}
