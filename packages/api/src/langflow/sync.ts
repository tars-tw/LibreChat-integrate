import { logger } from '@librechat/data-schemas';
import {
  Constants,
  AccessRoleIds,
  PrincipalType,
  ResourceType,
  workflowMcpServerName,
  TARS_LANGFLOW_AGENT_ID_PREFIX,
} from 'librechat-data-provider';
import type { WorkflowAgent, WorkflowFlow } from './types';
import type { LCAvailableTools } from '~/mcp/types';
import {
  flowAgentName,
  workflowProjectName,
  projectAgentDescription,
  projectAgentInstructions,
} from './labels';
import { migrateAggregateWorkflowTools } from './legacy';
import { findModelEndpoint } from './models';

export type { WorkflowAgent, WorkflowFlow } from './types';

const MCP_DELIMITER = Constants.mcp_delimiter;
/**
 * Every agent mirrored from a Langflow project; the client marks them with the Workflow icon.
 * A project's agent is `<prefix><its server name>`.
 */
const AGENT_ID_PREFIX = TARS_LANGFLOW_AGENT_ID_PREFIX;
/** Personal agents carry their user's id after this, so one user's never collide with another's. */
const PERSONAL_SEGMENT = 'p_';
const DEFAULT_DEBOUNCE_MS = 8000;

/** A Langflow project as its mirrored agent and MCP server see it. */
interface WorkflowProjectGroup {
  serverName: string;
  name: string;
  description: string;
  flows: (WorkflowFlow & { projectToolName: string })[];
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
  getAgents: (filter: { author?: string; id?: RegExp; tools?: RegExp }) => Promise<WorkflowAgent[]>;
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
  /**
   * Re-registers the per-project MCP servers when the ones the user is offered (`serverNames`) no
   * longer match the registered set, so an agent mirrored from a new project has its server.
   */
  refreshServers?: (serverNames: string[], tarsId: string | undefined) => Promise<unknown>;
  debounceMs?: number;
}

/** The user an agent-list request runs for. */
export interface WorkflowSyncUser {
  id: string;
  tarsId?: string | null;
}

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

const hasProject = (flow: WorkflowFlow): flow is WorkflowFlow & { projectToolName: string } =>
  !!flow.projectId && !!flow.projectToolName;

/** The flows grouped by project, in the order Langflow lists them, keyed by server name. */
function groupByProject(flows: WorkflowFlow[]): Map<string, WorkflowProjectGroup> {
  const projects = new Map<string, WorkflowProjectGroup>();
  for (const flow of flows) {
    if (!hasProject(flow)) {
      continue;
    }
    const serverName = workflowMcpServerName(flow.projectId as string);
    const project = projects.get(serverName) ?? {
      serverName,
      name: workflowProjectName(flow.projectName || serverName, flow.owner),
      description: flow.projectDescription ?? '',
      flows: [],
    };
    project.flows.push(flow);
    projects.set(serverName, project);
  }
  return projects;
}

/** The fields a project owns. `provider`/`model` join only when its flows' TARS nodes agree on a
 *  model, so an admin's own choice sticks otherwise. */
