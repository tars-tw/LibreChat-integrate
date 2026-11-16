import { logger } from '@librechat/data-schemas';
import { Constants } from 'librechat-data-provider';
import type { WorkflowAgent } from './types';

const MCP_DELIMITER = Constants.mcp_delimiter;

/** The tool names a project server last listed, by flow id. */
export type WorkflowToolNames = Record<string, string>;

/** One project server's published flows, as the rename check reads them. */
export interface WorkflowServerFlows {
  serverName: string;
  flows: { flowId: string; projectToolName: string }[];
}

type RenamedFields = Pick<WorkflowAgent, 'tools' | 'tool_options'>;

export interface WorkflowToolRenameDeps {
  /** The listing remembered for a project server; nullish when it was never listed. */
  getToolNames: (serverName: string) => Promise<WorkflowToolNames | null | undefined>;
  setToolNames: (serverName: string, names: WorkflowToolNames) => Promise<unknown>;
  /** Every agent, of any author, whose `tools` holds a key the pattern matches. */
  getAgents: (filter: { tools: RegExp }) => Promise<WorkflowAgent[]>;
  /** Writes without a new version: the user did not change the agent, Langflow renamed a tool. */
  updateAgent: (filter: { _id: WorkflowAgent['_id'] }, changes: RenamedFields) => Promise<unknown>;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Old → new tool name of every flow listed under another name than last time. */
function renamedTools(previous: WorkflowToolNames, current: WorkflowToolNames) {
  const renames = new Map<string, string>();
  for (const [flowId, name] of Object.entries(current)) {
    const old = previous[flowId];
    if (old != null && old !== name) {
      renames.set(old, name);
    }
  }
  return renames;
}

function sameListing(previous: WorkflowToolNames, current: WorkflowToolNames): boolean {
  const flowIds = Object.keys(current);
  return (
    Object.keys(previous).length === flowIds.length &&
    flowIds.every((flowId) => previous[flowId] === current[flowId])
  );
}

/** Applies every rename at once, so two flows that traded names swap rather than collide; a
 *  moved option wins over a stale one already under its new key. */
function renameAgentTools(agent: WorkflowAgent, keys: Map<string, string>): RenamedFields {
  const tools = [...new Set((agent.tools ?? []).map((tool) => keys.get(tool) ?? tool))];
  if (!agent.tool_options) {
    return { tools };
  }
  const entries = Object.entries(agent.tool_options);
  const kept = entries.filter(([key]) => !keys.has(key));
  const moved = entries.flatMap(([key, options]) => {
    const target = keys.get(key);
    return target ? [[target, options] as const] : [];
  });
  return { tools, tool_options: Object.fromEntries([...kept, ...moved]) };
}

async function rewriteAgents(
  deps: WorkflowToolRenameDeps,
  serverName: string,
  renames: Map<string, string>,
) {
  const suffix = `${MCP_DELIMITER}${serverName}`;
  const keys = new Map([...renames].map(([from, to]) => [`${from}${suffix}`, `${to}${suffix}`]));
  const pattern = new RegExp(`^(?:${[...keys.keys()].map(escapeRegExp).join('|')})$`);
  const agents = await deps.getAgents({ tools: pattern });
  for (const agent of agents) {
    await deps.updateAgent({ _id: agent._id }, renameAgentTools(agent, keys));
  }
  const renamed = [...renames].map(([from, to]) => `${from} → ${to}`).join(', ');
  logger.info(
    `[langflow/renames] ${serverName}: ${renamed}; rewrote ${agents.length} agent(s) bound to the old names`,
  );
}

/**
 * Keeps agents bound to a Workflow flow through a rename. Langflow names a flow's tool after the
 * flow (ASCII only), so renaming the flow renames the tool, and every agent that picked it would
 * lose it. Each project server's last listing is remembered by flow id; a flow listed under a new
 * name has its old key replaced in every agent's `tools` and `tool_options`. A server's first
 * listing is only remembered. A flow that leaves the listing is forgotten, so its name can pass to
 * another flow without carrying the old bindings along. Never throws: a server whose agents could
 * not be rewritten keeps its old listing, so the next pass tries again.
 */
export async function followWorkflowToolRenames(
  deps: WorkflowToolRenameDeps,
  servers: Iterable<WorkflowServerFlows>,
): Promise<void> {
  for (const { serverName, flows } of servers) {
    try {
      const current: WorkflowToolNames = Object.fromEntries(
        flows.map((flow) => [flow.flowId, flow.projectToolName]),
      );
      const previous = await deps.getToolNames(serverName);
      if (previous) {
        const renames = renamedTools(previous, current);
        if (renames.size > 0) {
          await rewriteAgents(deps, serverName, renames);
        }
        if (sameListing(previous, current)) {
          continue;
        }
      }
      await deps.setToolNames(serverName, current);
    } catch (error) {
      logger.warn(
        `[langflow/renames] Could not follow the renamed tools of ${serverName}: ${(error as Error).message}`,
      );
    }
  }
}
