import { logger } from '@librechat/data-schemas';
import {
  Constants,
  PrincipalType,
  ResourceType,
  splitMCPToolKey,
  isTarsMcpToolKey,
  TARS_MCP_SHARE_BLOCKED,
  TARS_MCP_PUBLIC_SHARE_BLOCKED,
  TARS_MCP_SHARE_CHECK_UNAVAILABLE,
} from 'librechat-data-provider';
import type { TPrincipal, TTarsMcpShareGap, TTarsMcpShareBlock } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { TarsAvailableToolRow } from './client';
import { buildScopedToolName, PROXIED_SERVER_TYPES, tarsMcpFetch } from './client';
import { isTarsMcpEnabled } from './config';
import { gatewayNameFor } from './names';

/**
 * Sharing an agent never gave anyone its pwc_tars MCP tools: the gateway lists and
 * runs them per user, so a share target without the assignment gets an agent whose
 * tools simply fail. These checks stop that at the point of sharing, or of adding a
 * tool to an agent that is already shared. pwc_tars remains the runtime enforcement.
 */

type SharePrincipal = Pick<TPrincipal, 'type' | 'id' | 'idOnTheSource' | 'name'>;

interface GatewayServer {
  id: string;
  /** Gateway tool name → pwc_tars tool id. */
  toolIds: Map<string, string>;
  taken: Set<string>;
}

interface ShareCheckServer {
  mcp_server_id: string;
  /** Empty binds the whole server: pwc_tars requires every enabled tool. */
  mcp_tool_ids: string[];
}

interface ShareCheckMissing {
  principal_type: TTarsMcpShareBlock['principal_type'];
  principal_id: string;
  servers: TTarsMcpShareGap[];
}

export interface TarsMcpShareRefusal {
  status: number;
  body: { code: string; error: string; blocked?: TTarsMcpShareBlock[] };
}

const CHECK_UNAVAILABLE: TarsMcpShareRefusal = {
  status: 503,
  body: { code: TARS_MCP_SHARE_CHECK_UNAVAILABLE, error: 'Could not verify MCP assignments' },
};

const PUBLIC_REFUSED: TarsMcpShareRefusal = {
  status: 409,
  body: {
    code: TARS_MCP_PUBLIC_SHARE_BLOCKED,
    error: 'An agent with MCP tools cannot be shared with everyone',
  },
};

const SHARED_RESOURCES: string[] = [ResourceType.AGENT, ResourceType.REMOTE_AGENT];

/** Every tool pwc_tars has, keyed the way agents store them: `available-tools` with no user. */
async function loadGatewayServers(): Promise<Map<string, GatewayServer>> {
  const rows = await tarsMcpFetch<TarsAvailableToolRow[]>('/api/mcp/available-tools');
  const servers = new Map<string, GatewayServer>();
  for (const row of rows ?? []) {
    const gatewayName = PROXIED_SERVER_TYPES.has(row.server_type)
      ? gatewayNameFor(row.server_id, row.server_code)
      : null;
    if (gatewayName == null) {
      continue;
    }
    const server = servers.get(gatewayName) ?? {
      id: row.server_id,
      toolIds: new Map<string, string>(),
      taken: new Set<string>(),
    };
    servers.set(gatewayName, server);
    const scopedName = buildScopedToolName(row, server.taken, gatewayName);
    if (scopedName) {
      server.taken.add(scopedName);
      server.toolIds.set(scopedName, row.tool_id);
    }
  }
  return servers;
}

/**
 * The tools an agent binds, as pwc_tars ids. A key that resolves to nothing belongs to a
 * deleted tool or server nobody can use, and a server held only by its UI placeholder
 * token binds no tools, so neither asks anything of a share target.
 */
function requiredServers(tools: string[], servers: Map<string, GatewayServer>): ShareCheckServer[] {
  const gatewayNames = [...servers.keys()];
  const required = new Map<string, { whole: boolean; toolIds: Set<string> }>();
  for (const tool of tools) {
    if (!isTarsMcpToolKey(tool)) {
      continue;
    }
    const [toolName, gatewayName] = splitMCPToolKey(tool, gatewayNames);
    const server = gatewayName != null ? servers.get(gatewayName) : undefined;
    if (!server) {
      continue;
    }
    const entry = required.get(server.id) ?? { whole: false, toolIds: new Set<string>() };
    const toolId = server.toolIds.get(toolName);
    if (toolName === Constants.mcp_all) {
      entry.whole = true;
    } else if (toolId != null) {
      entry.toolIds.add(toolId);
    }
    required.set(server.id, entry);
  }
  return [...required]
    .filter(([, entry]) => entry.whole || entry.toolIds.size > 0)
    .map(([id, entry]) => ({
      mcp_server_id: id,
      mcp_tool_ids: entry.whole ? [] : [...entry.toolIds],
    }));
}

const sourceId = (principal: SharePrincipal): string =>
  String(principal.idOnTheSource ?? principal.id ?? '');

const isCheckable = (principal: SharePrincipal): boolean =>
  principal.type === PrincipalType.USER || principal.type === PrincipalType.GROUP;

