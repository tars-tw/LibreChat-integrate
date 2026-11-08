/** Product-facing name for a flow; the users of the shared agents never see the Langflow brand. */
const PRODUCT_LABEL = 'workflow';

const AGENT_NAME_PREFIX = 'Workflow · ';

/** Uses `-` rather than `·`: the name is also an MCP server title, which allows no other punctuation. */
const PERSONAL_PROJECT_PREFIX = '我的 - ';

const BRAND_PATTERN = /\blangflow\b/gi;

/**
 * A project's display name, as its MCP server and agent are titled. A personal project is marked:
 * Langflow names every user's default project like the shared account's ("Starter Project").
 */
export function workflowProjectName(name: string, owner: 'system' | 'personal'): string {
  return owner === 'personal' ? `${PERSONAL_PROJECT_PREFIX}${name}` : name;
}

/** Display name of the shared agent a flow is mirrored into. */
export function flowAgentName(flowName: string): string {
  return `${AGENT_NAME_PREFIX}${flowName}`;
}

/**
 * Description of the shared agent a flow is mirrored into. Langflow seeds every new flow with a
 * random tagline that names itself ("Design Dialogues with Langflow."), so the brand is rewritten
 * rather than copied through verbatim.
 */
export function flowAgentDescription(description: string): string {
  return description.replace(BRAND_PATTERN, PRODUCT_LABEL);
}

/** Description of the agent a project is mirrored into: the project's own, else its flows' names. */
export function projectAgentDescription(description: string, flowNames: string[]): string {
  return flowAgentDescription(description.trim() || flowNames.join('、'));
}

/**
 * System prompt of the agent a project is mirrored into: a router that hands each message to the
 * one of the project's flows it fits, and passes the result through.
 */
export function projectAgentInstructions(
  projectName: string,
  flows: { name: string; toolName: string }[],
): string {
  const tools = flows.map((flow) => `- ${flow.toolName}: ${flow.name}`).join('\n');
  return (
    `You are a thin wrapper around the "${projectName}" ${PRODUCT_LABEL} project. ` +
    `Each of its ${PRODUCT_LABEL}s is one of your tools:\n${tools}\n` +
    `For every user message, call the tool whose ${PRODUCT_LABEL} fits the request with the user's input ` +
    `and return its result verbatim. If none fits, say which ${PRODUCT_LABEL}s you offer. ` +
    `Do not answer from your own knowledge.`
  );
}
