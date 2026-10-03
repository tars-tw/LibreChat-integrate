import { flowAgentName, flowAgentDescription, flowAgentInstructions } from './labels';

describe('flowAgentName', () => {
  it('prefixes the flow name with the product label', () => {
    expect(flowAgentName('TARS_CUSTOM_TOOL')).toBe('Workflow · TARS_CUSTOM_TOOL');
  });
});

describe('flowAgentDescription', () => {
  it("rewrites the brand in Langflow's default taglines", () => {
    expect(flowAgentDescription('Design Dialogues with Langflow.')).toBe(
      'Design Dialogues with workflow.',
    );
    expect(flowAgentDescription('Langflow: Create, Chain, Communicate.')).toBe(
      'workflow: Create, Chain, Communicate.',
    );
  });

  it('leaves other words and descriptions untouched', () => {
    expect(flowAgentDescription('Queries LangflowLike data')).toBe('Queries LangflowLike data');
    expect(flowAgentDescription('')).toBe('');
  });
});

describe('flowAgentInstructions', () => {
  it('names the flow and its tool without the Langflow brand', () => {
    const instructions = flowAgentInstructions('TARS_tool', 'tars_rag');
    expect(instructions).toContain('the "TARS_tool" workflow');
    expect(instructions).toContain('call the tars_rag tool');
    expect(instructions).not.toMatch(/langflow/i);
  });
});
