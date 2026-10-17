import type { WorkflowAgentSyncDeps, WorkflowFlow } from './sync';
import type { LCAvailableTools } from '~/mcp/types';
import { createWorkflowAgentSync } from './sync';

const flow = (toolName: string): WorkflowFlow => ({
  toolName,
  flowId: `flow-${toolName}`,
  name: toolName,
  description: '',
  owner: 'system',
  tarsModel: null,
  actionName: toolName,
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
  };
  const sync = createWorkflowAgentSync(deps);
  const run = () => sync({ id: 'user-1', tarsId: '1' }, async () => ({}));
  return { run, getCachedTools, invalidateCachedTools, findSharedOwner };
}

describe('createWorkflowAgentSync — cached Langflow catalogue', () => {
  it('drops the catalogue when a flow was renamed since it was cached', async () => {
    const { run, getCachedTools, invalidateCachedTools } = setup(
      [flow('_48pin'), flow('guide')],
      catalogue(['_48_mcp_workflow'], ['guide_mcp_workflow']),
    );

    await run();

    expect(getCachedTools).toHaveBeenCalledWith('user-1', 'workflow');
    expect(invalidateCachedTools).toHaveBeenCalledTimes(1);
    expect(invalidateCachedTools).toHaveBeenCalledWith('user-1', 'workflow');
  });

  it('drops the catalogue when a flow was published since it was cached', async () => {
    const { run, invalidateCachedTools } = setup(
      [flow('guide'), flow('new_flow')],
      catalogue(['guide_mcp_workflow']),
    );

    await run();

    expect(invalidateCachedTools).toHaveBeenCalledTimes(1);
  });

  it('keeps a catalogue that names exactly what Langflow publishes', async () => {
    const { run, invalidateCachedTools } = setup(
      [flow('guide'), flow('langflow_report')],
      catalogue(['guide_mcp_workflow'], ['report_mcp_workflow', 'langflow_report']),
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
