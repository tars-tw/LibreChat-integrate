jest.mock('~/endpoints', () => ({
  ...jest.requireActual('~/endpoints'),
  getProviderConfig: () => ({
    overrideProvider: 'openAI',
    getOptions: async () => ({ llmConfig: { model: 'gpt-5.4-mini', maxTokens: 4096 } }),
  }),
}));

jest.mock('~/agents/resources', () => ({
  primeResources: jest.fn().mockResolvedValue({ attachments: [], tool_resources: undefined }),
}));

import {
  Tools,
  Constants,
  Permissions,
  EModelEndpoint,
  PermissionTypes,
} from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';
import type { InitializeAgentDbMethods } from '~/agents/initialize';
import type { ServerRequest } from '~/types';
import { initializeAgent } from '~/agents/initialize';

const REPORT = '/api/tars/static/generate_output/kb/report.xlsx?sig=a';
const NO_PARENT = String(Constants.NO_PARENT);

/** The stored thread: a reply whose `tars_trace` attachment carries a generated file. */
const thread = [
  { messageId: 'u1', parentMessageId: NO_PARENT },
  {
    messageId: 'a1',
    parentMessageId: 'u1',
    attachments: [
      {
        type: Tools.tars_trace,
        [Tools.tars_trace]: { step: { links: [{ type: 'file', url: REPORT }] } },
      },
    ],
  },
];

/** One `initializeAgent` call answering `u2` (child of `a1`), `loadTools` resolving to `loaded`. */
async function initialize(
  loaded: Record<string, unknown>,
  overrides: { user?: object; body?: object; config?: object } = {},
) {
  const agent = {
    id: 'agent-1',
    provider: 'openAI',
    model: 'gpt-5.4-mini',
    tools: [],
    model_parameters: { model: 'gpt-5.4-mini' },
  } as unknown as Agent;
  const req = {
    user: { id: 'user-1', ...overrides.user },
    config: overrides.config ?? {},
    body: { conversationId: 'convo-1', parentMessageId: 'a1', ...overrides.body },
  } as unknown as ServerRequest;
  const db: InitializeAgentDbMethods = {
    getFiles: jest.fn().mockResolvedValue([]),
    getConvoFiles: jest.fn().mockResolvedValue([]),
    getToolFilesByIds: jest.fn().mockResolvedValue([]),
    getUserKey: jest.fn().mockResolvedValue('user-1'),
    getUserKeyValues: jest.fn().mockResolvedValue([]),
    updateFilesUsage: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue(thread),
    getRoleByName: jest.fn().mockResolvedValue({
      permissions: { [PermissionTypes.MEMORIES]: { [Permissions.USE]: true } },
    }),
  } as unknown as InitializeAgentDbMethods;

  return initializeAgent(
    {
      req,
      res: {} as import('express').Response,
      agent,
      loadTools: jest.fn().mockResolvedValue(loaded),
      conversationId: 'convo-1',
      parentMessageId: 'a1',
      endpointOption: { endpoint: EModelEndpoint.agents },
      allowedProviders: new Set(['openAI']),
      isInitialAgent: true,
    },
    db,
  );
}

describe('generated links reaching the agent', () => {
  beforeAll(() => {
    process.env.TARS_AUTH_URL = 'http://tars.invalid';
  });
  afterAll(() => {
    delete process.env.TARS_AUTH_URL;
  });

  it('lists them in the per-turn instructions next to the tools context', async () => {
    const result = await initialize({
      toolDefinitions: [],
      toolContextMap: {},
      dynamicToolContextMap: { web_search: 'Current date: today' },
    });

    expect(result.dynamicToolContextMap?.web_search).toBe('Current date: today');
    expect(result.dynamicToolContextMap?.tars_generated_files).toContain(
      `- file: [report.xlsx](${REPORT})`,
    );
  });

  /**
   * An agent without tools gets definitions only from `loadTools`, no context
   * maps, and a later turn with every tool switched off can still be asked for
   * an earlier file.
   */
  it('lists them when the turn loads no tools', async () => {
    const result = await initialize({ toolDefinitions: [] });

    expect(result.dynamicToolContextMap?.tars_generated_files).toContain(
      `- file: [report.xlsx](${REPORT})`,
    );
  });
});

describe('personal memory reaching the agent', () => {
  beforeAll(() => {
    process.env.TARS_AUTH_URL = 'http://tars.invalid';
    process.env.TARS_JWT_SECRET = 'test-secret';
  });
  afterAll(() => {
    delete process.env.TARS_AUTH_URL;
    delete process.env.TARS_JWT_SECRET;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('puts the recalled memory in the per-turn instructions', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { memory_context: '使用者偏好繁體中文' } }),
    } as Response);

    const result = await initialize(
      { toolDefinitions: [] },
      { user: { tarsId: '42', role: 'USER' }, body: { text: '你記得我喜歡什麼嗎？' } },
    );

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/memory/context');
    expect(result.dynamicToolContextMap?.tars_user_memory).toContain('使用者偏好繁體中文');
  });

  const recalled = (memoryContext: string) =>
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { memory_context: memoryContext } }),
    } as Response);
  const pii = {
    starterPatterns: [],
    customPatterns: [{ id: 'secret', label: 'secret', regex: 'PRIVATE-[A-Z]+' }],
  };
  const asked = { user: { tarsId: '42', role: 'USER' }, body: { text: '你記得我嗎？' } };

  it('drops a memory the memory policy refuses and still runs the turn', async () => {
    recalled('- 帳號 PRIVATE-VALUE');

    const result = await initialize(
      { toolDefinitions: [] },
      { ...asked, config: { filters: { memories: { pii } } } },
    );

    expect(result.dynamicToolContextMap?.tars_user_memory).toBeUndefined();
  });

  it('keeps a memory the memory policy allows', async () => {
    recalled('- 偏好繁體中文');

    const result = await initialize(
      { toolDefinitions: [] },
      { ...asked, config: { filters: { memories: { pii } } } },
    );

    expect(result.dynamicToolContextMap?.tars_user_memory).toContain('偏好繁體中文');
  });

  it('judges memory by the memory policy, not the file policy', async () => {
    recalled('- 帳號 PRIVATE-VALUE');

    const result = await initialize(
      { toolDefinitions: [] },
      { ...asked, config: { filters: { files: { pii } } } },
    );

    expect(result.dynamicToolContextMap?.tars_user_memory).toContain('PRIVATE-VALUE');
  });

  it('adds nothing for a user who turned memory off', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    const result = await initialize(
      { toolDefinitions: [] },
      {
        user: { tarsId: '42', personalization: { memories: false } },
        body: { text: '你記得我喜歡什麼嗎？' },
      },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.dynamicToolContextMap?.tars_user_memory).toBeUndefined();
  });
});
