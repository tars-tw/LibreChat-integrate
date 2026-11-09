import { logger } from '@librechat/data-schemas';
import type { MCPOptions } from 'librechat-data-provider';
import type { TarsMcpBatchDeleteResult, TarsMcpServerDetail } from './admin';
import type { MCPOAuthTeardownOptions } from '~/mcp/oauth/cleanup';
import type { TarsOidcPolicy } from './oidc';
import { cleanupDeletedMCPServerOAuthUsers } from '~/mcp/oauth/cleanup';
import { derivedTarsMcpEntryName, tarsMcpEntryName } from './names';
import { buildTarsOidcEntry, isTarsOidcServer } from './oidc';
import { tarsMcpFetch } from './client';

/**
 * Users' OIDC tokens are stored under the entry name, which is derived from the server's code and
 * outlives the row. Left behind, a later server with the same code would inherit them and send
 * them to its own URL, so they go when the server is deleted or stops being what they were
 * issued for.
 */

/** A server whose tokens may need clearing, read before the change that may strand them. */
export interface TarsOidcTeardownTarget {
  serverId: string;
  entryName: string;
  identity: string;
  /** For revoking at the provider; without it, only local state is cleared. */
  serverConfig?: MCPOptions;
}

/** What a stored token was issued for: a change to any of these makes it unusable or unsafe. */
function credentialIdentity(server: TarsMcpServerDetail): string {
  const connection = server.connection_config;
  const auth = connection?.auth as { issuer?: unknown; client_id?: unknown } | undefined;
  return JSON.stringify([server.code, connection?.url, auth?.issuer, auth?.client_id]);
}

/** Includes disabled servers, which have no `mcpConfig` entry but keep their users' tokens. */
export async function readTarsOidcTeardownTargets(
  serverIds: string[],
  policy?: TarsOidcPolicy,
): Promise<TarsOidcTeardownTarget[]> {
  const wanted = new Set(serverIds);
  const servers = await tarsMcpFetch<TarsMcpServerDetail[]>('/api/mcp/servers');
  return (servers ?? [])
    .filter((server) => wanted.has(server.id) && isTarsOidcServer(server))
    .map((server) => ({
      serverId: server.id,
      entryName: tarsMcpEntryName(server.id) ?? derivedTarsMcpEntryName(server.id, server.code),
      identity: credentialIdentity(server),
      serverConfig: buildTarsOidcEntry(server, {}, policy) ?? undefined,
    }));
}

/** The targets an update stranded: moved to another issuer, client, URL or code, or off OIDC. */
export function movedTarsOidcTargets(
  targets: TarsOidcTeardownTarget[],
  updated?: TarsMcpServerDetail,
): TarsOidcTeardownTarget[] {
  if (!updated) {
    return [];
  }
  return targets.filter(
    (target) => !isTarsOidcServer(updated) || target.identity !== credentialIdentity(updated),
  );
}

/** The targets a batch delete removed; one it skipped or could not find keeps its tokens. */
export function deletedTarsOidcTargets(
  targets: TarsOidcTeardownTarget[],
  result?: Pick<TarsMcpBatchDeleteResult, 'deleted'>,
): TarsOidcTeardownTarget[] {
  const deleted = new Set((result?.deleted ?? []).map((server) => server.id));
  return targets.filter((target) => deleted.has(target.serverId));
}

export interface TarsOidcTeardownDeps {
  findTokenUserIds: (identifiers: string[]) => Promise<string[]>;
  resolveAllowlists: (
    userId: string,
  ) => Promise<{ allowedDomains?: string[] | null; allowedAddresses?: string[] | null }>;
  invalidateUserTools: (userId: string, serverName: string) => Promise<void>;
  disconnectUser: (userId: string, serverName: string) => Promise<void>;
  uninstallOAuthMCP: (
    userId: string,
    pluginKey: string,
    appConfig: { mcpSettings?: TarsOidcPolicy },
    serverConfig?: MCPOptions,
    teardown?: MCPOAuthTeardownOptions,
  ) => Promise<void>;
}

/**
 * Disconnects every token holder, revokes at the provider and deletes the local tokens. Run after
 * the change commits, so holders are read once no new sign-in can start. The change has already
 * happened by then, so a failure is logged rather than reported as a failed save.
 */
export function createTarsOidcTeardown(deps: TarsOidcTeardownDeps) {
  const teardownOne = async (target: TarsOidcTeardownTarget, actingUserId: string) => {
    const { entryName: serverName, serverConfig } = target;
    const identifier = `mcp:${serverName}`;
    const getTokenUserIds = () =>
      deps.findTokenUserIds([identifier, `${identifier}:client`, `${identifier}:refresh`]);
    const tokenUserIds = await getTokenUserIds();
    if (tokenUserIds.length === 0) {
      return;
    }
    await cleanupDeletedMCPServerOAuthUsers({
      ownerUserId: actingUserId,
      serverName,
      serverConfig,
      /** Holding a token is the only access a `tars_*` entry records, so holders are its viewers. */
      snapshot: { tokenUserIds, aclEntries: [], viewerUserIds: tokenUserIds },
      getTokenUserIds,
      getUserPrincipals: async () => [],
      resolveAllowlists: deps.resolveAllowlists,
      fenceAndDisconnectUser: async (userId) => {
        await deps.invalidateUserTools(userId, serverName);
        await deps.disconnectUser(userId, serverName);
      },
      uninstallOAuthMCP: deps.uninstallOAuthMCP,
    });
  };

  return async (targets: TarsOidcTeardownTarget[], actingUserId: string): Promise<void> => {
    await Promise.all(
      targets.map((target) =>
        teardownOne(target, actingUserId).catch((error) =>
          logger.error(`[tars-mcp] Failed to clear OAuth tokens of ${target.entryName}`, error),
        ),
      ),
    );
  };
}
