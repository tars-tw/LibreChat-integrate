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
import type {
  TPrincipal,
  TTarsMcpShareGap,
  TTarsMcpShareBlock,
  TTarsDomainShareGap,
} from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { TarsSharePrincipal } from '~/tars/domains';
import type { TarsAvailableToolRow } from './client';
import { buildScopedToolName, PROXIED_SERVER_TYPES, tarsMcpFetch } from './client';
import { fetchTarsDomainShareCheck, toTarsDomainShareGap } from '~/tars/domains';
import { isTarsConfigured } from '~/tars/client';
import { isTarsMcpEnabled } from './config';
import { gatewayNameFor } from './names';

/**
 * Sharing an agent never gave anyone its pwc_tars MCP tools or its 專用腦: the gateway
 * lists and runs the tools per user, and a chat with a brain-bound agent is refused to
 * anyone outside the brain's role grants. So a share target lacking either gets an
 * agent that does not work. These checks stop that at the point of sharing, or of
 * adding a tool to an agent that is already shared. pwc_tars and the chat route remain
 * the runtime enforcement.
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

interface ShareCheckMissing extends TarsSharePrincipal {
  servers: TTarsMcpShareGap[];
}

interface ShareTarget extends TarsSharePrincipal {
  name: string;
}

/** What a share target must have: the gateway tools and the 專用腦 the agent binds. */
interface ShareRequirements {
  tools: string[];
  domainId?: string | null;
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
    error: 'An agent with MCP tools or a specialized brain cannot be shared with everyone',
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

const principalKey = ({ principal_type, principal_id }: TarsSharePrincipal): string =>
  `${principal_type}:${principal_id}`;

/** Checkable principals as pwc_tars identifies them, each once. */
function toTargets(principals: SharePrincipal[]): ShareTarget[] {
  const targets = new Map<string, ShareTarget>();
  for (const principal of principals) {
    const target: ShareTarget = {
      principal_type: principal.type === PrincipalType.USER ? 'user' : 'group',
      principal_id: sourceId(principal),
      name: principal.name ?? '',
    };
    targets.set(principalKey(target), target);
  }
  return [...targets.values()];
}

/** The gateway servers each target lacks, keyed by `principalKey`. */
async function missingServers(
  tools: string[],
  principals: TarsSharePrincipal[],
): Promise<Map<string, TTarsMcpShareGap[]>> {
  const servers = requiredServers(tools, await loadGatewayServers());
  if (servers.length === 0) {
    return new Map();
  }
  const result = await tarsMcpFetch<{ missing: ShareCheckMissing[] }>('/api/mcp/share-check', {
    method: 'POST',
    body: { principals, servers },
  });
  return new Map((result?.missing ?? []).map((miss) => [principalKey(miss), miss.servers]));
}

/** The brain each target cannot use, keyed by `principalKey`. */
async function missingDomain(
  domainId: string,
  principals: TarsSharePrincipal[],
): Promise<Map<string, TTarsDomainShareGap>> {
  const { domain, missing } = await fetchTarsDomainShareCheck(domainId, principals);
  const gap = toTarsDomainShareGap(domain);
  return new Map(missing.map((miss) => [principalKey(miss), gap]));
}

async function refusalFor(
  { tools, domainId }: ShareRequirements,
  principals: SharePrincipal[],
): Promise<TarsMcpShareRefusal | null> {
  const bindsTools = isTarsMcpEnabled() && tools.some(isTarsMcpToolKey);
  if ((!bindsTools && !domainId) || principals.length === 0) {
    return null;
  }
  if (!principals.every(isCheckable)) {
    return PUBLIC_REFUSED;
  }
  const targets = toTargets(principals);
  const asked = targets.map(({ principal_type, principal_id }) => ({
    principal_type,
    principal_id,
  }));
  const [serverGaps, domainGaps] = await Promise.all([
    bindsTools ? missingServers(tools, asked) : new Map<string, TTarsMcpShareGap[]>(),
    domainId ? missingDomain(domainId, asked) : new Map<string, TTarsDomainShareGap>(),
  ]);
  const blocked = targets.flatMap((target): TTarsMcpShareBlock[] => {
    const key = principalKey(target);
    const servers = serverGaps.get(key) ?? [];
    const domain = domainGaps.get(key);
    if (servers.length === 0 && domain == null) {
      return [];
    }
    return [
      {
        principal_type: target.principal_type,
        idOnTheSource: target.principal_id,
        name: target.name,
        servers,
        ...(domain ? { domain } : {}),
      },
    ];
  });
  if (blocked.length === 0) {
    return null;
  }
  return {
    status: 409,
    body: {
      code: TARS_MCP_SHARE_BLOCKED,
      error: 'Some share targets lack the MCP tools or the specialized brain this agent uses',
      blocked,
    },
  };
}

async function refusalOrUnavailable(
  load: () => Promise<{ requirements: ShareRequirements; principals: SharePrincipal[] }>,
): Promise<TarsMcpShareRefusal | null> {
  try {
    const { requirements, principals } = await load();
    return await refusalFor(requirements, principals);
  } catch (error) {
    logger.error('[tars-mcp] Failed to check the permissions of an agent share', error);
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
  tars_domain_id?: string | null;
}

export interface TarsAgentShareDeps {
  getAgent: (filter: { _id: string }) => Promise<SharedAgent | null>;
  findEntriesByResource: (resourceType: string, resourceId: string) => Promise<ShareAclEntry[]>;
  findUsersByIds: (ids: string[]) => Promise<ShareUser[]>;
  findGroupsByIds: (ids: string[]) => Promise<Array<ShareGroup | null>>;
}

/** What a save or version restore would leave the agent bound to; omitted = unchanged. */
export interface AgentBindings {
  tools?: string[];
  tars_domain_id?: string | null;
}

export interface TarsAgentShare {
  /** Route guard for `PUT /api/permissions/:resourceType/:resourceId`. */
  guard: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  /**
   * The refusal for saving `next`, judged only on what it newly binds (added tools, a
   * brain bound or switched), so an edit that leaves them alone is never stuck on an
   * assignment or role grant revoked after the agent was shared.
   */
  refuseNewBindings: (
    agent: SharedAgent,
    next: AgentBindings,
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
    if (!SHARED_RESOURCES.includes(resourceType) || !isTarsConfigured()) {
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
    const refusal = await refusalOrUnavailable(async () => {
      const agent = await deps.getAgent({ _id: resourceId });
      return {
        requirements: { tools: agent?.tools ?? [], domainId: agent?.tars_domain_id },
        principals,
      };
    });
    if (refusal) {
      res.status(refusal.status).json(refusal.body);
      return;
    }
    next();
  };

  const refuseNewBindings: TarsAgentShare['refuseNewBindings'] = async (agent, next) => {
    const existing = new Set(agent.tools ?? []);
    const tools = (next.tools ?? []).filter((tool) => !existing.has(tool));
    const domainId =
      next.tars_domain_id && next.tars_domain_id !== agent.tars_domain_id
        ? next.tars_domain_id
        : null;
    const addsTools = isTarsMcpEnabled() && tools.some(isTarsMcpToolKey);
    if (!isTarsConfigured() || (!addsTools && !domainId)) {
      return null;
    }
    return refusalOrUnavailable(async () => ({
      requirements: { tools, domainId },
      principals: await listSharedPrincipals(agent),
    }));
  };

  return { guard, refuseNewBindings };
}
