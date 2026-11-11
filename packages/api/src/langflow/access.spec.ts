jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import type { AppConfig } from '@librechat/data-schemas';
import type { WorkflowShareAccessDeps, WorkflowShareAgent } from './access';
import type { WorkflowProject } from './config';
import { assertTarsDirectMcpAccess, TarsMcpAccessDeniedError } from '~/tars/mcp/access';
import { configureWorkflowShareAccess, canUseWorkflowMcpServer } from './access';
import { withWorkflowMcpConfig, WORKFLOW_ACCESS_HEADER } from './config';

const SHARED = '1a2b3c4d-0000-4000-8000-000000000001';
const ALICE_PROJECT = 'abcdef01-0000-4000-8000-000000000003';
const SHARED_SERVER = 'workflow_1a2b3c4d';
const ALICE_SERVER = 'workflow_abcdef01';

const ALICE = { id: 'mongo-alice', tarsId: 'tars-alice' };
const BOB = { id: 'mongo-bob', tarsId: 'tars-bob', role: 'USER' };

const template = {
  type: 'streamable-http',
  url: 'http://langflow:7860/api/v1/tars/mcp/streamable',
  headers: { 'x-api-key': 'system-key' },
  title: 'Workflow',
};

const project = (projectId: string, tarsId: string | null): WorkflowProject => ({
  projectId,
  name: projectId,
  description: '',
  owner: tarsId ? 'personal' : 'system',
  tarsId,
});

const register = () =>
  withWorkflowMcpConfig({ mcpConfig: { workflow: { ...template } } } as unknown as AppConfig, {
    fetchProjects: async () => [project(SHARED, null), project(ALICE_PROJECT, 'tars-alice')],
  });

const agent = (overrides: Partial<WorkflowShareAgent> = {}): WorkflowShareAgent => ({
  id: 'agent-1',
  author: ALICE.id,
  tools: [`report_mcp_${ALICE_SERVER}`],
  ...overrides,
});

/** Alice's agent `agent-1`, viewable by whoever `viewers` names. */
const shares = (
  agents: WorkflowShareAgent[] = [agent()],
  viewers: Record<string, string[]> = { [BOB.id]: ['agent-1'] },
) => {
  const deps = {
    findAgentsBindingServer: jest.fn(async (serverName: string) =>
      serverName === ALICE_SERVER ? agents : [],
    ),
    findUserIdByTarsId: jest.fn(async (tarsId: string) =>
      tarsId === ALICE.tarsId ? ALICE.id : null,
    ),
    findViewableAgentIds: jest.fn(async (user: { id: string }, ids: string[]) =>
      ids.filter((id) => viewers[user.id]?.includes(id)),
    ),
  } satisfies WorkflowShareAccessDeps;
  configureWorkflowShareAccess(deps);
  return deps;
};

const canBob = (toolName?: string, server = ALICE_SERVER) =>
  canUseWorkflowMcpServer(server, BOB, BOB.tarsId, toolName);

beforeEach(async () => {
  configureWorkflowShareAccess(undefined);
  await register();
});

describe('withWorkflowMcpConfig', () => {
  it('tells Langflow it has checked who reaches a personal project, and only there', async () => {
    const { mcpConfig } = await register();

    expect(mcpConfig?.[ALICE_SERVER]).toMatchObject({
      headers: { 'x-api-key': 'system-key', [WORKFLOW_ACCESS_HEADER]: 'agent-share' },
    });
    expect(mcpConfig?.[SHARED_SERVER]).toMatchObject({ headers: { 'x-api-key': 'system-key' } });
    expect(
      (mcpConfig?.[SHARED_SERVER] as { headers: Record<string, string> }).headers,
    ).not.toHaveProperty(WORKFLOW_ACCESS_HEADER);
  });
});

describe('canUseWorkflowMcpServer', () => {
  it('lets anyone reach a shared project and anything that is not a project server', async () => {
    const deps = shares([], {});

    await expect(canBob('anything', SHARED_SERVER)).resolves.toBe(true);
    await expect(canBob('anything', 'tars_github')).resolves.toBe(true);
    expect(deps.findAgentsBindingServer).not.toHaveBeenCalled();
  });

  it('lets the owner in without reading any share', async () => {
    const deps = shares([], {});

    await expect(canUseWorkflowMcpServer(ALICE_SERVER, ALICE, ALICE.tarsId, 'x')).resolves.toBe(
      true,
    );
    expect(deps.findAgentsBindingServer).not.toHaveBeenCalled();
  });

  it("reaches the flows of an owner's agent shared with the user, and only those", async () => {
    shares();

    await expect(canBob()).resolves.toBe(true);
    await expect(canBob('report')).resolves.toBe(true);
    await expect(canBob('payroll')).resolves.toBe(false);
  });

  it('refuses when no agent of the owner binding the project is shared with the user', async () => {
    shares([agent()], {});

    await expect(canBob('report')).resolves.toBe(false);
  });

  it("does not count an agent someone else built on the owner's project", async () => {
    shares([agent({ author: 'mongo-mallory' })]);

    await expect(canBob('report')).resolves.toBe(false);
  });

  it('treats a whole-server binding as every flow, and the server marker as none', async () => {
    shares([agent({ tools: [`sys__all__sys_mcp_${ALICE_SERVER}`] })]);
    await expect(canBob('payroll')).resolves.toBe(true);

    configureWorkflowShareAccess(undefined);
    shares([agent({ tools: [`sys__server__sys_mcp_${ALICE_SERVER}`] })]);
    await expect(canBob()).resolves.toBe(false);
  });

  it('refuses an unlinked account and every non-owner while unconfigured', async () => {
    shares();
    await expect(canUseWorkflowMcpServer(ALICE_SERVER, BOB, null, 'report')).resolves.toBe(false);

    configureWorkflowShareAccess(undefined);
    await expect(canBob('report')).resolves.toBe(false);
  });

  it('refuses when the shares cannot be read, without remembering it', async () => {
    const deps = shares();
    deps.findViewableAgentIds.mockRejectedValueOnce(new Error('mongo down'));

    await expect(canBob('report')).resolves.toBe(false);
    await expect(canBob('report')).resolves.toBe(true);
  });

  it('remembers an answer briefly per user, project and tool', async () => {
    const deps = shares();

    await canBob('report');
    await canBob('report');
    await canBob('payroll');

    expect(deps.findAgentsBindingServer).toHaveBeenCalledTimes(2);
  });
});

describe('assertTarsDirectMcpAccess', () => {
  it('guards personal Workflow projects at every connection and call', async () => {
    shares();

    await expect(assertTarsDirectMcpAccess(ALICE_SERVER, null, BOB)).resolves.toBeUndefined();
    await expect(
      assertTarsDirectMcpAccess(ALICE_SERVER, null, BOB, 'payroll'),
    ).rejects.toBeInstanceOf(TarsMcpAccessDeniedError);
    await expect(
      assertTarsDirectMcpAccess(ALICE_SERVER, null, { id: 'mongo-carol', tarsId: 'tars-carol' }),
    ).rejects.toBeInstanceOf(TarsMcpAccessDeniedError);
  });
});
