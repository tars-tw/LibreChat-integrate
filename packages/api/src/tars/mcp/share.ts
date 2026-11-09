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
  tarsRequiredKnowledgeBaseIds,
} from 'librechat-data-provider';
import type {
  TPrincipal,
  TTarsMcpShareGap,
  TTarsMcpShareBlock,
  TTarsAgentKnowledgeBases,
  TTarsKnowledgeBaseShareGap,
} from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { TarsDirectoryCache } from '~/tars/directory';
import type { TarsSharePrincipal } from '~/tars/domains';
import type { TarsAvailableToolRow } from './client';
import type { TarsBoundServer } from './enable';
import { buildScopedToolName, PROXIED_SERVER_TYPES, tarsMcpFetch } from './client';
import { gatewayNameFor, tarsMcpDirectEntries } from './names';
import { fetchTarsKnowledgeBaseShareCheck } from '~/tars/access';
import { enableTarsBoundServers } from './enable';
import { isTarsConfigured } from '~/tars/client';
import { isTarsMcpEnabled } from './config';

/**
 * Sharing an agent never gave anyone its pwc_tars MCP tools or the knowledge bases its
 * TARS tools picked: the gateway lists and runs the tools per user, and a turn reaches a
 * picked knowledge base only where the acting user is on its chat list (`km_permission`).
 * So a share target lacking either gets an agent that does not work. These checks stop
 * that at the point of sharing, or of adding a tool or a pick to an agent that is already
 * shared. pwc_tars and the per-turn scope remain the runtime enforcement.
 */

type SharePrincipal = Pick<TPrincipal, 'type' | 'id' | 'idOnTheSource' | 'name'>;

interface GatewayServer {
  id: string;
  /** Gateway tool name → pwc_tars tool id. */
  toolIds: Map<string, string>;
  taken: Set<string>;
  /** pwc_tars has no tool rows for it, so any bound tool asks for the whole server. */
  direct?: boolean;
}

interface ShareCheckMissing extends TarsSharePrincipal {
  servers: TTarsMcpShareGap[];
}

interface ShareTarget extends TarsSharePrincipal {
  name: string;
}

/** What a share target must have: the gateway tools and the knowledge bases the agent uses. */
interface ShareRequirements {
  tools: string[];
  knowledgeBaseIds: string[];
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
    error: 'An agent with MCP tools or knowledge bases cannot be shared with everyone',
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
  for (const [gatewayName, id] of tarsMcpDirectEntries()) {
    servers.set(gatewayName, { id, toolIds: new Map(), taken: new Set(), direct: true });
  }
  return servers;
}

/**
 * The tools an agent binds, as pwc_tars ids. A key that resolves to nothing belongs to a
 * deleted tool or server nobody can use, and a server held only by its UI placeholder
 * token binds no tools, so neither asks anything of a share target. A whole-server
 * binding carries no tool ids: pwc_tars then requires every enabled tool.
 */
