/** Product-facing name for a flow; the users of the shared agents never see the Langflow brand. */
const PRODUCT_LABEL = 'workflow';

const AGENT_NAME_PREFIX = 'Workflow · ';

const BRAND_PATTERN = /\blangflow\b/gi;

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

/** System prompt of the shared agent: a pass-through to the flow's MCP tool. */
export function flowAgentInstructions(flowName: string, actionName: string): string {
  return (
    `You are a thin wrapper around the "${flowName}" ${PRODUCT_LABEL}. ` +
    `For every user message, call the ${actionName} tool with the user's input ` +
    `and return its result verbatim. Do not answer from your own knowledge.`
  );
}
