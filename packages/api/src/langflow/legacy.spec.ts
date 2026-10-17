import type { LegacyWorkflowServerDeps } from './legacy';
import type { WorkflowAgent } from './sync';
import { renameLegacyWorkflowServer } from './legacy';

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
