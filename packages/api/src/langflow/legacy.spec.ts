import type { WorkflowAgent, WorkflowFlow } from './sync';
import type { LegacyWorkflowServerDeps } from './legacy';
import { migrateAggregateWorkflowTools, renameLegacyWorkflowServer } from './legacy';

const agent = (id: string, tools: string[], mcpServerNames: string[]): WorkflowAgent => ({
  _id: { toString: () => `oid-${id}` },
  id,
  tools,
  mcpServerNames,
});

/** An in-memory agent store that applies the same `tools` regex Mongo would. */
function store(agents: WorkflowAgent[]) {
  const updateAgent = jest.fn<
    ReturnType<LegacyWorkflowServerDeps['updateAgent']>,
    Parameters<LegacyWorkflowServerDeps['updateAgent']>
  >(async (filter, changes) => {
    const target = agents.find((entry) => entry._id === filter._id);
    Object.assign(target ?? {}, changes);
  });
  const deps: LegacyWorkflowServerDeps = {
    findAgents: async ({ tools }) =>
      agents.filter((entry) => (entry.tools ?? []).some((tool) => tools.test(tool))),
    updateAgent,
  };
  return { deps, updateAgent };
}

describe('renameLegacyWorkflowServer', () => {
  it('moves langflow tools and the server name onto workflow, leaving other tools alone', async () => {
    const built = agent(
      'agent_mine',
      ['web_search', 'report_mcp_langflow', 'sys__all__sys_mcp_langflow', 'issue_mcp_tars_redmine'],
      ['langflow', 'tars_redmine'],
    );
    const { deps } = store([built]);

    await expect(renameLegacyWorkflowServer(deps)).resolves.toBe(1);

    expect(built.tools).toEqual([
      'web_search',
      'report_mcp_workflow',
      'sys__all__sys_mcp_workflow',
      'issue_mcp_tars_redmine',
    ]);
    expect(built.mcpServerNames).toEqual(['workflow', 'tars_redmine']);
  });

  it('collapses an agent that already lists the same tool under both names', async () => {
    const both = agent(
      'agent_both',
      ['report_mcp_langflow', 'report_mcp_workflow'],
      ['langflow', 'workflow'],
    );
    const { deps } = store([both]);

    await renameLegacyWorkflowServer(deps);

    expect(both.tools).toEqual(['report_mcp_workflow']);
    expect(both.mcpServerNames).toEqual(['workflow']);
  });

  it('is a no-op on a second run and for agents that never used the old key', async () => {
    const built = agent('agent_mine', ['report_mcp_langflow'], ['langflow']);
    const untouched = agent('agent_other', ['langflow_report_mcp_tars_x'], ['tars_x']);
    const { deps, updateAgent } = store([built, untouched]);

    await renameLegacyWorkflowServer(deps);
    await expect(renameLegacyWorkflowServer(deps)).resolves.toBe(0);

    expect(updateAgent).toHaveBeenCalledTimes(1);
    expect(untouched.tools).toEqual(['langflow_report_mcp_tars_x']);
  });
});

describe('migrateAggregateWorkflowTools', () => {
  const projectFlow = (toolName: string, projectToolName: string, projectId: string) =>
    ({ toolName, projectToolName, projectId }) as WorkflowFlow;
  const flows = [
    projectFlow('guide', 'guide', '1a2b3c4d-0000-4000-8000-000000000001'),
    projectFlow('guide_1', 'guide', '5e6f7a8b-0000-4000-8000-000000000002'),
  ];

  it('moves aggregate tools onto their project servers and keeps the rest', async () => {
    const built = agent(
      'agent_mine',
      ['guide_1_mcp_workflow', 'web_search', 'gone_mcp_workflow', 'issue_mcp_tars_redmine'],
      ['workflow', 'tars_redmine'],
    );
    const { deps } = store([built]);

    await expect(migrateAggregateWorkflowTools(deps, flows)).resolves.toBe(1);

    expect(built.tools).toEqual([
      'guide_mcp_workflow_5e6f7a8b',
      'web_search',
      'gone_mcp_workflow',
      'issue_mcp_tars_redmine',
    ]);
    expect(built.mcpServerNames).toEqual(['workflow', 'tars_redmine', 'workflow_5e6f7a8b']);
  });

  it('drops the aggregate server once none of its tools remain', async () => {
    const built = agent('agent_mine', ['guide_mcp_workflow', 'guide_1_mcp_workflow'], ['workflow']);
    const { deps } = store([built]);

    await migrateAggregateWorkflowTools(deps, flows);

    expect(built.tools).toEqual(['guide_mcp_workflow_1a2b3c4d', 'guide_mcp_workflow_5e6f7a8b']);
    expect(built.mcpServerNames).toEqual(['workflow_1a2b3c4d', 'workflow_5e6f7a8b']);
  });

  it('moves a pin on the aggregate server onto the project servers the tools moved to', async () => {
    const built = agent(
      'agent_mine',
      ['sys__server__sys_mcp_workflow', 'guide_mcp_workflow', 'guide_1_mcp_workflow'],
      ['workflow'],
    );
    const { deps } = store([built]);

    await migrateAggregateWorkflowTools(deps, flows);

    expect(built.tools).toEqual([
      'sys__server__sys_mcp_workflow_1a2b3c4d',
      'sys__server__sys_mcp_workflow_5e6f7a8b',
      'guide_mcp_workflow_1a2b3c4d',
      'guide_mcp_workflow_5e6f7a8b',
    ]);
    expect(built.mcpServerNames).toEqual(['workflow_1a2b3c4d', 'workflow_5e6f7a8b']);
  });

  it('leaves the mirrored Workflow agents and untouched agents alone', async () => {
    const mirrored = agent('agent_langflow_guide', ['guide_mcp_workflow'], ['workflow']);
    const unrelated = agent('agent_other', ['gone_mcp_workflow'], ['workflow']);
    const { deps, updateAgent } = store([mirrored, unrelated]);

    await expect(migrateAggregateWorkflowTools(deps, flows)).resolves.toBe(0);
    expect(updateAgent).not.toHaveBeenCalled();
  });
});