function projectOwnedFields(
  project: WorkflowProjectGroup,
  orchestration: Orchestration | null,
): AgentFields {
  return {
    ...(orchestration ?? {}),
    name: flowAgentName(project.name),
    description: projectAgentDescription(
      project.description,
      project.flows.map((flow) => flow.name),
    ),
    instructions: projectAgentInstructions(
      project.name,
      project.flows.map((flow) => ({ name: flow.name, toolName: flow.projectToolName })),
    ),
    tools: project.flows.map(
      (flow) => `${flow.projectToolName}${MCP_DELIMITER}${project.serverName}`,
    ),
    mcpServerNames: [project.serverName],
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

/** The upstream tool names in a project server's cached catalogue. */
function cachedToolNames(tools: LCAvailableTools, serverName: string): Set<string> {
  const suffix = `${MCP_DELIMITER}${serverName}`;
  return new Set(
    Object.entries(tools).map(
      ([key, entry]) =>
        entry.serverToolName ?? (key.endsWith(suffix) ? key.slice(0, -suffix.length) : key),
    ),
  );
}

function sameNames(cached: Set<string>, project: WorkflowProjectGroup): boolean {
  return (
    cached.size === project.flows.length &&
    project.flows.every((flow) => cached.has(flow.projectToolName))
  );
}

const isDuplicateKeyError = (error: unknown) =>
  (error as { code?: number })?.code === 11000 || /E11000/.test(String((error as Error)?.message));

const agentIds = (prefix: string, projects: Map<string, WorkflowProjectGroup>) =>
  new Map([...projects.values()].map((project) => [`${prefix}${project.serverName}`, project]));

/**
 * Keeps LibreChat's Workflow agents in step with what Langflow publishes, on every agent-list
 * request: one agent per project, with the project's MCP-enabled flows as its tools — the shared
 * account's projects as agents everyone can use, the requesting user's own as agents only they can
 * use. Creates what is missing, refreshes the fields a project owns, removes agents whose project
 * has nothing published any more (and the per-flow agents this replaced). Agents users built on the
 * deprecated aggregate server are moved onto the project servers on the way. Debounced (shared once
 * per window, personal once per user per window) and never throws: a failure is logged and the
 * agent list is served as it stands. An unreachable Langflow, or one that predates per-project
 * servers, changes nothing.
 */
export function createWorkflowAgentSync(deps: WorkflowAgentSyncDeps) {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let lastShared = 0;
  const lastPersonal = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();

  const orchestrationFor = async (
    project: WorkflowProjectGroup,
    modelsConfig: () => Promise<Record<string, string[] | undefined>>,
  ): Promise<Orchestration | null> => {
    const models = new Set(project.flows.map((flow) => flow.tarsModel).filter(Boolean));
    if (models.size !== 1) {
      return null;
    }
    const [model] = models as Set<string>;
    const provider = findModelEndpoint(model, await modelsConfig());
    if (!provider) {
      logger.warn(
        `[langflow/sync] Flow model "${model}" is not served by any configured endpoint; ` +
          "leaving the agent's own model in place.",
      );
      return null;
    }
    return { provider, model };
  };

  const converge = async ({
    desired,
    existing,
    author,
    grant,
    modelsConfig,
  }: {
    desired: Map<string, WorkflowProjectGroup>;
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

    for (const [id, project] of desired) {
      const orchestration = await orchestrationFor(project, modelsConfig);
      const agent = current.get(id);
      if (!agent) {
        try {
          const created = await deps.createAgent({
            ...deps.defaultOrchestration,
            ...projectOwnedFields(project, orchestration),
            id,
            author,
            category: 'general',
          });
          await grant(created);
          logger.info(`[langflow/sync] Published agent ${id} for project "${project.name}"`);
        } catch (error) {
          if (!isDuplicateKeyError(error)) {
            logger.error(`[langflow/sync] Failed to create agent for "${project.name}":`, error);
          }
        }
        continue;
      }
      const changes = driftedFields(agent, projectOwnedFields(project, orchestration));
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

  /** Drops the user's cached catalogue of each project server that no longer names what Langflow
   *  publishes there, so the next listing re-reads `tools/list`. Never throws. */
  const refreshStaleCatalogs = async (
    userId: string,
    projects: Map<string, WorkflowProjectGroup>,
  ) => {
    const { getCachedTools, invalidateCachedTools } = deps;
    if (!getCachedTools || !invalidateCachedTools) {
      return;
    }
    for (const project of projects.values()) {
      try {
        const cached = await getCachedTools(userId, project.serverName);
        if (!cached || sameNames(cachedToolNames(cached, project.serverName), project)) {
          continue;
        }
        await invalidateCachedTools(userId, project.serverName);
        logger.info(
          `[langflow/sync] Project "${project.name}" changed its tools; dropped the cached catalogue`,
        );
      } catch (error) {
        logger.warn(
          `[langflow/sync] Could not check the cached catalogue of "${project.name}": ${(error as Error).message}`,
        );
      }
    }
  };

  /** Moves agents built on the aggregate server onto the project servers. Never throws. */
  const migrateAggregateTools = async (flows: WorkflowFlow[], author?: string) => {
    try {
      await migrateAggregateWorkflowTools(
        { findAgents: deps.getAgents, updateAgent: deps.updateAgent },
        flows,
        author,
      );
    } catch (error) {
      logger.warn(
        `[langflow/sync] Could not move agents off the aggregate Workflow server: ${(error as Error).message}`,
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
    await migrateAggregateTools(flows);
    const owner = await deps.findSharedOwner();
    if (!owner) {
      logger.warn('[langflow/sync] No owner user found; cannot own shared Workflow agents.');
      return;
    }
    const ownerId = owner._id.toString();
    await converge({
      desired: agentIds(AGENT_ID_PREFIX, groupByProject(flows)),
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
    await migrateAggregateTools(flows, user.id);
    await converge({
      desired: agentIds(personalPrefix(user.id), groupByProject(flows)),
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
    if (!flows.every(hasProject)) {
      logger.warn(
        '[langflow/sync] Langflow predates per-project Workflow servers; agents left as they are',
      );
      return;
    }
    const projects = groupByProject(flows);
    try {
      await deps.refreshServers?.([...projects.keys()], user.tarsId ?? undefined);
    } catch (error) {
      logger.warn(
        `[langflow/sync] Could not re-register the Workflow servers: ${(error as Error).message}`,
      );
    }
    await refreshStaleCatalogs(user.id, projects);

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
