import { logger } from '@librechat/data-schemas';
import {
  Constants,
  workflowMcpServerName,
  TARS_LANGFLOW_AGENT_ID_PREFIX,
  TARS_WORKFLOW_MCP_SERVER_NAME,
} from 'librechat-data-provider';
import type { WorkflowAgent, WorkflowFlow } from './types';

/** The `mcpServers` key the flows were published under before it became product-facing. */
const LEGACY_SERVER_NAME = 'langflow';
const LEGACY_SUFFIX = `${Constants.mcp_delimiter}${LEGACY_SERVER_NAME}`;
const CURRENT_SUFFIX = `${Constants.mcp_delimiter}${TARS_WORKFLOW_MCP_SERVER_NAME}`;
const LEGACY_TOOL = new RegExp(`${LEGACY_SUFFIX}$`);

export interface LegacyWorkflowServerDeps {
  findAgents: (filter: { tools: RegExp }) => Promise<WorkflowAgent[]>;
  updateAgent: (
    filter: { _id: WorkflowAgent['_id'] },
    changes: Pick<WorkflowAgent, 'tools' | 'mcpServerNames'>,
  ) => Promise<unknown>;
}

const renameTool = (tool: string) =>
  tool.endsWith(LEGACY_SUFFIX) ? `${tool.slice(0, -LEGACY_SUFFIX.length)}${CURRENT_SUFFIX}` : tool;

const renameServer = (name: string) =>
  name === LEGACY_SERVER_NAME ? TARS_WORKFLOW_MCP_SERVER_NAME : name;

/**
 * Moves agents that picked Workflow tools under the old `langflow` server key onto `workflow`.
 * Without it those tools name a server that no longer exists and drop out of the agent silently.
 * The mirrored Workflow agents converge on their own through the sync; this covers the ones
 * users built. Idempotent, so it runs on every boot. Returns how many agents it rewrote.
 */
export async function renameLegacyWorkflowServer(deps: LegacyWorkflowServerDeps): Promise<number> {
  const agents = await deps.findAgents({ tools: LEGACY_TOOL });
  for (const agent of agents) {
    await deps.updateAgent(
      { _id: agent._id },
      {
        tools: [...new Set((agent.tools ?? []).map(renameTool))],
        mcpServerNames: [...new Set((agent.mcpServerNames ?? []).map(renameServer))],
      },
    );
    logger.info(`[langflow/legacy] Moved agent ${agent.id} onto the Workflow server key`);
  }
  return agents.length;
}

const AGGREGATE_TOOL = new RegExp(`${CURRENT_SUFFIX}$`);

export interface AggregateWorkflowToolsDeps {
  findAgents: (filter: { tools: RegExp; author?: string }) => Promise<WorkflowAgent[]>;
  updateAgent: LegacyWorkflowServerDeps['updateAgent'];
}

/** `<aggregate tool>_mcp_workflow` → `<project tool>_mcp_workflow_<project>`, for every flow known. */
function projectToolKeys(flows: WorkflowFlow[]): Map<string, string> {
  return new Map(
    flows.flatMap((flow) =>
      flow.projectId && flow.projectToolName
        ? [
            [
              `${flow.toolName}${CURRENT_SUFFIX}`,
              `${flow.projectToolName}${Constants.mcp_delimiter}${workflowMcpServerName(flow.projectId)}`,
            ],
          ]
        : [],
    ),
  );
}

const serverOf = (tool: string) =>
  tool.slice(tool.lastIndexOf(Constants.mcp_delimiter) + Constants.mcp_delimiter.length);

/** The token that pins a server to an agent whatever its tool selection (`sys__server__sys_mcp_<server>`). */
const serverPin = (server: string) => `${Constants.mcp_server}${Constants.mcp_delimiter}${server}`;
const AGGREGATE_PIN = serverPin(TARS_WORKFLOW_MCP_SERVER_NAME);

/** The agent's tools on the project servers, its aggregate pin moved onto the servers they use. */
function migratedTools(current: string[], keys: Map<string, string>): string[] {
  const mapped = current.map((tool) => keys.get(tool) ?? tool);
  if (!mapped.includes(AGGREGATE_PIN)) {
    return [...new Set(mapped)];
  }
  const pins = [...new Set(mapped.filter((tool) => !current.includes(tool)).map(serverOf))].map(
    serverPin,
  );
  return [...new Set(mapped.flatMap((tool) => (tool === AGGREGATE_PIN ? pins : [tool])))];
}

/**
 * Moves agents users built on the aggregate `workflow` server onto the per-project servers that
 * replaced it, for the flows given: every author's agents for the shared flows (`author` unset),
 * one user's own for their personal flows (`my_…`, which only they were offered). A tool whose
 * flow is not among them is left as it is, and `workflow` stays in the agent's servers while any
 * such tool does. A pin on the aggregate server becomes a pin on each project server the agent's
 * tools moved to. The mirrored Workflow agents are skipped: the sync replaces them outright.
 * Returns how many agents it rewrote.
 */
export async function migrateAggregateWorkflowTools(
  deps: AggregateWorkflowToolsDeps,
  flows: WorkflowFlow[],
  author?: string,
): Promise<number> {
  const keys = projectToolKeys(flows);
  if (keys.size === 0) {
    return 0;
  }
  const agents = await deps.findAgents({ tools: AGGREGATE_TOOL, ...(author && { author }) });
  let moved = 0;
  for (const agent of agents) {
    if (agent.id.startsWith(TARS_LANGFLOW_AGENT_ID_PREFIX)) {
      continue;
    }
    const current = agent.tools ?? [];
    if (!current.some((tool) => keys.has(tool))) {
      continue;
    }
    const tools = migratedTools(current, keys);
    const keepsAggregate = tools.some((tool) => AGGREGATE_TOOL.test(tool));
    const servers = (agent.mcpServerNames ?? []).filter(
      (name) => name !== TARS_WORKFLOW_MCP_SERVER_NAME || keepsAggregate,
    );
    const added = tools.filter((tool) => !current.includes(tool)).map(serverOf);
    await deps.updateAgent(
      { _id: agent._id },
      { tools, mcpServerNames: [...new Set([...servers, ...added])] },
    );
    moved += 1;
    logger.info(`[langflow/legacy] Moved agent ${agent.id} onto per-project Workflow servers`);
  }
  return moved;
}
