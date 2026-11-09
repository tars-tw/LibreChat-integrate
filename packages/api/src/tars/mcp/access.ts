import { logger } from '@librechat/data-schemas';
import { Constants, TARS_MCP_SERVER_PREFIX } from 'librechat-data-provider';
import type { LCTool, LCToolRegistry } from '@librechat/agents';
import type { MCPOptions } from 'librechat-data-provider';
import { cachedVisibleTarsEntries } from './user';
import { tarsMcpDirectEntries } from './names';
import { isTarsMcpEnabled } from './config';

/**
 * Gateway entries are enforced by pwc_tars on every call. An OIDC entry bypasses the gateway,
 * so the same assignment and opt-in have to be checked here, at every point a connection is
 * opened, a token is issued or a tool is called. The shared `mcpConfig` lists the entry for
 * every user, so nothing upstream of these checks limits who reaches the server.
 */

type TarsIdResolver = (userId: string) => Promise<string | null | undefined>;

let resolveTarsId: TarsIdResolver | undefined;

/**
 * Background OAuth reconnects carry only `{ id }`, so the guard needs its own way to the linked
 * account. Unset, those callers are denied, which is the safe direction.
 */
export function configureTarsMcpAccess(deps: { resolveTarsId: TarsIdResolver }): void {
  resolveTarsId = deps.resolveTarsId;
}

export class TarsMcpAccessDeniedError extends Error {
  constructor(serverName: string, toolName?: string) {
    super(
      toolName
        ? `Tool "${toolName}" on MCP server "${serverName}" is not available to this account`
        : `MCP server "${serverName}" is not available to this account`,
    );
    this.name = 'TarsMcpAccessDeniedError';
  }
}

/** A `tars_*` entry that talks to its server directly; gateway entries never carry `oauth`. */
export function isTarsDirectMcpConfig(
  serverName: string,
  config?: Pick<MCPOptions, 'oauth'> | null,
): boolean {
  return serverName.startsWith(TARS_MCP_SERVER_PREFIX) && config?.oauth != null;
}

async function linkedTarsId(user?: {
  id?: string;
  tarsId?: string | null;
}): Promise<string | null> {
  if (user?.tarsId) {
    return user.tarsId;
  }
  if (!user?.id || !resolveTarsId) {
    return null;
  }
  return (await resolveTarsId(user.id).catch(() => null)) ?? null;
}

/**
 * Fails closed: an unlinked account or an unreachable pwc_tars may use no direct entry. With a
 * `toolName`, a tool the admin has not opened or the user switched off is refused as well.
 */
export async function canUseTarsDirectMcpServer(
  serverName: string,
  config: Pick<MCPOptions, 'oauth'> | null | undefined,
  user?: { id?: string; tarsId?: string | null },
  toolName?: string,
): Promise<boolean> {
  if (!isTarsMcpEnabled() || !isTarsDirectMcpConfig(serverName, config)) {
    return true;
  }
  const tarsUserId = await linkedTarsId(user);
  const isToolUsable = (await cachedVisibleTarsEntries(tarsUserId)).get(serverName);
  return isToolUsable != null && (toolName == null || isToolUsable(toolName));
}

export async function assertTarsDirectMcpAccess(
  serverName: string,
  config: Pick<MCPOptions, 'oauth'> | null | undefined,
  user?: { id?: string; tarsId?: string | null },
  toolName?: string,
): Promise<void> {
  if (!(await canUseTarsDirectMcpServer(serverName, config, user, toolName))) {
    throw new TarsMcpAccessDeniedError(serverName, toolName);
  }
}

type DirectToolDefinition = LCTool & { serverToolName?: string };

interface DirectToolSelection {
  toolDefinitions: LCTool[];
  toolRegistry?: LCToolRegistry;
}

/**
 * Removes the tools an admin has not opened or a user switched off on an OIDC server from this
 * turn's definitions, so the model is never offered a call `callTool` would refuse. A turn without
 * such a tool costs no pwc_tars read, and an entry the user cannot reach is left to the per-call
 * check.
 */
export async function dropDisabledTarsDirectTools(
  selection: DirectToolSelection,
  user?: { id?: string; tarsId?: string | null },
): Promise<DirectToolSelection> {
  const suffixes = [...tarsMcpDirectEntries().keys()].map((name) => [
    name,
    `${Constants.mcp_delimiter}${name}`,
  ]);
  const ownerOf = (toolName: string) => suffixes.find(([, suffix]) => toolName.endsWith(suffix));
  if (!isTarsMcpEnabled() || !selection.toolDefinitions.some((tool) => ownerOf(tool.name))) {
    return selection;
  }
  const entries = await cachedVisibleTarsEntries(await linkedTarsId(user));
  const isDisabled = (tool: DirectToolDefinition): boolean => {
    const owner = ownerOf(tool.name);
    if (!owner) {
      return false;
    }
    const upstreamName = tool.serverToolName ?? tool.name.slice(0, -owner[1].length);
    return entries.get(owner[0])?.(upstreamName) === false;
  };
  const dropped = new Set(selection.toolDefinitions.filter(isDisabled).map((tool) => tool.name));
  if (dropped.size === 0) {
    return selection;
  }
  logger.debug(`[tars-mcp] Dropped tools not usable by this user: ${[...dropped].join(', ')}`);
  const toolRegistry = selection.toolRegistry && new Map(selection.toolRegistry);
  dropped.forEach((name) => toolRegistry?.delete(name));
  return {
    toolDefinitions: selection.toolDefinitions.filter((tool) => !dropped.has(tool.name)),
    toolRegistry,
  };
}

/**
 * For a listing that hands an OIDC server's catalog to the user (the agent builder reads one):
 * whether a tool of that entry is usable. Other entries pass, and without a direct entry this
 * costs no pwc_tars read.
 */
export async function resolveTarsDirectToolFilter(user?: {
  id?: string;
  tarsId?: string | null;
}): Promise<(serverName: string, toolName: string) => boolean> {
  const direct = tarsMcpDirectEntries();
  if (!isTarsMcpEnabled() || direct.size === 0) {
    return () => true;
  }
  const entries = await cachedVisibleTarsEntries(await linkedTarsId(user));
  return (serverName, toolName) =>
    !direct.has(serverName) || entries.get(serverName)?.(toolName) === true;
}
