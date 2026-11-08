import type { WorkflowAgentSyncDeps, WorkflowFlow } from './sync';
import type { LCAvailableTools } from '~/mcp/types';
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

const catalogue = (...entries: [key: string, serverToolName?: string][]): LCAvailableTools =>
  Object.fromEntries(
    entries.map(([key, serverToolName]) => [
      key,
      {
        type: 'function' as const,
        function: { name: key, description: '', parameters: { type: 'object', properties: {} } },
        ...(serverToolName && { serverToolName }),
      },
    ]),
  );

function setup(flows: WorkflowFlow[], cached: LCAvailableTools | null) {
  const getCachedTools = jest.fn(async () => cached);
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
  };
  const sync = createWorkflowAgentSync(deps);
  const run = () => sync({ id: 'user-1', tarsId: '1' }, async () => ({}));
  return { run, getCachedTools, invalidateCachedTools, findSharedOwner, refreshServers };
}

describe('createWorkflowAgentSync — cached Langflow catalogue', () => {
  it('drops the catalogue when a flow was renamed since it was cached', async () => {
    const { run, getCachedTools, invalidateCachedTools } = setup(
      [flow('_48pin'), flow('guide')],
      catalogue([`_48_mcp_${SERVER}`], [`guide_mcp_${SERVER}`]),
    );

    await run();

    expect(getCachedTools).toHaveBeenCalledWith('user-1', SERVER);
    expect(invalidateCachedTools).toHaveBeenCalledTimes(1);
    expect(invalidateCachedTools).toHaveBeenCalledWith('user-1', SERVER);
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
