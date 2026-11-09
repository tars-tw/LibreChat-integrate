import { logger } from '@librechat/data-schemas';
import type { TTarsMcpPermissionPrincipal } from 'librechat-data-provider';
import type { TarsDirectory, TarsDirectoryCache } from '~/tars/directory';
import type { TarsBoundServer } from './enable';
import { adminListTarsMcpPermissionPrincipals } from './admin';
import { enableTarsServersFor } from './enable';
import { isTarsMcpEnabled } from './config';

/**
 * Turns a server on in My Tools for the people an admin newly assigns it to, so it
 * shows up in their Agent Builder tool list without a trip to My Tools first.
 *
 * "Newly" is read off pwc_tars's grant overview before and after the save, not off
 * the request: a save overwrites every listed principal, so the request also names
 * people who already held the server (and may have switched it off on purpose), and a
 * user who held it through a group is not new when assigned it directly. A group
 * counts its active members at save time; someone who joins later is not turned on.
 */

/** Each server's holders as pwc_tars user ids: active direct assignees plus enabled groups' active members. */
export function holdersByServer(
  principals: TTarsMcpPermissionPrincipal[],
  directory: TarsDirectory,
): Map<string, Set<string>> {
  const membersByGroup = new Map(directory.groups.map((group) => [group.id, group.memberIds]));
  const holders = new Map<string, Set<string>>();
  for (const principal of principals) {
    if (!principal.is_active) {
      continue;
    }
    const userIds =
      principal.principal_type === 'user'
        ? [principal.principal_id]
        : (membersByGroup.get(principal.principal_id) ?? []);
    for (const serverId of principal.mcp_server_ids) {
      const serverHolders = holders.get(serverId) ?? new Set<string>();
      userIds.forEach((userId) => serverHolders.add(userId));
      holders.set(serverId, serverHolders);
    }
  }
  return holders;
}

/** The servers each user holds after a save but did not before, each to be turned on whole. */
export function newlyGrantedServers(
  before: TTarsMcpPermissionPrincipal[],
  after: TTarsMcpPermissionPrincipal[],
  directory: TarsDirectory,
): Map<string, TarsBoundServer[]> {
  const held = holdersByServer(before, directory);
  const plan = new Map<string, TarsBoundServer[]>();
  for (const [serverId, holders] of holdersByServer(after, directory)) {
    for (const userId of holders) {
      if (held.get(serverId)?.has(userId)) {
        continue;
      }
      const servers = plan.get(userId) ?? [];
      servers.push({ mcp_server_id: serverId, mcp_tool_ids: [] });
      plan.set(userId, servers);
    }
  }
  return plan;
}

export interface TarsMcpGrantEnableDeps {
  /** Refreshed when enabling, so a group whose members just changed counts them. */
  directory: Pick<TarsDirectoryCache, 'refresh'>;
}

export interface TarsMcpGrantEnable {
  /**
   * Runs `save` (a pwc_tars grant overwrite) and resolves with its result; once it has
   * saved, turns the servers on for whoever it newly assigned, without holding up the
   * response. Enabling never fails the save: a failure is only logged.
   */
  saveThenEnable<T>(adminTarsId: string, save: () => Promise<T>): Promise<T>;
}

export function createTarsMcpGrantEnable(deps: TarsMcpGrantEnableDeps): TarsMcpGrantEnable {
  /** Null when the overview cannot be read: without it no one can be told apart as new. */
  async function readBefore(adminTarsId: string): Promise<TTarsMcpPermissionPrincipal[] | null> {
    if (!isTarsMcpEnabled()) {
      return null;
    }
    try {
      return await adminListTarsMcpPermissionPrincipals(adminTarsId);
    } catch (error) {
      logger.warn(
        '[tars-mcp] Failed to read the MCP grants before saving; newly assigned servers stay off',
        error,
      );
      return null;
    }
  }

  async function enableNew(
    adminTarsId: string,
    before: TTarsMcpPermissionPrincipal[],
  ): Promise<void> {
    const [after, directory] = await Promise.all([
      adminListTarsMcpPermissionPrincipals(adminTarsId),
      deps.directory.refresh(),
    ]);
    const plan = newlyGrantedServers(before, after, directory);
    if (plan.size > 0) {
      await enableTarsServersFor(plan, 'an MCP assignment');
    }
  }

  return {
    async saveThenEnable(adminTarsId, save) {
      const before = await readBefore(adminTarsId);
      const result = await save();
      if (before) {
        enableNew(adminTarsId, before).catch((error) =>
          logger.warn('[tars-mcp] Failed to turn on newly assigned MCP servers', error),
        );
      }
      return result;
    },
  };
}
