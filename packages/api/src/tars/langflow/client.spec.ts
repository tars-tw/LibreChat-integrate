jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { Tools } from 'librechat-data-provider';
import type { LangflowCapabilityData } from './client';
import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { rewriteTarsAssetLinks } from '~/tars/assets';
import {
  langflowTimeoutMs,
  langflowToolResult,
  toTarsTraceArtifact,
  tarsUsageAttribution,
  runLangflowCapability,
  resolveLangflowModelName,
  resolveLangflowServiceKey,
} from './client';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const mockBackend = (capability: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/settings/list_sys_configs')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'from-sysconfig', status: 'active' },
      ]);
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gpt-5.4-mini' }, { model_name: 'gpt-5.5' }]);
    }
    if (url.includes('/api/langflow-service/')) {
      return buildResponse(capability.status, capability.body);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  delete process.env.TARS_TEST_TIMEOUT_MS;
  invalidateTarsSysConfigCache();
  invalidateTarsModelProfilesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveLangflowServiceKey', () => {
  it('reads the KEY_LANGFLOW_API_KEY sys_config row', async () => {
    mockBackend({ status: 200, body: {} });
    await expect(resolveLangflowServiceKey()).resolves.toBe('from-sysconfig');
  });

  it('resolves undefined when pwc_tars has no key configured', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, []));
    await expect(resolveLangflowServiceKey()).resolves.toBeUndefined();
  });
});

describe('resolveLangflowModelName', () => {
  it('matches the chat model against model_profile names case-insensitively', async () => {
    mockBackend({ status: 200, body: {} });
    await expect(resolveLangflowModelName('GPT-5.4-MINI')).resolves.toBe('gpt-5.4-mini');
  });

  it('returns undefined for an unmatched model so pwc_tars falls back to its default', async () => {
    mockBackend({ status: 200, body: {} });
    await expect(resolveLangflowModelName('claude-nonexistent')).resolves.toBeUndefined();
  });

  it('returns undefined without a chat model', async () => {
    await expect(resolveLangflowModelName(undefined)).resolves.toBeUndefined();
  });
});

describe('runLangflowCapability', () => {
  it('sends the service key header and unwraps the data envelope', async () => {
    const fetchMock = mockBackend({
      status: 200,
      body: { success: true, data: { answer: 'hi', mode: 'chart', chart_url: 'http://x/c.png' } },
    });

    const data = await runLangflowCapability(
      '/api/langflow-service/chart',
      { query: 'q' },
      { timeoutMs: 1000 },
    );
    expect(data).toEqual({ answer: 'hi', mode: 'chart', chart_url: 'http://x/c.png' });

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/chart'),
    );
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-TARS-Service-Key']).toBe('from-sysconfig');
    /** pwc_tars carries no models of its own, so the gateway is never opt-in. */
    expect(headers['X-Use-Librechat-Gateway']).toBe('true');
    expect(headers['X-Librechat-User-Id']).toBeUndefined();
  });

  it('names the acting user so the gateway bills them rather than the service account', async () => {
    const fetchMock = mockBackend({ status: 200, body: { success: true, data: {} } });

    await runLangflowCapability(
      '/api/langflow-service/data',
      { query: 'q' },
      { timeoutMs: 1000, librechatUserId: 'lc-1' },
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/data'),
    );
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Use-Librechat-Gateway']).toBe('true');
    expect(headers['X-Librechat-User-Id']).toBe('lc-1');
  });

  it('names the chat the call serves so pwc_tars files its embedding usage under it', async () => {
    const fetchMock = mockBackend({ status: 200, body: { success: true, data: {} } });

    await runLangflowCapability(
      '/api/langflow-service/rag',
      { query: 'q' },
      {
        timeoutMs: 1000,
        usage: tarsUsageAttribution(7, {
          configurable: { requestBody: { messageId: 'response-1' } },
        }),
      },
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/rag'),
    );
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-TARS-Domain-Id']).toBe('7');
    expect(headers['X-TARS-Message-Id']).toBe('response-1');
  });

  it('sends no usage headers when the call serves no chat message', async () => {
    const fetchMock = mockBackend({ status: 200, body: { success: true, data: {} } });

    await runLangflowCapability(
      '/api/langflow-service/rag',
      { query: 'q' },
      { timeoutMs: 1000, usage: tarsUsageAttribution('', { configurable: {} }) },
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/rag'),
    );
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-TARS-Domain-Id']).toBeUndefined();
    expect(headers['X-TARS-Message-Id']).toBeUndefined();
  });

  it('throws before calling pwc_tars when no service key is configured', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/settings/list_sys_configs')) {
        return buildResponse(200, []);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await expect(
      runLangflowCapability('/api/langflow-service/chart', { query: 'q' }, { timeoutMs: 1000 }),
    ).rejects.toThrow(/service key is not configured/);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/langflow-service/')),
    ).toBe(false);
  });

  it('surfaces the pwc_tars failure message on non-2xx', async () => {
    mockBackend({ status: 404, body: { message: '找不到可用的資料檔' } });

    await expect(
      runLangflowCapability('/api/langflow-service/data', { query: 'q' }, { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ status: 404, serverMessage: '找不到可用的資料檔' });
  });
});

