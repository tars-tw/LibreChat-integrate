import { logger } from '@librechat/data-schemas';
import {
  AccessRoleIds,
  PrincipalType,
  ResourceType,
  TARS_LANGFLOW_AGENT_ID_PREFIX,
  TARS_WORKFLOW_MCP_SERVER_NAME,
} from 'librechat-data-provider';
import type { LCAvailableTools } from '~/mcp/types';
import { flowAgentDescription, flowAgentInstructions, flowAgentName } from './labels';
import { findModelEndpoint } from './models';

const SERVER_NAME = TARS_WORKFLOW_MCP_SERVER_NAME;
const MCP_DELIMITER = '_mcp_';
const TOOL_KEY_SUFFIX = `${MCP_DELIMITER}${SERVER_NAME}`;
/**
 * Every agent mirrored from a Langflow flow; the client marks them with the Workflow icon. Kept
 * apart from {@link SERVER_NAME}: existing conversations reference these ids.
 */
const AGENT_ID_PREFIX = TARS_LANGFLOW_AGENT_ID_PREFIX;
/** Personal agents carry their user's id after this, so one user's never collide with another's. */
const PERSONAL_SEGMENT = 'p_';
const DEFAULT_DEBOUNCE_MS = 8000;

/** One tool Langflow publishes to the chatting user (`GET /api/v1/tars/flows`). */
export interface WorkflowFlow {
  toolName: string;
  flowId: string;
  name: string;
  description: string;
  /** `system`: the shared account's flow, everyone's; `personal`: the chatting user's own. */
  owner: 'system' | 'personal';
  /** The model the flow's TARS node names, or null when it leaves the choice to pwc_tars. */
  tarsModel: string | null;
  /** The key shared agents were named by before this list existed (sanitized `action_name`). */
  actionName: string;
}

/** The agent fields this sync reads and writes. */
export interface WorkflowAgent {
  _id: { toString(): string };
  id: string;
  name?: string;
  description?: string;
  instructions?: string;
  tools?: string[];
  mcpServerNames?: string[];
  provider?: string;
  model?: string;
}

interface Orchestration {
  provider: string;
  model: string;
}

type AgentFields = Partial<Omit<WorkflowAgent, '_id'>>;

export interface WorkflowAgentSyncDeps {
  /** The chatting user's tools; null while Langflow is not configured. Throws when unreachable. */
  fetchFlows: (tarsId: string | undefined) => Promise<WorkflowFlow[] | null>;
  /** The author of the shared agents (`LANGFLOW_AGENT_OWNER_EMAIL`, else the first admin). */
  findSharedOwner: () => Promise<{ _id: { toString(): string } } | null>;
  getAgents: (filter: { author?: string; id: RegExp }) => Promise<WorkflowAgent[]>;
  createAgent: (
    data: AgentFields & { id: string; author: string; category: string },
  ) => Promise<WorkflowAgent>;
  updateAgent: (filter: { _id: WorkflowAgent['_id'] }, changes: AgentFields) => Promise<unknown>;
  deleteAgent: (filter: { _id: WorkflowAgent['_id'] }) => Promise<unknown>;
  grantPermission: (grant: {
    principalType: PrincipalType;
    principalId: string | null;
    resourceType: ResourceType;
    resourceId: WorkflowAgent['_id'];
    accessRoleId: AccessRoleIds;
    grantedBy: string;
  }) => Promise<unknown>;
  /** The orchestration provider/model for a flow whose TARS node names none. */
  defaultOrchestration: Orchestration;
  /**
   * The user's cached catalogue of an MCP server, and dropping it. Langflow names a tool after its
   * flow and never announces `tools/list_changed`, so a renamed flow leaves the old name cached:
   * the agent builder offers it and Langflow refuses the call. Both or neither.
   */
  getCachedTools?: (userId: string, serverName: string) => Promise<LCAvailableTools | null>;
  invalidateCachedTools?: (userId: string, serverName: string) => Promise<unknown>;
  debounceMs?: number;
}

