jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { Tools } from 'librechat-data-provider';
import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { invalidateTarsPluginManifestsCache, primeTarsPluginManifests } from './client';
import { createTarsPluginTool, formatTarsPluginResult, getTarsPluginDefinition } from './tool';
import type { TarsPluginRunResult } from './client';

import { tarsToolStreamResponse } from '~/tars/tools/mocks';

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
    if (url.includes('/api/settings/list_sys_configs')) {
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
    if (url.endsWith('/api/langflow-service/tools/summarize_text/stream')) {
      return tarsToolStreamResponse(run.status, run.body);
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

  it('points pwc_tars generated-file links at the LibreChat relay', () => {
    process.env.JWT_SECRET = 'relay-test-secret';
    const link = 'http://202.5.253.240:85/static/generate_output/cal/結果.xlsx';
    const text = formatTarsPluginResult(
      output({ final_text: `[下載](${link})`, artifacts: { file_url: link } }),
    );
    expect(text).toMatch(
      /^\[下載\]\(\/api\/tars\/static\/generate_output\/cal\/結果\.xlsx\?sig=[\w-]+\)$/,
    );
    delete process.env.JWT_SECRET;
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

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/summarize_text/stream'),
    );
    const body = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(body.inputs).toEqual({ sentences: 2 });
    expect(body.context).toEqual({ model_name: 'gpt-5.4-mini' });
    expect(body.settings).toEqual({
      direct_call: false,
      plugin_tool_names: ['summarize_text'],
      question: 'Summarize this long text please',
      user_id: 'tars-user-1',
      domain_id: 100,
    });
  });

  it('sends the spreadsheets as signed refs and reads file_input and history on call', async () => {
    process.env.JWT_SECRET = 'plugin-test-secret';
    const fetchMock = mockBackend({ status: 200, body: { success: true, data: output() } });
    const loadHistory = jest.fn().mockResolvedValue([{ role: 'user', content: '上一題' }]);
    const loadFileInput = jest.fn().mockResolvedValue('合約內容');
    const tool = await createTarsPluginTool({
      toolName: 'tars_plugin_summarize_text',
      tarsUserId: 'tars-user-1',
      librechatUserId: 'lc-user',
      dataFiles: [{ id: 'file-x', filename: 'x.xlsx' }],
      loadFileInput,
      loadHistory,
    });
    expect(loadHistory).not.toHaveBeenCalled();
    expect(loadFileInput).not.toHaveBeenCalled();
    await tool?.invoke({});

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/summarize_text/stream'),
    );
    const body = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(body.settings.data_files).toBeUndefined();
    expect(JSON.parse(body.settings.data_file_refs)).toEqual([
      {
        id: 'file-x',
        filename: 'x.xlsx',
        path: expect.stringMatching(/^\/api\/tars\/files\/file-x\?u=lc-user&exp=\d+&sig=/),
      },
    ]);
    expect(body.settings.file_input).toBe('合約內容');
    expect(body.history).toEqual([{ role: 'user', content: '上一題' }]);
  });

  it('runs without history when reading it fails', async () => {
    mockBackend({ status: 200, body: { success: true, data: output({ content: 'ok' }) } });
    const tool = await createTarsPluginTool({
      toolName: 'tars_plugin_summarize_text',
      tarsUserId: 'u1',
      loadHistory: () => Promise.reject(new Error('mongo down')),
    });
    await expect(tool?.invoke({})).resolves.toBe('ok');
  });

  it('runs without file_input when reading the attachments fails', async () => {
    const fetchMock = mockBackend({ status: 200, body: { success: true, data: output() } });
    const tool = await createTarsPluginTool({
      toolName: 'tars_plugin_summarize_text',
      tarsUserId: 'tars-user-1',
      loadFileInput: () => Promise.reject(new Error('mongo down')),
    });
    await tool?.invoke({});

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/summarize_text/stream'),
    );
    const body = JSON.parse(String((call?.[1] as RequestInit).body));
    expect(body.settings).not.toHaveProperty('file_input');
    expect(body.settings).not.toHaveProperty('data_file_refs');
  });

  it('puts an ends_turn answer on the card and tells the model not to retell it', async () => {
    process.env.JWT_SECRET = 'relay-test-secret';
    const link = 'http://202.5.253.240:85/static/generate_output/cal/r.xlsx';
    mockBackend({
      status: 200,
      body: {
        success: true,
        data: output({
          content: '| 案號 | Subject |',
          final_text: `## 結果\n[下載](${link})\n| 案號 | Subject |`,
          summary: '5 cases, 0 failed',
          end_turn: true,
          artifacts: { file_url: link },
        }),
      },
    });
    const tool = await createTarsPluginTool({
      toolName: 'tars_plugin_summarize_text',
      tarsUserId: 'u1',
    });
    const message = await tool!.invoke({
      id: 'call-1',
      name: 'tars_plugin_summarize_text',
      type: 'tool_call',
      args: {},
    });

    expect(message.content).toMatch(/^The tool has already shown the user its complete answer/);
    expect(message.content).toContain('/api/tars/static/generate_output/cal/r.xlsx?sig=');
    const step = message.artifact?.[Tools.tars_trace]?.step;
    expect(step).toEqual({
      tool: 'summarize_text',
      ok: true,
      title: 'Summarize Text',
      summary: '5 cases, 0 failed',
      links: [{ type: 'file', url: expect.stringMatching(/^\/api\/tars\/static\/.+\?sig=/) }],
      answer: expect.stringMatching(
        /^## 結果\n\[下載\]\(\/api\/tars\/static\/[\s\S]+\| 案號 \| Subject \|$/,
      ),
    });
    delete process.env.JWT_SECRET;
  });

  it('keeps an ordinary plugin result for the model and off the card', async () => {
    mockBackend({ status: 200, body: { success: true, data: output({ content: 'words: 3' }) } });
    const tool = await createTarsPluginTool({
      toolName: 'tars_plugin_summarize_text',
      tarsUserId: 'u1',
    });
    const message = await tool!.invoke({
      id: 'call-1',
      name: 'tars_plugin_summarize_text',
      type: 'tool_call',
      args: {},
    });
    expect(message.content).toBe('words: 3');
    expect(message.artifact?.[Tools.tars_trace]?.step).toEqual({
      tool: 'summarize_text',
      ok: true,
      title: 'Summarize Text',
    });
  });

  it('refuses for an account not linked to pwc_tars without calling it', async () => {
    const fetchMock = mockBackend({ status: 200, body: {} });
    const tool = await createTarsPluginTool({ toolName: 'tars_plugin_summarize_text' });
    await expect(tool?.invoke({})).resolves.toMatch(/not linked to pwc_tars/);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/summarize_text/stream')),
    ).toBe(false);
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
