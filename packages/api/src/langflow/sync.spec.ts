import type { WorkflowAgent, WorkflowAgentSyncDeps, WorkflowFlow } from './sync';
import type { LCAvailableTools, ParsedServerConfig } from '~/mcp/types';
import { createWorkflowAgentSync } from './sync';

const PROJECT_ID = '1a2b3c4d-0000-4000-8000-000000000001';
const SERVER = 'workflow_1a2b3c4d';

const flow = (toolName: string): WorkflowFlow => ({
  toolName,
  flowId: `flow-${toolName}`,
  name: toolName,
  description: '',
  owner: 'system',
  tarsModel: null,
  actionName: toolName,
  projectId: PROJECT_ID,
  projectName: 'Starter Project',
  projectDescription: '',
  projectToolName: toolName,
});

interface Listing {
  serverToolName?: string;
  title?: string;
  description?: string;
}

const catalogue = (
  ...entries: [key: string, serverToolName?: string, listing?: Omit<Listing, 'serverToolName'>][]
): LCAvailableTools =>
  Object.fromEntries(
    entries.map(([key, serverToolName, listing]) => [
      key,
      {
        type: 'function' as const,
        function: {
          name: key,
          description: listing?.description ?? '',
          parameters: { type: 'object', properties: {} },
        },
        ...(serverToolName && { serverToolName }),
        ...(listing?.title && { title: listing.title }),
      },
    ]),
  );

const SERVER_CONFIG = {
  type: 'streamable-http',
  url: `http://langflow:7860/api/v1/tars/mcp/project/${PROJECT_ID}/streamable`,
} as ParsedServerConfig;

function setup(
  flows: WorkflowFlow[],
  cached: LCAvailableTools | null,
  serverConfigs?: () => Promise<Record<string, ParsedServerConfig>>,
  overrides: Partial<WorkflowAgentSyncDeps> = {},
) {
  const getCachedTools = jest.fn(
    async (_userId: string, _serverName: string, _serverConfig?: ParsedServerConfig) => cached,
  );
  const invalidateCachedTools = jest.fn(async () => undefined);
  const findSharedOwner = jest.fn(async () => null);
  const refreshServers = jest.fn(async () => undefined);
  const deps: WorkflowAgentSyncDeps = {
    fetchFlows: async () => flows,
    findSharedOwner,
    getAgents: async () => [],
    createAgent: async () => {
      throw new Error('no agents in these tests');
    },
    updateAgent: async () => undefined,
    deleteAgent: async () => undefined,
    grantPermission: async () => undefined,
    defaultOrchestration: { provider: 'openAI', model: 'gpt-5.4-mini' },
    getCachedTools,
    invalidateCachedTools,
    refreshServers,
    ...overrides,
  };
  const sync = createWorkflowAgentSync(deps);
  const run = () => sync({ id: 'user-1', tarsId: '1' }, async () => ({}), serverConfigs);
  return { run, getCachedTools, invalidateCachedTools, findSharedOwner, refreshServers };
}

