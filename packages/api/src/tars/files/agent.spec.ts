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

import { Constants, EModelEndpoint, Tools } from 'librechat-data-provider';
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
async function initialize(loaded: Record<string, unknown>) {
  const agent = {
    id: 'agent-1',
    provider: 'openAI',
    model: 'gpt-5.4-mini',
    tools: [],
    model_parameters: { model: 'gpt-5.4-mini' },
  } as unknown as Agent;
  const req = {
    user: { id: 'user-1' },
    config: {},
    body: { conversationId: 'convo-1', parentMessageId: 'a1' },
  } as unknown as ServerRequest;
  const db: InitializeAgentDbMethods = {
    getFiles: jest.fn().mockResolvedValue([]),
    getConvoFiles: jest.fn().mockResolvedValue([]),
    getToolFilesByIds: jest.fn().mockResolvedValue([]),
    getUserKey: jest.fn().mockResolvedValue('user-1'),
    getUserKeyValues: jest.fn().mockResolvedValue([]),
    updateFilesUsage: jest.fn().mockResolvedValue([]),
    getMessages: jest.fn().mockResolvedValue(thread),
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
