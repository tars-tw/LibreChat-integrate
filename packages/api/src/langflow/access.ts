import { logger } from '@librechat/data-schemas';
import { Constants } from 'librechat-data-provider';
import { workflowProjectOwner } from './config';

/**
 * A personal Workflow project (`workflow_<project>`) belongs to its owner, and Langflow serves it
 * to anyone else only when LibreChat vouches for the call (`WORKFLOW_ACCESS_HEADER`, sent on
 * every personal project's entry by `./config`). This
 * module is where LibreChat decides: someone else may reach the project only through an agent the
 * project's owner built on it and shared with them (directly or through a group), and only the
 * flows that agent binds. That is how a Workflow author hands a flow to chosen people without
 * publishing it to everyone, and keeps editing it in their own workspace.
 *
 * Shared projects (the system account's) and anything that is not a project server pass. The
 * answer is cached briefly per user, project and tool; failures deny.
 */

const CACHE_TTL_MS = 30_000;

/** An agent that binds a tool of the project server in question. */
export interface WorkflowShareAgent {
  id: string;
  /** The LibreChat user id of whoever created the agent. */
  author: string;
  tools: string[];
}

export interface WorkflowShareUser {
  /** The LibreChat user id. */
  id: string;
  role?: string | null;
  idOnTheSource?: string | null;
}

export interface WorkflowShareAccessDeps {
  /** The agents whose tools name `serverName`. */
  findAgentsBindingServer: (serverName: string) => Promise<WorkflowShareAgent[]>;
  /** The LibreChat user id linked to a pwc_tars user, if any. */
  findUserIdByTarsId: (tarsId: string) => Promise<string | null | undefined>;
  /** The subset of `agentIds` the user may view: shared with them, a group of theirs, or public. */
  findViewableAgentIds: (user: WorkflowShareUser, agentIds: string[]) => Promise<string[]>;
}

let deps: WorkflowShareAccessDeps | undefined;
const cache = new Map<string, { expiresAt: number; allowed: Promise<boolean> }>();

/** Unset, every personal project is refused to anyone but its owner, which is the safe direction. */
export function configureWorkflowShareAccess(next: WorkflowShareAccessDeps | undefined): void {
  deps = next;
  cache.clear();
}

/** Whether `serverName` is someone's personal project rather than a shared one or not a project. */
export function isPersonalWorkflowServer(serverName: string): boolean {
  return workflowProjectOwner(serverName) != null;
}

/**
 * Whether `tools` bind `toolName` on `serverName`, or any of its flows without a `toolName`. The
 * whole-server key binds every flow; the server marker alone binds none.
 */
function bindsWorkflowTool(tools: string[], serverName: string, toolName?: string): boolean {
  const suffix = `${Constants.mcp_delimiter}${serverName}`;
  return tools.some((tool) => {
    if (!tool.endsWith(suffix)) {
      return false;
    }
    const name = tool.slice(0, -suffix.length);
    if (name === Constants.mcp_all) {
      return true;
    }
    return name !== Constants.mcp_server && (toolName == null || name === toolName);
  });
}

async function sharedByOwner(
  serverName: string,
  owner: string,
  user: WorkflowShareUser,
  toolName: string | undefined,
  access: WorkflowShareAccessDeps,
): Promise<boolean> {
  const ownerUserId = await access.findUserIdByTarsId(owner);
  if (!ownerUserId) {
    return false;
  }
  const candidates = (await access.findAgentsBindingServer(serverName)).filter(
    (agent) => agent.author === ownerUserId && bindsWorkflowTool(agent.tools, serverName, toolName),
  );
  if (candidates.length === 0) {
    return false;
  }
  const viewable = await access.findViewableAgentIds(
    user,
    candidates.map((agent) => agent.id),
  );
  return viewable.length > 0;
}

/**
 * Whether `user` (pwc_tars id `tarsId`) may reach `serverName`, and with a `toolName`, that flow.
 * Without a linked account or a configured lookup, only the owner gets in.
 */
export async function canUseWorkflowMcpServer(
  serverName: string,
  user: Partial<WorkflowShareUser> | undefined,
  tarsId: string | null,
  toolName?: string,
): Promise<boolean> {
  const owner = workflowProjectOwner(serverName);
  if (owner == null || owner === tarsId) {
    return true;
  }
  const access = deps;
  if (!access || !user?.id || !tarsId) {
    return false;
  }
  const principal: WorkflowShareUser = {
    id: user.id,
    role: user.role,
    idOnTheSource: user.idOnTheSource,
  };
  const key = `${user.id}\u0000${serverName}\u0000${toolName ?? ''}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.allowed;
  }
  const allowed = sharedByOwner(serverName, owner, principal, toolName, access).catch((error) => {
    logger.warn(
      `[langflow/access] Could not check the agent shares for "${serverName}"; refusing`,
      error,
    );
    cache.delete(key);
    return false;
  });
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, allowed });
  return allowed;
}
