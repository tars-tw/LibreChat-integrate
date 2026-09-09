jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import {
  runTarsPluginTool,
  fetchTarsPluginTools,
  reloadTarsPluginTools,
  getTarsPluginManifest,
  primeTarsPluginManifests,
  invalidateTarsPluginManifestsCache,
} from './client';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const textStats = {
  name: 'text_stats',
  kind: 'plugin',
  description: 'Count the characters, words and lines of a text.',
  display_name: 'Text Stats',
  version: '1.0.0',
  input_schema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The text to analyse.' } },
    required: ['text'],
  },
  requires: [],
  read_only: true,
  ends_turn: false,
};

const serviceTools = {
  success: true,
  data: {
    tools: [
      { name: 'knowledge_search', kind: 'builtin', input_schema: { type: 'object' } },
      textStats,
      { name: 'summarize_text', kind: 'plugin', description: 'Summarize.', requires: ['llm'] },
    ],
    models: ['gpt-5.4-mini'],
    default_model: 'gpt-5.4-mini',
    plugin_errors: ['broken.py: no description'],
  },
};

const adminListing = {
  plugin_tools: [
    {
      name: 'text_stats',
      function_key: 'plugin:text_stats',
      display_name: 'Text Stats',
      description: 'Count words.',
      version: '1.0.0',
      requires: [],
      source: 'text_stats.py',
      ok: true,
      problems: [],
    },
  ],
  plugin_dirs: ['/opt/tars_plugins'],
  errors: [],
};

const runBody = {
  success: true,
  data: {
    content: 'characters: 15\nwords: 3',
    is_error: false,
    artifacts: { stats: { words: 3 } },
    summary: '3 words',
    final_text: '',
    end_turn: false,
    tool: 'text_stats',
    kind: 'plugin',
    title: 'text_stats: 15 chars',
    tokens: { total: 0, prompt: 0, completion: 0 },
    model_name: '',
  },
};

const mockBackend = () =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/api/sys_config/prepare_data')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'service-key', status: 'active' },
      ]);
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gpt-5.4-mini' }]);
    }
    if (url.endsWith('/api/domain_settings/plugin_tools')) {
      return buildResponse(200, adminListing);
    }
    if (url.endsWith('/api/domain_settings/plugin_tools/reload')) {
      return buildResponse(200, { ...adminListing, plugin_dirs: ['/opt/rescanned'] });
    }
    if (url.endsWith('/api/langflow-service/tools') && init?.method === 'GET') {
      return buildResponse(200, serviceTools);
    }
    if (url.endsWith('/api/langflow-service/tools/text_stats')) {
      return buildResponse(200, runBody);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const callsTo = (fetchMock: jest.SpyInstance, fragment: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment));

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsSysConfigCache();
  invalidateTarsModelProfilesCache();
  invalidateTarsPluginManifestsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchTarsPluginTools / reloadTarsPluginTools', () => {
  it('reads the admin listing as pwc_tars reports it', async () => {
    mockBackend();
    await expect(fetchTarsPluginTools()).resolves.toEqual(adminListing);
  });

  it('reloads as the admin and drops the manifest cache', async () => {
    const fetchMock = mockBackend();
    await primeTarsPluginManifests();
    expect(getTarsPluginManifest('text_stats')).toBeDefined();

    const listing = await reloadTarsPluginTools('admin-1');

    expect(listing.plugin_dirs).toEqual(['/opt/rescanned']);
    const [, init] = callsTo(fetchMock, '/plugin_tools/reload')[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ user_id: 'admin-1' });
    expect(getTarsPluginManifest('text_stats')).toBeUndefined();
  });
});

describe('primeTarsPluginManifests', () => {
  it('keeps only plugin manifests, authenticated with the service key', async () => {
    const fetchMock = mockBackend();
    const manifests = await primeTarsPluginManifests();

    expect([...manifests.keys()]).toEqual(['text_stats', 'summarize_text']);
    expect(manifests.get('text_stats')).toEqual(
      expect.objectContaining({ display_name: 'Text Stats', input_schema: textStats.input_schema }),
    );
    expect(manifests.get('summarize_text')).toEqual(
      expect.objectContaining({
        display_name: 'summarize_text',
        requires: ['llm'],
        input_schema: { type: 'object', properties: {} },
      }),
    );
    const [, init] = callsTo(fetchMock, '/api/langflow-service/tools')[0];
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({ 'X-TARS-Service-Key': 'service-key' }),
    );
  });

  it('serves the cache on the next prime and dedupes concurrent primes', async () => {
    const fetchMock = mockBackend();
    await Promise.all([primeTarsPluginManifests(), primeTarsPluginManifests()]);
    await primeTarsPluginManifests();
    expect(callsTo(fetchMock, '/api/langflow-service/tools')).toHaveLength(1);
  });
});

describe('runTarsPluginTool', () => {
  it('posts the inputs with chat-like settings and unwraps the tool output', async () => {
    const fetchMock = mockBackend();
    const result = await runTarsPluginTool('text_stats', {
      inputs: { text: 'hello big world' },
      question: 'how long is this?',
      tarsUserId: 'tars-user-1',
      domainId: '100',
      model: 'GPT-5.4-mini',
      librechatUserId: 'lc-user-1',
    });

    expect(result.content).toBe('characters: 15\nwords: 3');
    expect(result.artifacts).toEqual({ stats: { words: 3 } });
    const [, init] = callsTo(fetchMock, '/tools/text_stats')[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      inputs: { text: 'hello big world' },
      context: { model_name: 'gpt-5.4-mini' },
      settings: {
        plugin_tool_names: ['text_stats'],
        question: 'how long is this?',
        user_id: 'tars-user-1',
        domain_id: 100,
      },
    });
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({
        'X-TARS-Service-Key': 'service-key',
        'X-Use-Librechat-Gateway': 'true',
        'X-Librechat-User-Id': 'lc-user-1',
      }),
    );
  });

  it('leaves the model to pwc_tars when the chat model is not a model_profile', async () => {
    const fetchMock = mockBackend();
    await runTarsPluginTool('text_stats', { inputs: {}, model: 'claude-x' });
    const [, init] = callsTo(fetchMock, '/tools/text_stats')[0];
    expect(JSON.parse(String((init as RequestInit).body)).context).toEqual({});
  });
});