/** The user an agent-list request runs for. */
export interface WorkflowSyncUser {
  id: string;
  tarsId?: string | null;
}

const toAgentIdPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '');

const personalPrefix = (userId: string) => `${AGENT_ID_PREFIX}${PERSONAL_SEGMENT}${userId}_`;

/** Every personal Workflow agent of a LibreChat user. */
export const personalWorkflowAgentPattern = (userId: string): RegExp =>
  new RegExp(`^${personalPrefix(userId)}`);

/**
 * Removes a user's personal Workflow agents, for when their flows have left them (handed to the
 * system account) and they may never sign in again to have the sync tidy up.
 */
export async function removePersonalWorkflowAgents(
  deps: Pick<WorkflowAgentSyncDeps, 'getAgents' | 'deleteAgent'>,
  userId: string,
): Promise<number> {
  const agents = await deps.getAgents({ id: personalWorkflowAgentPattern(userId) });
  for (const agent of agents) {
    await deps.deleteAgent({ _id: agent._id });
  }
  return agents.length;
}

/** Shared agents only: the personal ones (`agent_langflow_p_<user id>_…`) are each user's own. */
const SHARED_AGENT_ID = new RegExp(`^${AGENT_ID_PREFIX}(?!${PERSONAL_SEGMENT}[0-9a-f]{24}_)`);

/** The fields a flow owns. `provider`/`model` join only when its TARS node names a model, so an
 *  admin's own choice sticks otherwise. */
function flowOwnedFields(flow: WorkflowFlow, orchestration: Orchestration | null): AgentFields {
  return {
    ...(orchestration ?? {}),
    name: flowAgentName(flow.name),
    description: flowAgentDescription(flow.description),
    instructions: flowAgentInstructions(flow.name, flow.toolName),
    tools: [`${flow.toolName}${MCP_DELIMITER}${SERVER_NAME}`],
    mcpServerNames: [SERVER_NAME],
  };
}

function sameValue(current: unknown, wanted: unknown): boolean {
  if (!Array.isArray(wanted)) {
    return current === wanted;
  }
  return (
    Array.isArray(current) &&
    current.length === wanted.length &&
    wanted.every((entry, i) => current[i] === entry)
  );
}

/** Flow-owned fields whose stored value has drifted, or null when the agent is already in sync. */
function driftedFields(agent: WorkflowAgent, desired: AgentFields): AgentFields | null {
  const drifted = (Object.keys(desired) as (keyof AgentFields)[]).filter(
    (key) => !sameValue(agent[key], desired[key]),
  );
  if (drifted.length === 0) {
    return null;
  }
  return Object.fromEntries(drifted.map((key) => [key, desired[key]])) as AgentFields;
}

/** The upstream tool names in a cached Workflow catalogue. */
function cachedToolNames(tools: LCAvailableTools): Set<string> {
  return new Set(
    Object.entries(tools).map(
      ([key, entry]) =>
        entry.serverToolName ??
        (key.endsWith(TOOL_KEY_SUFFIX) ? key.slice(0, -TOOL_KEY_SUFFIX.length) : key),
    ),
  );
}

function sameNames(cached: Set<string>, flows: WorkflowFlow[]): boolean {
  return cached.size === flows.length && flows.every((flow) => cached.has(flow.toolName));
}

const isDuplicateKeyError = (error: unknown) =>
  (error as { code?: number })?.code === 11000 || /E11000/.test(String((error as Error)?.message));

/**
 * Shared agents keep the id they have always had (`agent_langflow_<action name>`) so existing
 * conversations still find them; a second flow claiming the same key falls back to its tool name.
 */
function sharedAgentIds(flows: WorkflowFlow[]): Map<string, WorkflowFlow> {
  const desired = new Map<string, WorkflowFlow>();
  for (const flow of flows) {
    const legacy = `${AGENT_ID_PREFIX}${toAgentIdPart(flow.actionName)}`;
    const id = desired.has(legacy) ? `${AGENT_ID_PREFIX}${toAgentIdPart(flow.toolName)}` : legacy;
    if (!desired.has(id)) {
      desired.set(id, flow);
    }
  }
  return desired;
}

