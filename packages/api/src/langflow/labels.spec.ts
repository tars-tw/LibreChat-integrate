import {
  flowAgentName,
  workflowProjectName,
  flowAgentDescription,
  projectAgentDescription,
  projectAgentInstructions,
} from './labels';

describe('flowAgentName', () => {
  it('prefixes the flow name with the product label', () => {
    expect(flowAgentName('TARS_CUSTOM_TOOL')).toBe('Workflow · TARS_CUSTOM_TOOL');
  });
});

describe('workflowProjectName', () => {
  it("marks a personal project, which Langflow names like the shared account's", () => {
    expect(workflowProjectName('Starter Project', 'system')).toBe('Starter Project');
    expect(workflowProjectName('Starter Project', 'personal')).toBe('我的 - Starter Project');
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

describe('projectAgentDescription', () => {
  it("prefers the project's description and falls back to its flows", () => {
    expect(projectAgentDescription('Expense claims', ['a'])).toBe('Expense claims');
    expect(projectAgentDescription('  ', ['報銷', 'Langflow report'])).toBe(
      '報銷、workflow report',
    );
  });
});

describe('projectAgentInstructions', () => {
  it("names the project and each flow's tool without the Langflow brand", () => {
    const instructions = projectAgentInstructions('Starter Project', [
      { name: 'TARS_tool', toolName: 'tars_rag' },
      { name: '高雄小導遊', toolName: '_1' },
    ]);
    expect(instructions).toContain('the "Starter Project" workflow project');
    expect(instructions).toContain('- tars_rag: TARS_tool');
    expect(instructions).toContain('- _1: 高雄小導遊');
    expect(instructions).not.toMatch(/langflow/i);
  });
});