describe('createWorkflowAgentSync — cached Langflow catalogue', () => {
  it('drops the catalogue when a flow was renamed since it was cached', async () => {
    const { run, getCachedTools, invalidateCachedTools } = setup(
      [flow('_48pin'), flow('guide')],
      catalogue([`_48_mcp_${SERVER}`], [`guide_mcp_${SERVER}`]),
    );

    await run();

    expect(getCachedTools).toHaveBeenCalledWith('user-1', SERVER, undefined);
    expect(invalidateCachedTools).toHaveBeenCalledTimes(1);
    expect(invalidateCachedTools).toHaveBeenCalledWith('user-1', SERVER);
  });

  it('drops the catalogue when a rename keeps the tool name but changes its title', async () => {
    const { run, invalidateCachedTools } = setup(
      [{ ...flow('milk'), name: 'Milk的簡單流程' }],
      catalogue([`milk_mcp_${SERVER}`, undefined, { title: 'Milk' }]),
    );

    await run();

    expect(invalidateCachedTools).toHaveBeenCalledWith('user-1', SERVER);
  });

  it('drops the catalogue when a flow description changed since it was cached', async () => {
    const { run, invalidateCachedTools } = setup(
      [{ ...flow('guide'), description: '新的說明' }],
      catalogue([`guide_mcp_${SERVER}`, undefined, { description: '舊的說明' }]),
    );

    await run();

    expect(invalidateCachedTools).toHaveBeenCalledWith('user-1', SERVER);
  });

  it('keeps a catalogue whose titles and descriptions match what Langflow publishes', async () => {
    const { run, invalidateCachedTools } = setup(
      [{ ...flow('milk'), name: 'Milk的簡單流程', description: '超越文字生成' }],
      catalogue([
        `milk_mcp_${SERVER}`,
        undefined,
        { title: 'Milk的簡單流程', description: '超越文字生成' },
      ]),
    );

    await run();

    expect(invalidateCachedTools).not.toHaveBeenCalled();
  });

  it("matches an undescribed flow's stand-in under the project server's tool name", async () => {
    const personal: WorkflowFlow = {
      ...flow('guide'),
      toolName: 'my_guide',
      owner: 'personal',
      description: 'Tool generated from flow: my_guide',
    };
    const { run, invalidateCachedTools } = setup(
      [personal],
      catalogue([
        `guide_mcp_${SERVER}`,
        undefined,
        { description: 'Tool generated from flow: guide' },
      ]),
    );

    await run();

    expect(invalidateCachedTools).not.toHaveBeenCalled();
  });

  it("reads each project server's catalogue under the user's resolved config", async () => {
    const serverConfigs = jest.fn(async () => ({ [SERVER]: SERVER_CONFIG }));
    const { run, getCachedTools, invalidateCachedTools } = setup(
      [flow('milk')],
      catalogue([`milk_milk_mcp_${SERVER}`]),
      serverConfigs,
    );

    await run();

    expect(serverConfigs).toHaveBeenCalledTimes(1);
    expect(getCachedTools).toHaveBeenCalledWith('user-1', SERVER, SERVER_CONFIG);
    expect(invalidateCachedTools).toHaveBeenCalledWith('user-1', SERVER);
  });

  it('still checks the catalogue when the configs cannot be resolved', async () => {
    const serverConfigs = jest.fn(async () => {
      throw new Error('registry down');
    });
    const { run, getCachedTools, findSharedOwner } = setup(
      [flow('guide')],
      catalogue([`guide_mcp_${SERVER}`]),
      serverConfigs,
    );

    await expect(run()).resolves.toBeUndefined();
    expect(getCachedTools).toHaveBeenCalledWith('user-1', SERVER, undefined);
    expect(findSharedOwner).toHaveBeenCalledTimes(1);
  });

  it('drops the catalogue when a flow was published since it was cached', async () => {
    const { run, invalidateCachedTools } = setup(
      [flow('guide'), flow('new_flow')],
      catalogue([`guide_mcp_${SERVER}`]),
    );

    await run();

    expect(invalidateCachedTools).toHaveBeenCalledTimes(1);
  });

  it('keeps a catalogue that names exactly what Langflow publishes', async () => {
    const { run, invalidateCachedTools } = setup(
      [flow('guide'), flow('langflow_report')],
      catalogue([`guide_mcp_${SERVER}`], [`report_mcp_${SERVER}`, 'langflow_report']),
    );

    await run();

    expect(invalidateCachedTools).not.toHaveBeenCalled();
  });

  it('leaves an uncached catalogue alone', async () => {
    const { run, invalidateCachedTools } = setup([flow('guide')], null);

    await run();

    expect(invalidateCachedTools).not.toHaveBeenCalled();
  });

  it('still syncs when the cache cannot be read', async () => {
    const { run, getCachedTools, invalidateCachedTools, findSharedOwner } = setup(
      [flow('guide')],
      null,
    );
    getCachedTools.mockRejectedValueOnce(new Error('cache down'));

    await expect(run()).resolves.toBeUndefined();
    expect(invalidateCachedTools).not.toHaveBeenCalled();
    expect(findSharedOwner).toHaveBeenCalledTimes(1);
  });
});

describe('createWorkflowAgentSync — renamed flows', () => {
  it("moves the agents bound to a renamed flow onto its project server's new tool name", async () => {
    const bound: WorkflowAgent = {
      _id: { toString: () => 'agent-1' },
      id: 'agent_mine',
      tools: [`milk_milk_mcp_${SERVER}`],
    };
    const getToolNames = jest.fn(async () => ({ 'flow-milk': 'milk_milk' }));
    const setToolNames = jest.fn(async () => undefined);
    const updateAgent = jest.fn(async () => undefined);
    const { run } = setup([flow('milk')], null, undefined, {
      getToolNames,
      setToolNames,
      getAgents: async (filter) => (filter.tools ? [bound] : []),
      updateAgent,
    });

    await run();

    expect(getToolNames).toHaveBeenCalledWith(SERVER);
    expect(updateAgent).toHaveBeenCalledWith({ _id: bound._id }, { tools: [`milk_mcp_${SERVER}`] });
    expect(setToolNames).toHaveBeenCalledWith(SERVER, { 'flow-milk': 'milk' });
  });
});

describe('createWorkflowAgentSync — per-project servers', () => {
  it('asks for the servers of every project the user is offered, before syncing', async () => {
    const other = { ...flow('claims'), projectId: '5e6f7a8b-0000-4000-8000-000000000002' };
    const { run, refreshServers, findSharedOwner } = setup([flow('guide'), other], null);

    await run();

    expect(refreshServers).toHaveBeenCalledWith([SERVER, 'workflow_5e6f7a8b'], '1');
    expect(refreshServers.mock.invocationCallOrder[0]).toBeLessThan(
      findSharedOwner.mock.invocationCallOrder[0],
    );
  });

  it('still syncs when the servers cannot be re-registered', async () => {
    const { run, refreshServers, findSharedOwner } = setup([flow('guide')], null);
    refreshServers.mockRejectedValueOnce(new Error('reload failed'));

    await expect(run()).resolves.toBeUndefined();
    expect(findSharedOwner).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when Langflow predates per-project servers', async () => {
    const { projectId: _id, ...legacy } = flow('guide');
    const { run, refreshServers, findSharedOwner } = setup([legacy], null);

    await run();

    expect(refreshServers).not.toHaveBeenCalled();
    expect(findSharedOwner).not.toHaveBeenCalled();
  });
});