/**
 * Keeps LibreChat's Workflow agents in step with what Langflow publishes, on every agent-list
 * request: the shared account's MCP-enabled flows as agents everyone can use, and the requesting
 * user's own MCP-enabled flows as agents only they can use. Creates what is missing, refreshes the
 * fields a flow owns, removes agents whose flow is gone or unpublished. Debounced (shared once per
 * window, personal once per user per window) and never throws: a failure is logged and the agent
 * list is served as it stands. An unreachable Langflow changes nothing.
 */
export function createWorkflowAgentSync(deps: WorkflowAgentSyncDeps) {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let lastShared = 0;
  const lastPersonal = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();

  const orchestrationFor = async (
    flow: WorkflowFlow,
    modelsConfig: () => Promise<Record<string, string[] | undefined>>,
  ): Promise<Orchestration | null> => {
    if (!flow.tarsModel) {
      return null;
    }
    const provider = findModelEndpoint(flow.tarsModel, await modelsConfig());
    if (!provider) {
      logger.warn(
        `[langflow/sync] Flow model "${flow.tarsModel}" is not served by any configured endpoint; ` +
          "leaving the agent's own model in place.",
      );
      return null;
    }
    return { provider, model: flow.tarsModel };
  };

  const converge = async ({
    desired,
    existing,
    author,
    grant,
    modelsConfig,
  }: {
    desired: Map<string, WorkflowFlow>;
    existing: WorkflowAgent[];
    author: string;
    grant: (agent: WorkflowAgent) => Promise<unknown>;
    modelsConfig: () => Promise<Record<string, string[] | undefined>>;
  }) => {
    const current = new Map<string, WorkflowAgent>();
    const stale: WorkflowAgent[] = [];
    for (const agent of existing) {
      if (!desired.has(agent.id) || current.has(agent.id)) {
        stale.push(agent);
        continue;
      }
      current.set(agent.id, agent);
    }

    for (const [id, flow] of desired) {
      const orchestration = await orchestrationFor(flow, modelsConfig);
      const agent = current.get(id);
      if (!agent) {
        try {
          const created = await deps.createAgent({
            ...deps.defaultOrchestration,
            ...flowOwnedFields(flow, orchestration),
            id,
            author,
            category: 'general',
          });
          await grant(created);
          logger.info(`[langflow/sync] Published agent ${id} for flow "${flow.name}"`);
        } catch (error) {
          if (!isDuplicateKeyError(error)) {
            logger.error(`[langflow/sync] Failed to create agent for "${flow.name}":`, error);
          }
        }
        continue;
      }
      const changes = driftedFields(agent, flowOwnedFields(flow, orchestration));
      if (changes) {
        await deps.updateAgent({ _id: agent._id }, changes);
        logger.info(`[langflow/sync] Synced agent ${id} (${Object.keys(changes).join(', ')})`);
      }
    }

    for (const agent of stale) {
      await deps.deleteAgent({ _id: agent._id });
      logger.info(`[langflow/sync] Removed agent ${agent.id}`);
    }
  };

  /** Drops the user's cached Workflow catalogue when it no longer names what Langflow publishes,
   *  so the next listing re-reads `tools/list`. Never throws. */
  const refreshStaleCatalog = async (userId: string, flows: WorkflowFlow[]) => {
    const { getCachedTools, invalidateCachedTools } = deps;
    if (!getCachedTools || !invalidateCachedTools) {
      return;
    }
    try {
      const cached = await getCachedTools(userId, SERVER_NAME);
      if (!cached || sameNames(cachedToolNames(cached), flows)) {
        return;
      }
      await invalidateCachedTools(userId, SERVER_NAME);
      logger.info("[langflow/sync] Langflow's tools changed; dropped the cached catalogue");
    } catch (error) {
      logger.warn(
        `[langflow/sync] Could not check the cached Langflow catalogue: ${(error as Error).message}`,
      );
    }
  };

  const syncShared = async (
    flows: WorkflowFlow[],
    modelsConfig: () => Promise<Record<string, string[] | undefined>>,
  ) => {
    if (flows.length === 0) {
      return;
    }
    const owner = await deps.findSharedOwner();
    if (!owner) {
      logger.warn('[langflow/sync] No owner user found; cannot own shared Workflow agents.');
      return;
    }
    const ownerId = owner._id.toString();
    await converge({
      desired: sharedAgentIds(flows),
      existing: await deps.getAgents({ author: ownerId, id: SHARED_AGENT_ID }),
      author: ownerId,
      grant: (agent) =>
        deps.grantPermission({
          principalType: PrincipalType.PUBLIC,
          principalId: null,
          resourceType: ResourceType.AGENT,
          resourceId: agent._id,
          accessRoleId: AccessRoleIds.AGENT_VIEWER,
          grantedBy: ownerId,
        }),
      modelsConfig,
    });
  };

  const syncPersonal = async (
    user: WorkflowSyncUser,
    flows: WorkflowFlow[],
    modelsConfig: () => Promise<Record<string, string[] | undefined>>,
  ) => {
    const prefix = personalPrefix(user.id);
    await converge({
      desired: new Map(flows.map((flow) => [`${prefix}${toAgentIdPart(flow.toolName)}`, flow])),
      existing: await deps.getAgents({ id: personalWorkflowAgentPattern(user.id) }),
      author: user.id,
      grant: (agent) =>
        deps.grantPermission({
          principalType: PrincipalType.USER,
          principalId: user.id,
          resourceType: ResourceType.AGENT,
          resourceId: agent._id,
          accessRoleId: AccessRoleIds.AGENT_VIEWER,
          grantedBy: user.id,
        }),
      modelsConfig,
    });
  };

  const run = async (
    user: WorkflowSyncUser,
    modelsConfig: () => Promise<Record<string, string[] | undefined>>,
  ) => {
    const now = Date.now();
    const dueShared = now - lastShared >= debounceMs;
    const duePersonal = !!user.tarsId && now - (lastPersonal.get(user.id) ?? 0) >= debounceMs;
    if (!dueShared && !duePersonal) {
      return;
    }
    if (dueShared) {
      lastShared = now;
    }
    if (duePersonal) {
      lastPersonal.set(user.id, now);
    }

    let flows: WorkflowFlow[] | null;
    try {
      flows = await deps.fetchFlows(user.tarsId ?? undefined);
    } catch (error) {
      logger.warn(
        `[langflow/sync] Langflow unreachable; agents left as they are: ${(error as Error).message}`,
      );
      return;
    }
    if (flows == null) {
      return;
    }
    await refreshStaleCatalog(user.id, flows);

    let catalogue: Promise<Record<string, string[] | undefined>> | null = null;
    const cachedModels = () => {
      catalogue = catalogue ?? modelsConfig().catch(() => ({}));
      return catalogue;
    };

    if (dueShared) {
      await syncShared(
        flows.filter((flow) => flow.owner === 'system'),
        cachedModels,
      );
    }
    if (duePersonal) {
      await syncPersonal(
        user,
        flows.filter((flow) => flow.owner === 'personal'),
        cachedModels,
      );
    }
  };

  /**
   * @param user The user whose agent list is being served.
   * @param modelsConfig Loads this instance's model catalogue, consulted only when a flow names a
   *   model; it answers "which endpoint serves this model", which does not vary by user.
   */
  return async function syncWorkflowAgents(
    user: WorkflowSyncUser,
    modelsConfig: () => Promise<Record<string, string[] | undefined>>,
  ): Promise<void> {
    const key = user.id;
    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }
    const pass = run(user, modelsConfig)
      .catch((error: unknown) => {
        logger.error('[langflow/sync] Workflow agent sync failed:', error);
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pass);
    return pass;
  };
}
