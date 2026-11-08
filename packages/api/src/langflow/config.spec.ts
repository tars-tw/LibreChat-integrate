import type { AppConfig } from '@librechat/data-schemas';
import type { WorkflowProject } from './config';
import {
  withWorkflowMcpConfig,
  claimWorkflowConfigRefresh,
  workflowMcpInjectionFailed,
  filterVisibleWorkflowMcpConfigs,
} from './config';

const LANGFLOW = 'http://langflow:7860';
const STARTER = '1a2b3c4d-0000-4000-8000-000000000001';
const MINE = 'abcdef01-0000-4000-8000-000000000003';

const template = {
  type: 'streamable-http',
  url: `${LANGFLOW}/api/v1/tars/mcp/streamable`,
  headers: {
    'x-api-key': 'system-key',
    'x-langflow-global-var-tars_user_id': '{{LIBRECHAT_USER_TARSID}}',
  },
  title: 'Workflow',
  description: '將 Workflow 流程作為可呼叫的工具',
  timeout: 60000,
  chatMenu: false,
  startup: true,
};

const project = (
  projectId: string,
  name: string,
  tarsId: string | null = null,
): WorkflowProject => ({
  projectId,
  name,
  description: '',
  owner: tarsId ? 'personal' : 'system',
  tarsId,
});

const appConfig = (extra: Record<string, unknown> = {}) =>
  ({ mcpConfig: { workflow: { ...template }, ...extra } }) as unknown as AppConfig;

const load = (projects: WorkflowProject[] | Error | null, config = appConfig()) =>
  withWorkflowMcpConfig(config, {
    fetchProjects: async () => {
      if (projects instanceof Error) {
        throw projects;
      }
      return projects;
    },
  });

describe('withWorkflowMcpConfig', () => {
  it('replaces the aggregate with one server per project, built from its entry', async () => {
    const { mcpConfig } = await load([
      project(STARTER, 'Starter Project'),
      project(MINE, '高雄小導遊', 'tars-alice'),
    ]);

    expect(Object.keys(mcpConfig ?? {})).toEqual(['workflow_1a2b3c4d', 'workflow_abcdef01']);
    expect(mcpConfig?.workflow_1a2b3c4d).toEqual({
      ...template,
      url: `${LANGFLOW}/api/v1/tars/mcp/project/${STARTER}/streamable`,
      title: 'Starter Project',
      startup: false,
    });
    expect(mcpConfig?.workflow_abcdef01).toMatchObject({
      title: '我的 - 高雄小導遊',
      description: template.description,
    });
    expect(workflowMcpInjectionFailed()).toBe(false);
  });

  it('keeps an entry the YAML already defines under a project key', async () => {
    const pinned = { type: 'stdio', command: 'pinned' };
    const { mcpConfig } = await load(
      [project(STARTER, 'Starter Project')],
      appConfig({ workflow_1a2b3c4d: pinned }),
    );

    expect(mcpConfig?.workflow_1a2b3c4d).toBe(pinned);
  });

  it('keeps the aggregate when Langflow predates the project list', async () => {
    const { mcpConfig } = await load(Object.assign(new Error('nope'), { status: 404 }));

    expect(Object.keys(mcpConfig ?? {})).toEqual(['workflow']);
    expect(workflowMcpInjectionFailed()).toBe(false);
  });

  it('registers the last project list and asks for a retry when Langflow is unreachable', async () => {
    await load([project(STARTER, 'Starter Project')]);

    const { mcpConfig } = await load(new Error('ECONNREFUSED'));

    expect(Object.keys(mcpConfig ?? {})).toEqual(['workflow_1a2b3c4d']);
    expect(workflowMcpInjectionFailed()).toBe(true);
  });

  it('keeps hiding personal servers while a reload waits on Langflow', async () => {
    await load([project(STARTER, 'Starter Project'), project(MINE, 'Mine', 'tars-alice')]);
    const configs = { workflow_1a2b3c4d: 1, workflow_abcdef01: 2 };
    let answer: (projects: WorkflowProject[]) => void = () => undefined;
    const reload = withWorkflowMcpConfig(appConfig(), {
      fetchProjects: () => new Promise((resolve) => (answer = resolve)),
    });

    expect(Object.keys(filterVisibleWorkflowMcpConfigs(configs, 'tars-bob'))).toEqual([
      'workflow_1a2b3c4d',
    ]);
    answer([project(STARTER, 'Starter Project'), project(MINE, 'Mine', 'tars-alice')]);
    await reload;
    expect(Object.keys(filterVisibleWorkflowMcpConfigs(configs, 'tars-bob'))).toEqual([
      'workflow_1a2b3c4d',
    ]);
  });

  it('leaves a config whose workflow entry is not the Langflow aggregate alone', async () => {
    const fetchProjects = jest.fn(async () => [project(STARTER, 'Starter Project')]);
    const config = {
      mcpConfig: { workflow: { ...template, url: 'http://elsewhere/mcp' } },
    } as unknown as AppConfig;

    await withWorkflowMcpConfig(config, { fetchProjects });

    expect(fetchProjects).not.toHaveBeenCalled();
    expect(Object.keys(config.mcpConfig ?? {})).toEqual(['workflow']);
  });
});

