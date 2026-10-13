import type { TarsAccount, TarsUserGroup } from '~/tars/users';
import type { TarsRoleDetail } from '~/tars/roles';
import { fetchTarsAllUserGroups, parseTarsGroupIds } from '~/tars/directory';
import { isTarsAdminRole, parseTarsAdminRoleIds } from '~/auth/tars';
import { fetchTarsRolePrepareData } from '~/tars/roles';
import { fetchTarsUsers } from '~/tars/users';

/** The LibreChat menu key that grants Workflow (AI 設計 → Workflow). */
export const WORKFLOW_MENU_KEY = 'admin.langflow';

/** How long a directory read answers ticket requests before pwc_tars is asked again. */
const ACCESS_TTL_MS = 30 * 1000;

/** pwc_tars's users, groups and roles, as much as deciding Workflow access needs. */
export interface WorkflowAccessDirectory {
  users: Map<string, TarsAccount>;
  groupRoleIds: Map<string, string[]>;
  roleMenuKeys: Map<string, Set<string>>;
}

/**
 * Where a pwc_tars user stands with Workflow: `granted`, `revoked` (no role or group grants it any
 * more), `disabled` (account not active) or `deleted` (absent from pwc_tars's full user list).
 */
export type WorkflowStanding = 'granted' | 'revoked' | 'disabled' | 'deleted';

const csv = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export function buildWorkflowAccessDirectory(
  users: TarsAccount[],
  groups: TarsUserGroup[],
  roles: Pick<TarsRoleDetail, 'id' | 'librechat_menu_keys'>[],
): WorkflowAccessDirectory {
  return {
    users: new Map(users.map((user) => [String(user.id), user])),
    groupRoleIds: new Map(groups.map((group) => [String(group.id), csv(group.role_id)])),
    roleMenuKeys: new Map(
      roles.map((role) => [String(role.id), new Set(csv(role.librechat_menu_keys))]),
    ),
  };
}

/**
 * Mirrors pwc_tars's login (`authentication/routes.py`): the user's own role plus the roles of
 * every group they belong to — disabled groups included, as login does not filter them — and the
 * union of those roles' `librechat_menu_keys`. An admin role (`TARS_ADMIN_ROLE_IDS`) always has
 * Workflow, as `canUseTarsAdminPage` grants it.
 */
export function workflowStanding(
  tarsId: string,
  directory: WorkflowAccessDirectory,
  adminRoleIds: number[] = parseTarsAdminRoleIds(),
): WorkflowStanding {
  const user = directory.users.get(String(tarsId));
  if (!user) {
    return 'deleted';
  }
  if (user.status !== 'active') {
    return 'disabled';
  }
  if (isTarsAdminRole(user.role_id ?? null, adminRoleIds)) {
    return 'granted';
  }
  const roleIds = new Set<string>(user.role_id != null ? [String(user.role_id)] : []);
  for (const groupId of parseTarsGroupIds(user.user_group_id)) {
    for (const roleId of directory.groupRoleIds.get(groupId) ?? []) {
      roleIds.add(roleId);
    }
  }
  const granted = [...roleIds].some((roleId) =>
    directory.roleMenuKeys.get(roleId)?.has(WORKFLOW_MENU_KEY),
  );
  return granted ? 'granted' : 'revoked';
}

/** Whether the user's current pwc_tars role is an admin role (may switch Workflow identity). */
export function isWorkflowAdmin(
  tarsId: string,
  directory: WorkflowAccessDirectory,
  adminRoleIds: number[] = parseTarsAdminRoleIds(),
): boolean {
  const user = directory.users.get(String(tarsId));
  return !!user && user.status === 'active' && isTarsAdminRole(user.role_id ?? null, adminRoleIds);
}

/** Reads pwc_tars's complete user list (every status), all groups and all roles. */
export async function loadWorkflowAccessDirectory(
  baseUrl?: string,
): Promise<WorkflowAccessDirectory> {
  const [users, groups, { roles }] = await Promise.all([
    fetchTarsUsers(baseUrl),
    fetchTarsAllUserGroups(baseUrl),
    fetchTarsRolePrepareData(baseUrl),
  ]);
  return buildWorkflowAccessDirectory(users, groups, roles);
}

export interface WorkflowAccessCache {
  /** The cached directory, read again once older than the TTL. */
  get: () => Promise<WorkflowAccessDirectory>;
  /** Always reads pwc_tars, for a decision that must not rest on a stale answer. */
  refresh: () => Promise<WorkflowAccessDirectory>;
}

export function createWorkflowAccessCache(
  load: () => Promise<WorkflowAccessDirectory> = loadWorkflowAccessDirectory,
  ttlMs: number = ACCESS_TTL_MS,
): WorkflowAccessCache {
  let cached: { at: number; directory: WorkflowAccessDirectory } | null = null;
  const refresh = async () => {
    const directory = await load();
    cached = { at: Date.now(), directory };
    return directory;
  };
  return {
    get: async () => (cached && Date.now() - cached.at < ttlMs ? cached.directory : refresh()),
    refresh,
  };
}
