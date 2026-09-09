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
import { invalidateTarsPluginManifestsCache, primeTarsPluginManifests } from './client';
import { createTarsPluginTool, formatTarsPluginResult, getTarsPluginDefinition } from './tool';
import type { TarsPluginRunResult } from './client';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const inputSchema = {
  type: 'object',
  properties: {
    text: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, description: 'Text.' },
    sentences: { type: 'integer', default: 3, minimum: 1, maximum: 10 },
  },
};

const output = (overrides: Partial<TarsPluginRunResult> = {}): TarsPluginRunResult => ({
  content: 'words: 3',
  is_error: false,
  artifacts: {},
  summary: '',
  final_text: '',
  end_turn: false,
  ...overrides,
});

const mockBackend = (run: { status: number; body: unknown }) =>
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
    if (url.endsWith('/api/langflow-service/tools') && init?.method === 'GET') {
      return buildResponse(200, {
        success: true,
        data: {
          tools: [
            {
              name: 'summarize_text',
              kind: 'plugin',
              description: 'Summarize a text.',
              display_name: 'Summarize Text',
              input_schema: inputSchema,
              requires: ['llm'],
            },
          ],
        },
      });
    }
    if (url.endsWith('/api/langflow-service/tools/summarize_text')) {
      return buildResponse(run.status, run.body);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsSysConfigCache();
  invalidateTarsModelProfilesCache();
  invalidateTarsPluginManifestsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('formatTarsPluginResult', () => {
  it('relays the content and appends the standard artifact links', () => {
    expect(
      formatTarsPluginResult(
        output({
          content: 'Here is the chart.',
          artifacts: {
            chart_url: 'http://host/static/c.png',
            file_url: 'http://host/static/f.xlsx',
            urls: ['http://a.example', { url: 'http://b.example', title: 'B' }, { title: 'x' }],
          },
        }),
      ),
    ).toBe(
      'Here is the chart.\n\n![chart](http://host/static/c.png)\n\n[Download](http://host/static/f.xlsx)\n\n' +
        'Sources:\n- http://a.example\n- [B](http://b.example)',
    );
  });

  it('prefers final_text and does not repeat a link already in the text', () => {
    expect(
      formatTarsPluginResult(
        output({
          content: 'raw',
          final_text: 'See ![c](http://host/c.png)',
          artifacts: { chart_url: 'http://host/c.png' },
        }),
      ),
    ).toBe('See ![c](http://host/c.png)');
  });

  it('labels errors so the model can recover', () => {
    expect(formatTarsPluginResult(output({ is_error: true, content: 'no text' }))).toBe(
      'The plugin tool reported an error: no text',
    );
  });
});

describe('getTarsPluginDefinition', () => {
  it('is undefined before priming and for non-plugin names', async () => {
    mockBackend({ status: 200, body: {} });
    expect(getTarsPluginDefinition('tars_plugin_summarize_text')).toBeUndefined();
    await primeTarsPluginManifests();
    expect(getTarsPluginDefinition('sql_agent')).toBeUndefined();
    expect(getTarsPluginDefinition('tars_plugin_unknown')).toBeUndefined();
  });

  it('exposes the primed manifest with a normalized schema', async () => {
    mockBackend({ status: 200, body: {} });
    await primeTarsPluginManifests();
    const definition = getTarsPluginDefinition('tars_plugin_summarize_text');
    expect(definition).toEqual(
      expect.objectContaining({
        name: 'tars_plugin_summarize_text',
        description: 'Summarize a text.',
        toolType: 'builtin',
      }),
    );
    expect(definition?.schema.type).toBe('object');
    expect(Object.keys(definition?.schema.properties ?? {})).toEqual(['text', 'sentences']);
  });
});

describe('createTarsPluginTool', () => {
  it('is undefined for plugins pwc_tars does not list', async () => {
    mockBackend({ status: 200, body: {} });
    await expect(
      createTarsPluginTool({ toolName: 'tars_plugin_missing', tarsUserId: 'u1' }),
    ).resolves.toBeUndefined();
    await expect(createTarsPluginTool({ toolName: 'sql_agent' })).resolves.toBeUndefined();
  });

  it('runs the plugin with the model arguments and the chat context', async () => {
    const fetchMock = mockBackend({
      status: 200,
      body: { success: true, data: output({ content: 'A short summary.' }) },
    });
    const tool = await createTarsPluginTool({
      toolName: 'tars_plugin_summarize_text',
      tarsUserId: 'tars-user-1',
      domainId: 100,
      model: 'gpt-5.4-mini',
      librechatUserId: 'lc-1',
      question: 'Summarize this long text please',
    });
    expect(tool?.name).toBe('tars_plugin_summarize_text');
    expect(tool?.description).toBe('Summarize a text.');

    await expect(tool?.invoke({ sentences: 2 })).resolves.toBe('A short summary.');

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/summarize_text'));
    const body = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(body.inputs).toEqual({ sentences: 2 });
    expect(body.context).toEqual({ model_name: 'gpt-5.4-mini' });
    expect(body.settings).toEqual({
      plugin_tool_names: ['summarize_text'],
      question: 'Summarize this long text please',
      user_id: 'tars-user-1',
      domain_id: 100,
    });
  });

  it('refuses for an account not linked to pwc_tars without calling it', async () => {
    const fetchMock = mockBackend({ status: 200, body: {} });
    const tool = await createTarsPluginTool({ toolName: 'tars_plugin_summarize_text' });
    await expect(tool?.invoke({})).resolves.toMatch(/not linked to pwc_tars/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/summarize_text'))).toBe(
      false,
    );
  });

  it('surfaces the pwc_tars failure reason instead of throwing', async () => {
    mockBackend({
      status: 503,
      body: { success: false, message: '工具 summarize_text 缺少必要設定：llm' },
    });
    const tool = await createTarsPluginTool({
      toolName: 'tars_plugin_summarize_text',
      tarsUserId: 'u1',
    });
    await expect(tool?.invoke({})).resolves.toBe(
      'The plugin tool "Summarize Text" failed: 工具 summarize_text 缺少必要設定：llm',
    );
  });
});
