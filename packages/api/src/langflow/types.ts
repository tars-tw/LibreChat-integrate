/**
 * The shapes the Workflow agent sync and the aggregate-server migration share, kept apart from
 * both so neither module imports the other's types.
 */

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
  /** The Langflow project the flow is in. Absent from a Langflow that predates per-project servers. */
  projectId?: string;
  projectName?: string;
  projectDescription?: string;
  /** The tool's name on its project's own MCP server. */
  projectToolName?: string;
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