describe('env helpers', () => {
  it('parses timeouts with a fallback', () => {
    expect(langflowTimeoutMs('TARS_TEST_TIMEOUT_MS', 1234)).toBe(1234);
    process.env.TARS_TEST_TIMEOUT_MS = '5000';
    expect(langflowTimeoutMs('TARS_TEST_TIMEOUT_MS', 1234)).toBe(5000);
    process.env.TARS_TEST_TIMEOUT_MS = 'abc';
    expect(langflowTimeoutMs('TARS_TEST_TIMEOUT_MS', 1234)).toBe(1234);
  });
});

describe('run trace artifact', () => {
  const trace = [
    { type: 'turn' as const, turn: 1 },
    { type: 'tool_call' as const, id: 'c1', name: 'sql_query', input: { sql: 'SELECT 1' } },
  ];

  it('carries the trace pwc_tars reported, with the run facts beside it', () => {
    expect(
      toTarsTraceArtifact({ answer: 'a', mode: 'sql', model_name: 'm', sql: 'SELECT 1', trace }),
    ).toEqual({ trace, mode: 'sql', model_name: 'm', tokens: undefined, sql: 'SELECT 1' });
  });

  it('relays pwc_tars static links inside tool outputs and notes', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'trace-test-secret';
    const raw = 'http://tars.test/static/generate_output/kb/topics_結果.xlsx';
    const artifact = toTarsTraceArtifact({
      answer: 'a',
      trace: [
        {
          type: 'tool_result',
          id: 'c1',
          name: 'run_table_task',
          ok: true,
          output: `[下載](${raw})`,
        },
        { type: 'text', turn: 1, text: `see ${raw}` },
        { type: 'tool_call', id: 'c1', name: 'run_table_task', input: {} },
      ],
    });
    const [result, note, call] = artifact?.trace ?? [];
    expect(result.type === 'tool_result' && result.output).toContain(
      '/api/tars/static/generate_output/',
    );
    expect(result.type === 'tool_result' && result.output).not.toContain('tars.test/static');
    expect(note.type === 'text' && note.text).toContain('/api/tars/static/');
    expect(call).toEqual({ type: 'tool_call', id: 'c1', name: 'run_table_task', input: {} });
  });

  it('is absent when pwc_tars sent no trace, so nothing is attached', () => {
    expect(toTarsTraceArtifact({ answer: 'a' })).toBeUndefined();
    expect(toTarsTraceArtifact({ answer: 'a', trace: [] })).toBeUndefined();
    expect(toTarsTraceArtifact(undefined)).toBeUndefined();
  });

  it('lists each generated chart and file once, relayed', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'trace-test-secret';
    const file = 'http://tars.test/static/generate_output/kb/report_ab12cd.xlsx';
    const chart = 'http://tars.test/static/quickchart/kb/chart_1.png';
    const artifact = toTarsTraceArtifact({
      answer: 'a',
      trace,
      generated_urls: [
        { type: 'chart', url: chart },
        { type: 'file', url: file },
      ],
      /** Already relayed by `runLangflowCapability`, so it must collapse into the entry above. */
      file_url: rewriteTarsAssetLinks(file),
    });

    expect(artifact?.links).toEqual([
      { type: 'chart', url: rewriteTarsAssetLinks(chart) },
      { type: 'file', url: rewriteTarsAssetLinks(file) },
    ]);
    expect(artifact?.links?.every((link) => link.url.startsWith('/api/tars/static/'))).toBe(true);
  });

  it('skips malformed generated_urls instead of failing the reply', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'trace-test-secret';
    const file = 'http://tars.test/static/generate_output/kb/report_ab12cd.xlsx';
    const malformed = [null, { type: 'file' }, { type: 'file', url: file }];

    expect(
      toTarsTraceArtifact({
        answer: 'a',
        trace,
        generated_urls: malformed as unknown as LangflowCapabilityData['generated_urls'],
      })?.links,
    ).toEqual([{ type: 'file', url: rewriteTarsAssetLinks(file) }]);
    expect(
      toTarsTraceArtifact({
        answer: 'a',
        trace,
        generated_urls: {} as unknown as LangflowCapabilityData['generated_urls'],
      }),
    ).not.toHaveProperty('links');
  });

  it('keeps a reply that generated a file without reporting a trace', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'trace-test-secret';
    const file = 'http://tars.test/static/generate_output/kb/report_ab12cd.xlsx';
    expect(toTarsTraceArtifact({ answer: 'a', file_url: file })).toMatchObject({
      trace: [],
      links: [{ type: 'file', url: rewriteTarsAssetLinks(file) }],
    });
  });

  it('shapes the content_and_artifact tuple the tool-end callback expects', () => {
    const artifact = { trace };
    expect(langflowToolResult('answer', artifact)).toEqual([
      'answer',
      { [Tools.tars_trace]: artifact },
    ]);
    expect(langflowToolResult('failed')).toEqual(['failed', undefined]);
  });
});
