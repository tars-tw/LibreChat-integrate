import type { WorkflowToolNames, WorkflowToolRenameDeps } from './renames';
import type { WorkflowAgent } from './types';
import { followWorkflowToolRenames } from './renames';

const SERVER = 'workflow_1a2b3c4d';
const OTHER = 'workflow_5e6f7a8b';
const key = (tool: string, server = SERVER) => `${tool}_mcp_${server}`;
const token = (server = SERVER) => `sys__server__sys_mcp_${server}`;

function setup(agents: WorkflowAgent[], remembered: Record<string, WorkflowToolNames> = {}) {
  const store = new Map(Object.entries(remembered));
  const deps = {
    getToolNames: jest.fn(async (serverName: string) => store.get(serverName)),
    setToolNames: jest.fn(async (serverName: string, names: WorkflowToolNames) => {
      store.set(serverName, names);
    }),
    getAgents: jest.fn(async ({ tools }: { tools: RegExp }) =>
      agents.filter((agent) => agent.tools?.some((tool) => tools.test(tool))),
    ),
    updateAgent: jest.fn(
      async (
        { _id }: { _id: WorkflowAgent['_id'] },
        changes: Pick<WorkflowAgent, 'tools' | 'tool_options'>,
      ) => {
        Object.assign(agents.find((agent) => agent._id === _id) ?? {}, changes);
      },
    ),
  } satisfies WorkflowToolRenameDeps;
  return { deps, store };
}

const agent = (id: string, fields: Partial<WorkflowAgent>): WorkflowAgent => ({
  _id: { toString: () => id },
  id,
  ...fields,
});

const listing = (serverName: string, flows: Record<string, string>) => ({
  serverName,
  flows: Object.entries(flows).map(([flowId, projectToolName]) => ({ flowId, projectToolName })),
});

describe('followWorkflowToolRenames', () => {
  it("only remembers a server's first listing", async () => {
    const { deps, store } = setup([]);

    await followWorkflowToolRenames(deps, [listing(SERVER, { 'flow-a': 'milk_milk' })]);

    expect(deps.getAgents).not.toHaveBeenCalled();
    expect(store.get(SERVER)).toEqual({ 'flow-a': 'milk_milk' });
  });

  it('moves every agent bound to a renamed flow onto its new tool name, options included', async () => {
    const mine = agent('agent_mine', {
      tools: [token(), key('milk_milk'), key('guide'), 'web_search'],
      tool_options: { [key('milk_milk')]: { defer_loading: true }, web_search: {} },
    });
    const shared = agent('agent_shared', { tools: [token(), key('milk_milk')] });
    const unrelated = agent('agent_other', { tools: [key('milk_milk', OTHER)] });
    const { deps, store } = setup([mine, shared, unrelated], {
      [SERVER]: { 'flow-a': 'milk_milk', 'flow-b': 'guide' },
    });

    await followWorkflowToolRenames(deps, [
      listing(SERVER, { 'flow-a': 'milk', 'flow-b': 'guide' }),
    ]);

    expect(mine.tools).toEqual([token(), key('milk'), key('guide'), 'web_search']);
    expect(mine.tool_options).toEqual({ web_search: {}, [key('milk')]: { defer_loading: true } });
    expect(shared.tools).toEqual([token(), key('milk')]);
    expect(unrelated.tools).toEqual([key('milk_milk', OTHER)]);
    expect(deps.updateAgent).toHaveBeenCalledTimes(2);
    expect(store.get(SERVER)).toEqual({ 'flow-a': 'milk', 'flow-b': 'guide' });
  });

  it('swaps two flows that traded names instead of merging them', async () => {
    const bound = agent('agent_swap', {
      tools: [key('report'), key('summary')],
      tool_options: { [key('report')]: { run_in_background: true } },
    });
    const { deps } = setup([bound], { [SERVER]: { 'flow-a': 'report', 'flow-b': 'summary' } });

    await followWorkflowToolRenames(deps, [
      listing(SERVER, { 'flow-a': 'summary', 'flow-b': 'report' }),
    ]);

    expect(bound.tools).toEqual([key('summary'), key('report')]);
    expect(bound.tool_options).toEqual({ [key('summary')]: { run_in_background: true } });
  });

  it('keeps one entry when an agent already held the new name as well', async () => {
    const bound = agent('agent_both', { tools: [key('milk_milk'), key('milk')] });
    const { deps } = setup([bound], { [SERVER]: { 'flow-a': 'milk_milk' } });

    await followWorkflowToolRenames(deps, [listing(SERVER, { 'flow-a': 'milk' })]);

    expect(bound.tools).toEqual([key('milk')]);
  });

  it('writes nothing when the listing is unchanged', async () => {
    const { deps } = setup([], { [SERVER]: { 'flow-a': 'milk' } });

    await followWorkflowToolRenames(deps, [listing(SERVER, { 'flow-a': 'milk' })]);

    expect(deps.getAgents).not.toHaveBeenCalled();
    expect(deps.setToolNames).not.toHaveBeenCalled();
  });

  it('forgets a flow that left the listing, so its name can pass to another flow', async () => {
    const bound = agent('agent_old', { tools: [key('unnamed')] });
    const { deps, store } = setup([bound], {
      [SERVER]: { 'flow-a': 'unnamed', 'flow-b': 'unnamed_1' },
    });

    await followWorkflowToolRenames(deps, [listing(SERVER, { 'flow-b': 'unnamed_1' })]);
    await followWorkflowToolRenames(deps, [
      listing(SERVER, { 'flow-a': 'report', 'flow-b': 'unnamed_1' }),
    ]);

    expect(deps.getAgents).not.toHaveBeenCalled();
    expect(bound.tools).toEqual([key('unnamed')]);
    expect(store.get(SERVER)).toEqual({ 'flow-a': 'report', 'flow-b': 'unnamed_1' });
  });

  it('keeps the old listing when the agents cannot be rewritten, so the next pass retries', async () => {
    const bound = agent('agent_retry', { tools: [key('milk_milk')] });
    const { deps, store } = setup([bound], { [SERVER]: { 'flow-a': 'milk_milk' } });
    deps.updateAgent.mockRejectedValueOnce(new Error('write conflict'));

    await expect(
      followWorkflowToolRenames(deps, [listing(SERVER, { 'flow-a': 'milk' })]),
    ).resolves.toBeUndefined();
    expect(store.get(SERVER)).toEqual({ 'flow-a': 'milk_milk' });

    await followWorkflowToolRenames(deps, [listing(SERVER, { 'flow-a': 'milk' })]);
    expect(bound.tools).toEqual([key('milk')]);
    expect(store.get(SERVER)).toEqual({ 'flow-a': 'milk' });
  });

  it('carries on with the other servers when one cannot be read', async () => {
    const bound = agent('agent_other', { tools: [key('old', OTHER)] });
    const { deps } = setup([bound], { [OTHER]: { 'flow-c': 'old' } });
    deps.getToolNames.mockRejectedValueOnce(new Error('mongo down'));

    await followWorkflowToolRenames(deps, [
      listing(SERVER, { 'flow-a': 'milk' }),
      listing(OTHER, { 'flow-c': 'new' }),
    ]);

    expect(bound.tools).toEqual([key('new', OTHER)]);
  });
});
