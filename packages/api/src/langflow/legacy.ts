import { logger } from '@librechat/data-schemas';
import { Constants, TARS_WORKFLOW_MCP_SERVER_NAME } from 'librechat-data-provider';
import type { WorkflowAgent } from './sync';

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