async function refusalFor(
  tools: string[],
  principals: SharePrincipal[],
): Promise<TarsMcpShareRefusal | null> {
  if (!tools.some(isTarsMcpToolKey) || principals.length === 0) {
    return null;
  }
  if (!principals.every(isCheckable)) {
    return PUBLIC_REFUSED;
  }
  const servers = requiredServers(tools, await loadGatewayServers());
  if (servers.length === 0) {
    return null;
  }
  const names = new Map(principals.map((principal) => [sourceId(principal), principal.name ?? '']));
  const result = await tarsMcpFetch<{ missing: ShareCheckMissing[] }>('/api/mcp/share-check', {
    method: 'POST',
    body: {
      principals: principals.map((principal) => ({
        principal_type: principal.type,
        principal_id: sourceId(principal),
      })),
      servers,
    },
  });
  const blocked = (result?.missing ?? []).map(({ principal_type, principal_id, servers }) => ({
    principal_type,
    idOnTheSource: principal_id,
    name: names.get(principal_id) ?? '',
    servers,
  }));
  if (blocked.length === 0) {
    return null;
  }
  return {
    status: 409,
    body: {
      code: TARS_MCP_SHARE_BLOCKED,
      error: 'Some share targets are not assigned the MCP tools this agent uses',
      blocked,
    },
  };
}

async function refusalOrUnavailable(
  load: () => Promise<{ tools: string[]; principals: SharePrincipal[] }>,
): Promise<TarsMcpShareRefusal | null> {
  try {
    const { tools, principals } = await load();
    return await refusalFor(tools, principals);
  } catch (error) {
    logger.error('[tars-mcp] Failed to check the MCP assignments of an agent share', error);
    return CHECK_UNAVAILABLE;
  }
}

interface ShareAclEntry {
  principalType: string;
  principalId?: { toString(): string } | null;
}

interface ShareUser {
  _id: { toString(): string };
  name?: string;
  username?: string;
  idOnTheSource?: string;
}

interface ShareGroup {
  _id: { toString(): string };
  name: string;
  idOnTheSource?: string;
}

interface SharedAgent {
  _id: { toString(): string };
  author?: { toString(): string } | null;
  tools?: string[];
}

export interface TarsAgentShareDeps {
  getAgent: (filter: { _id: string }) => Promise<SharedAgent | null>;
  findEntriesByResource: (resourceType: string, resourceId: string) => Promise<ShareAclEntry[]>;
  findUsersByIds: (ids: string[]) => Promise<ShareUser[]>;
  findGroupsByIds: (ids: string[]) => Promise<Array<ShareGroup | null>>;
}

export interface TarsAgentShare {
  /** Route guard for `PUT /api/permissions/:resourceType/:resourceId`. */
  guard: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  /**
   * The refusal for saving `nextTools`, judged only on the tools it adds, so an edit that
   * leaves them alone is never stuck on an assignment revoked after the agent was shared.
   */
  refuseAddedTools: (
    agent: SharedAgent,
    nextTools?: string[],
  ) => Promise<TarsMcpShareRefusal | null>;
}

export function createTarsAgentShare(deps: TarsAgentShareDeps): TarsAgentShare {
  /** Everyone the agent is shared with, on either resource; the author needs no share. */
  const listSharedPrincipals = async (agent: SharedAgent): Promise<SharePrincipal[]> => {
    const agentId = agent._id.toString();
    const entries = await Promise.all(
      SHARED_RESOURCES.map((resourceType) => deps.findEntriesByResource(resourceType, agentId)),
    );
    const userIds = new Set<string>();
    const groupIds = new Set<string>();
    const others = new Set<PrincipalType>();
    for (const { principalType, principalId } of entries.flat()) {
      if (principalType === PrincipalType.USER && principalId != null) {
        userIds.add(principalId.toString());
      } else if (principalType === PrincipalType.GROUP && principalId != null) {
        groupIds.add(principalId.toString());
      } else {
        others.add(principalType as PrincipalType);
      }
    }
    userIds.delete(agent.author?.toString() ?? '');
    const [users, groups] = await Promise.all([
      userIds.size > 0 ? deps.findUsersByIds([...userIds]) : [],
      groupIds.size > 0 ? deps.findGroupsByIds([...groupIds]) : [],
    ]);
    return [
      ...users.map(({ _id, name, username, idOnTheSource }) => ({
        type: PrincipalType.USER,
        id: _id.toString(),
        idOnTheSource,
        name: name || username,
      })),
      ...groups.flatMap((group) =>
        group == null
          ? []
          : [
              {
                type: PrincipalType.GROUP,
                id: group._id.toString(),
                idOnTheSource: group.idOnTheSource,
                name: group.name,
              },
            ],
      ),
      ...[...others].map((type) => ({ type })),
    ];
  };

  const guard: TarsAgentShare['guard'] = async (req, res, next) => {
    const { resourceType, resourceId } = req.params;
    if (!SHARED_RESOURCES.includes(resourceType) || !isTarsMcpEnabled()) {
      next();
      return;
    }
    const { updated, public: isPublic } = (req.body ?? {}) as {
      updated?: SharePrincipal[];
      public?: boolean;
    };
    const principals: SharePrincipal[] = [
      ...(Array.isArray(updated) ? updated : []),
      ...(isPublic === true ? [{ type: PrincipalType.PUBLIC }] : []),
    ];
    if (principals.length === 0) {
      next();
      return;
    }
    const refusal = await refusalOrUnavailable(async () => ({
      tools: (await deps.getAgent({ _id: resourceId }))?.tools ?? [],
      principals,
    }));
    if (refusal) {
      res.status(refusal.status).json(refusal.body);
      return;
    }
    next();
  };

  const refuseAddedTools: TarsAgentShare['refuseAddedTools'] = async (agent, nextTools) => {
    const existing = new Set(agent.tools ?? []);
    const added = (nextTools ?? []).filter((tool) => !existing.has(tool));
    if (!isTarsMcpEnabled() || !added.some(isTarsMcpToolKey)) {
      return null;
    }
    return refusalOrUnavailable(async () => ({
      tools: added,
      principals: await listSharedPrincipals(agent),
    }));
  };

  return { guard, refuseAddedTools };
}
