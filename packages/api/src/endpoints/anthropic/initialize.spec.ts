import { EModelEndpoint } from 'librechat-data-provider';
import type { AnthropicClientOptions } from '@librechat/agents';
import type { BaseInitializeParams, ServerRequest } from '~/types';
import { FINE_GRAINED_TOOL_STREAMING_BETA } from './helpers';

const mockGetTarsProviderApiKey = jest.fn();
jest.mock('~/tars', () => ({
  ...jest.requireActual('~/tars'),
  getTarsProviderApiKey: (...args: unknown[]) => mockGetTarsProviderApiKey(...args),
}));

import { initializeAnthropic } from './initialize';

const getDefaultHeaders = (llmConfig: unknown): Record<string, string> =>
  ((llmConfig as AnthropicClientOptions).clientOptions?.defaultHeaders ?? {}) as Record<
    string,
    string
  >;

function createParams(
  endpointsConfig: Record<string, unknown>,
  env: Record<string, string | undefined> = {},
): { params: BaseInitializeParams; restore: () => void } {
  const savedEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    savedEnv[key] = process.env[key];
  }
  Object.assign(process.env, env);

  const params: BaseInitializeParams = {
    req: {
      user: { id: 'user-42' },
      body: { conversationId: 'convo-xyz' },
      config: { endpoints: endpointsConfig },
    } as unknown as ServerRequest,
    endpoint: EModelEndpoint.anthropic,
    model_parameters: { model: 'claude-sonnet-4-5' },
    db: {
      getUserKey: jest.fn(),
      getUserKeyValues: jest.fn(),
    },
  };

  const restore = () => {
    for (const key of Object.keys(env)) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  };

  return { params, restore };
}

describe('initializeAnthropic – custom headers', () => {
  it('threads configured headers into clientOptions.defaultHeaders without resolving placeholders', async () => {
    const { params, restore } = createParams(
      {
        [EModelEndpoint.anthropic]: {
          headers: { 'X-Conversation-Id': '{{LIBRECHAT_BODY_CONVERSATIONID}}' },
        },
      },
      { ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_REVERSE_PROXY: 'https://gateway.example.com' },
    );

    try {
      const result = await initializeAnthropic(params);
      const defaultHeaders = getDefaultHeaders(result.llmConfig);
      /** Placeholder kept intact — resolved at request time, not init time */
      expect(defaultHeaders['X-Conversation-Id']).toBe('{{LIBRECHAT_BODY_CONVERSATIONID}}');
      /** Provider-managed beta header preserved alongside the custom header */
      expect(defaultHeaders['anthropic-beta']).toBe(FINE_GRAINED_TOOL_STREAMING_BETA);
      /** Reverse proxy still wired through native Anthropic config */
      expect(result.llmConfig).toHaveProperty('anthropicApiUrl', 'https://gateway.example.com');
    } finally {
      restore();
    }
  });

  it('merges endpoints.all headers beneath endpoint-specific headers', async () => {
    const { params, restore } = createParams(
      {
        all: { headers: { 'X-Common': 'all', 'X-Override': 'all' } },
        [EModelEndpoint.anthropic]: { headers: { 'X-Override': 'anthropic' } },
      },
      { ANTHROPIC_API_KEY: 'sk-ant-test' },
    );

    try {
      const result = await initializeAnthropic(params);
      const defaultHeaders = getDefaultHeaders(result.llmConfig);
      expect(defaultHeaders['X-Common']).toBe('all');
      expect(defaultHeaders['X-Override']).toBe('anthropic');
    } finally {
      restore();
    }
  });

  it('leaves defaultHeaders provider-managed when no custom headers are configured', async () => {
    const { params, restore } = createParams(
      { [EModelEndpoint.anthropic]: {} },
      { ANTHROPIC_API_KEY: 'sk-ant-test' },
    );

    try {
      const result = await initializeAnthropic(params);
      expect(getDefaultHeaders(result.llmConfig)).toEqual({
        'anthropic-beta': FINE_GRAINED_TOOL_STREAMING_BETA,
      });
    } finally {
      restore();
    }
  });
});

describe('initializeAnthropic – sentinel key chain', () => {
  const noUserKeyError = () => new Error(JSON.stringify({ type: 'no_user_key' }));

  afterEach(() => {
    jest.clearAllMocks();
  });

  const getApiKey = (result: { llmConfig: unknown }): string | undefined =>
    (result.llmConfig as { apiKey?: string }).apiKey;

  it('prefers the stored personal key without consulting sys_config', async () => {
    const { params, restore } = createParams({}, { ANTHROPIC_API_KEY: 'user_provided' });
    (params.db.getUserKey as jest.Mock).mockResolvedValue('sk-ant-user');
    try {
      const result = await initializeAnthropic(params);
      expect(getApiKey(result)).toBe('sk-ant-user');
    } finally {
      restore();
    }
    expect(mockGetTarsProviderApiKey).not.toHaveBeenCalled();
  });

  it('falls back to the sys_config key when the user has no stored key', async () => {
    const { params, restore } = createParams({}, { ANTHROPIC_API_KEY: 'user_provided' });
    (params.db.getUserKey as jest.Mock).mockRejectedValue(noUserKeyError());
    mockGetTarsProviderApiKey.mockResolvedValue('sk-ant-tars');
    try {
      const result = await initializeAnthropic(params);
      expect(getApiKey(result)).toBe('sk-ant-tars');
    } finally {
      restore();
    }
    expect(mockGetTarsProviderApiKey).toHaveBeenCalledWith(EModelEndpoint.anthropic);
  });

  it('throws NO_USER_KEY when neither a personal key nor a sys_config key exists', async () => {
    const { params, restore } = createParams({}, { ANTHROPIC_API_KEY: 'user_provided' });
    (params.db.getUserKey as jest.Mock).mockRejectedValue(noUserKeyError());
    mockGetTarsProviderApiKey.mockResolvedValue(undefined);
    try {
      await expect(initializeAnthropic(params)).rejects.toThrow('no_user_key');
    } finally {
      restore();
    }
  });

  it('rethrows non-NO_USER_KEY errors instead of masking them with sys_config', async () => {
    const { params, restore } = createParams({}, { ANTHROPIC_API_KEY: 'user_provided' });
    (params.db.getUserKey as jest.Mock).mockRejectedValue(
      new Error(JSON.stringify({ type: 'invalid_user_key' })),
    );
    mockGetTarsProviderApiKey.mockResolvedValue('sk-ant-tars');
    try {
      await expect(initializeAnthropic(params)).rejects.toThrow('invalid_user_key');
    } finally {
      restore();
    }
  });

  it('never consults sys_config on the Vertex path', async () => {
    const { params, restore } = createParams(
      {
        [EModelEndpoint.anthropic]: {
          vertexConfig: { enabled: true, region: 'us-east5', projectId: 'p1' },
        },
      },
      { ANTHROPIC_API_KEY: 'user_provided' },
    );
    try {
      await initializeAnthropic(params).catch(() => undefined);
    } finally {
      restore();
    }
    expect(mockGetTarsProviderApiKey).not.toHaveBeenCalled();
    expect(params.db.getUserKey).not.toHaveBeenCalled();
  });
});