function requiredServers(tools: string[], servers: Map<string, GatewayServer>): TarsBoundServer[] {
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
    if (toolName === Constants.mcp_all || server.direct) {
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

/** The knowledge bases each target may not use in chat, keyed by `principalKey`. */
async function missingKnowledgeBases(
  knowledgeBaseIds: string[],
  principals: TarsSharePrincipal[],
): Promise<Map<string, TTarsKnowledgeBaseShareGap[]>> {
  const { missing } = await fetchTarsKnowledgeBaseShareCheck(knowledgeBaseIds, principals);
  return new Map(missing.map((miss) => [principalKey(miss), miss.knowledge_bases]));
}

async function refusalFor(
  { tools, knowledgeBaseIds }: ShareRequirements,
  principals: SharePrincipal[],
): Promise<TarsMcpShareRefusal | null> {
  const bindsTools = isTarsMcpEnabled() && tools.some(isTarsMcpToolKey);
  const usesKnowledge = knowledgeBaseIds.length > 0;
  if ((!bindsTools && !usesKnowledge) || principals.length === 0) {
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
  const [serverGaps, knowledgeGaps] = await Promise.all([
    bindsTools ? missingServers(tools, asked) : new Map<string, TTarsMcpShareGap[]>(),
    usesKnowledge
      ? missingKnowledgeBases(knowledgeBaseIds, asked)
      : new Map<string, TTarsKnowledgeBaseShareGap[]>(),
  ]);
  const blocked = targets.flatMap((target): TTarsMcpShareBlock[] => {
    const key = principalKey(target);
    const servers = serverGaps.get(key) ?? [];
    const knowledgeBases = knowledgeGaps.get(key) ?? [];
    if (servers.length === 0 && knowledgeBases.length === 0) {
      return [];
    }
    return [
      {
        principal_type: target.principal_type,
        idOnTheSource: target.principal_id,
        name: target.name,
        servers,
        ...(knowledgeBases.length > 0 ? { knowledge_bases: knowledgeBases } : {}),
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
      error: 'Some share targets lack the MCP tools or knowledge bases this agent uses',
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
  tars_knowledge_bases?: TTarsAgentKnowledgeBases | null;
}

export interface TarsAgentShareDeps {
  getAgent: (filter: { _id: string }) => Promise<SharedAgent | null>;
  findEntriesByResource: (resourceType: string, resourceId: string) => Promise<ShareAclEntry[]>;
  findUsersByIds: (ids: string[]) => Promise<ShareUser[]>;
  findGroupsByIds: (ids: string[]) => Promise<Array<ShareGroup | null>>;
  /** The share dialog's pwc_tars directory; its groups list their active members. */
  directory: Pick<TarsDirectoryCache, 'get'>;
}

/** What a save or version restore would leave the agent bound to; omitted = unchanged. */
export interface AgentBindings {
  tools?: string[];
  tars_knowledge_bases?: TTarsAgentKnowledgeBases | null;
}

export interface TarsAgentShare {
  /** Route guard for `PUT /api/permissions/:resourceType/:resourceId`. */
  guard: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  /**
   * The refusal for saving `next`, judged only on what it newly binds (added tools,
   * knowledge bases newly picked or newly reached by a switch turned on), so an edit
   * that leaves them alone is never stuck on an assignment or chat grant revoked after
   * the agent was shared.
   */
  refuseNewBindings: (
    agent: SharedAgent,
    next: AgentBindings,
  ) => Promise<TarsMcpShareRefusal | null>;
  /**
   * Route middleware after `guard`: once the share is saved, turns the agent's MCP
   * servers on in My Tools for each person the request added or re-roled, a group
   * meaning its members at that moment.
   */
  enableOnShare: (req: Request, res: Response, next: NextFunction) => void;
  /**
   * After a save or version restore that leaves the agent bound to `tools`: turns on,
   * for everyone it is shared with, the servers of the tools that change added.
   * Never rejects.
   */
  enableNewBindings: (agent: SharedAgent, tools?: string[]) => Promise<void>;
}

/** Whether a principal read back from the ACL is one the request named, by either id. */
function namedIn(updated: SharePrincipal[]): (principal: SharePrincipal) => boolean {
  const keys = new Set(
    updated.flatMap((principal) =>
      [principal.id, principal.idOnTheSource].flatMap((id) =>
        id ? [`${principal.type}:${id}`] : [],
      ),
    ),
  );
  return (principal) =>
    keys.has(`${principal.type}:${principal.id}`) ||
    keys.has(`${principal.type}:${principal.idOnTheSource}`);
}

function logEnableFailure(error: unknown): void {
  logger.error('[tars-mcp] Failed to turn on the MCP servers of a shared agent', error);
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
      const tools = agent?.tools ?? [];
      return {
        requirements: {
          tools,
          knowledgeBaseIds: tarsRequiredKnowledgeBaseIds(tools, agent?.tars_knowledge_bases),
        },
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
    const reached = new Set(tarsRequiredKnowledgeBaseIds(agent.tools, agent.tars_knowledge_bases));
    const knowledgeBaseIds = tarsRequiredKnowledgeBaseIds(
      next.tools ?? agent.tools,
      next.tars_knowledge_bases === undefined
        ? agent.tars_knowledge_bases
        : next.tars_knowledge_bases,
    ).filter((id) => !reached.has(id));
    const addsTools = isTarsMcpEnabled() && tools.some(isTarsMcpToolKey);
    if (!isTarsConfigured() || (!addsTools && knowledgeBaseIds.length === 0)) {
      return null;
    }
    return refusalOrUnavailable(async () => ({
      requirements: { tools, knowledgeBaseIds },
      principals: await listSharedPrincipals(agent),
    }));
  };

  /** pwc_tars account ids behind principals: users themselves, groups their active members now. */
  const accountIds = async (principals: SharePrincipal[]): Promise<string[]> => {
    const ids = new Set<string>();
    const groupIds = new Set<string>();
    for (const { type, idOnTheSource } of principals) {
      if (!idOnTheSource) {
        continue;
      }
      if (type === PrincipalType.USER) {
        ids.add(idOnTheSource);
      } else if (type === PrincipalType.GROUP) {
        groupIds.add(idOnTheSource);
      }
    }
    if (groupIds.size > 0) {
      const { groups } = await deps.directory.get();
      for (const group of groups) {
        if (groupIds.has(group.id)) {
          group.memberIds.forEach((id) => ids.add(id));
        }
      }
    }
    return [...ids];
  };

  const enableBindings = async (tools: string[], principals: SharePrincipal[]): Promise<void> => {
    if (principals.length === 0) {
      return;
    }
    const bound = requiredServers(tools, await loadGatewayServers());
    if (bound.length === 0) {
      return;
    }
    await enableTarsBoundServers(await accountIds(principals), bound);
  };

  const bindsGatewayTools = (tools: string[]): boolean =>
    isTarsMcpEnabled() && tools.some(isTarsMcpToolKey);

  const enableShared = async (resourceId: string, updated: SharePrincipal[]): Promise<void> => {
    const agent = await deps.getAgent({ _id: resourceId });
    const tools = agent?.tools ?? [];
    if (!agent || !bindsGatewayTools(tools)) {
      return;
    }
    const shared = await listSharedPrincipals(agent);
    await enableBindings(tools, shared.filter(namedIn(updated)));
  };

  const enableOnShare: TarsAgentShare['enableOnShare'] = (req, res, next) => {
    const { resourceType, resourceId } = req.params;
    const { updated } = (req.body ?? {}) as { updated?: SharePrincipal[] };
    if (
      !SHARED_RESOURCES.includes(resourceType) ||
      !Array.isArray(updated) ||
      updated.length === 0 ||
      !isTarsMcpEnabled()
    ) {
      next();
      return;
    }
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        enableShared(resourceId, updated).catch(logEnableFailure);
      }
    });
    next();
  };

  const enableNewBindings: TarsAgentShare['enableNewBindings'] = async (agent, tools) => {
    const existing = new Set(agent.tools ?? []);
    const added = (tools ?? []).filter((tool) => !existing.has(tool));
    if (!bindsGatewayTools(added)) {
      return;
    }
    try {
      await enableBindings(added, await listSharedPrincipals(agent));
    } catch (error) {
      logEnableFailure(error);
    }
  };

  return { guard, refuseNewBindings, enableOnShare, enableNewBindings };
}