describe('filterVisibleWorkflowMcpConfigs', () => {
  beforeAll(() => load([project(STARTER, 'Starter Project'), project(MINE, 'Mine', 'tars-alice')]));

  const configs = { workflow_1a2b3c4d: 1, workflow_abcdef01: 2, tars_erp: 3 };

  it("shows a personal project's server to its owner only", () => {
    expect(Object.keys(filterVisibleWorkflowMcpConfigs(configs, 'tars-alice'))).toEqual([
      'workflow_1a2b3c4d',
      'workflow_abcdef01',
      'tars_erp',
    ]);
    expect(Object.keys(filterVisibleWorkflowMcpConfigs(configs, 'tars-bob'))).toEqual([
      'workflow_1a2b3c4d',
      'tars_erp',
    ]);
    expect(Object.keys(filterVisibleWorkflowMcpConfigs(configs, undefined))).toEqual([
      'workflow_1a2b3c4d',
      'tars_erp',
    ]);
  });
});

describe('claimWorkflowConfigRefresh', () => {
  beforeEach(() =>
    load([project(STARTER, 'Starter Project'), project(MINE, 'Mine', 'tars-alice')]),
  );
  let now = 1_000_000_000;
  const later = () => (now += 120_000);

  it('is quiet while the registered servers match what the user is offered', () => {
    expect(claimWorkflowConfigRefresh(['workflow_1a2b3c4d'], 'tars-bob', later())).toBe(false);
    expect(
      claimWorkflowConfigRefresh(['workflow_1a2b3c4d', 'workflow_abcdef01'], 'tars-alice', later()),
    ).toBe(false);
  });

  it('asks once for a reload when a project appears, disappears or changes hands', () => {
    expect(
      claimWorkflowConfigRefresh(['workflow_1a2b3c4d', 'workflow_99999999'], 'tars-bob', later()),
    ).toBe(true);
    expect(claimWorkflowConfigRefresh([], 'tars-bob', later())).toBe(true);
    expect(
      claimWorkflowConfigRefresh(['workflow_1a2b3c4d', 'workflow_abcdef01'], 'tars-bob', later()),
    ).toBe(true);
  });

  it('asks at most once a minute', () => {
    const at = later();
    expect(claimWorkflowConfigRefresh([], 'tars-bob', at)).toBe(true);
    expect(claimWorkflowConfigRefresh([], 'tars-bob', at + 30_000)).toBe(false);
  });

  it('never asks while the aggregate is still registered', async () => {
    await load(Object.assign(new Error('nope'), { status: 404 }));
    expect(claimWorkflowConfigRefresh(['workflow_1a2b3c4d'], 'tars-bob', later())).toBe(false);
  });
});
