jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import type { AppConfig } from '@librechat/data-schemas';
import {
  getTarsEmbeddingUsageConfig,
  createTarsEmbeddingUsageClient,
  parseTarsEmbeddingUsageRequest,
} from './embedding';
import { invalidateTarsSysConfigCache } from './sysconfig';
import { langflowServiceFetch } from './langflow/client';

const BASE_URL = 'http://tars.test';
const RANGE = { start_date: '2026-10-01', end_date: '2026-10-07' };
const DEFAULTS = { reportTimeoutMs: 60_000, messageTimeoutMs: 15_000 };
const client = createTarsEmbeddingUsageClient({ request: langflowServiceFetch, config: DEFAULTS });

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const SYS_CONFIG_PATH = '/api/settings/list_sys_configs';

/** pwc_tars with the service key configured, answering the usage route with `usage`. */
const mockBackend = (usage: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    if (String(input).includes(SYS_CONFIG_PATH)) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'service-key', status: 'active' },
      ]);
    }
    return buildResponse(usage.status, usage.body);
  });

/** The usage call, skipping the sys_config lookup that resolves the service key. */
const usageCall = (fetchMock: jest.SpyInstance) => {
  const call = fetchMock.mock.calls.find(([input]) => !String(input).includes(SYS_CONFIG_PATH));
  if (!call) {
    throw new Error('the usage route was not called');
  }
  return {
    url: new URL(String(call[0])),
    init: call[1] as RequestInit,
    headers: (call[1] as RequestInit).headers as Record<string, string>,
  };
};

describe('embedding usage service', () => {
  beforeEach(() => {
    process.env.TARS_AUTH_URL = BASE_URL;
    process.env.TARS_JWT_SECRET = 'test-secret';
    invalidateTarsSysConfigCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the summary from the langflow-service route with the service key', async () => {
    const summary = {
      group_by: 'day',
      split_by: 'model',
      start_date: '2026-10-01',
      end_date: '2026-10-07',
      rows: [],
      totals: { input_tokens: 0, request_count: 0, text_count: 0, usage_rows: 0 },
      rows_cut_off: false,
    };
    const fetchMock = mockBackend({ status: 200, body: { success: true, data: summary } });

    const result = await client.fetchSummary({
      group_by: 'day',
      split_by: 'model',
      start_date: '2026-10-01',
      end_date: '2026-10-07',
    });

    expect(result).toEqual(summary);
    const { url, init, headers } = usageCall(fetchMock);
    expect(init.method).toBe('GET');
    expect(url.pathname).toBe('/api/langflow-service/embedding-usage/summary');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      group_by: 'day',
      split_by: 'model',
      start_date: '2026-10-01',
      end_date: '2026-10-07',
    });
    expect(headers['X-TARS-Service-Key']).toBe('service-key');
    // The service key is the only credential; no user acts on pwc_tars here.
    expect(headers.Authorization).toBeUndefined();
  });

  it('drops split_by unless the report is grouped by day', async () => {
    const fetchMock = mockBackend({ status: 200, body: { success: true, data: {} } });

    await client.fetchSummary({
      group_by: 'model',
      split_by: 'purpose',
      start_date: '2026-10-01',
      end_date: '2026-10-07',
    });

    expect(usageCall(fetchMock).url.searchParams.has('split_by')).toBe(false);
  });

  it('sends the user group and user filters on', async () => {
    const fetchMock = mockBackend({ status: 200, body: { success: true, data: {} } });

    await client.fetchSummary({
      group_by: 'model',
      start_date: '2026-10-01',
      end_date: '2026-10-07',
      user_group_ids: ['7', '9'],
      user_id: 'u-1',
    });

    const { searchParams } = usageCall(fetchMock).url;
    expect(searchParams.get('user_group_ids')).toBe('7,9');
    expect(searchParams.get('user_id')).toBe('u-1');
  });

  it('reads the filters from a query string, dropping blank ones', () => {
    expect(
      parseTarsEmbeddingUsageRequest(RANGE, { user_group_ids: '7, 9,', user_id: ' u-1 ' }).query,
    ).toEqual({ ...RANGE, group_by: 'model', user_group_ids: ['7', '9'], user_id: 'u-1' });
    expect(
      parseTarsEmbeddingUsageRequest(RANGE, { user_group_ids: ['7', '8,9'] }).query?.user_group_ids,
    ).toEqual(['7', '8', '9']);
    expect(
      parseTarsEmbeddingUsageRequest(RANGE, { user_group_ids: ' , ', user_id: '' }).query,
    ).toMatchObject({ user_group_ids: undefined, user_id: undefined });
  });

  it('refuses what pwc_tars would refuse before calling it', () => {
    expect(
      parseTarsEmbeddingUsageRequest({ start_date: '2025-10-01', end_date: '2026-10-02' }, {})
        .error,
    ).toBe('The range may cover at most 366 days');
    expect(parseTarsEmbeddingUsageRequest(RANGE, { group_by: 'user' }).error).toBe(
      'Unknown group_by',
    );
    expect(
      parseTarsEmbeddingUsageRequest(RANGE, { group_by: 'model', split_by: 'purpose' }).error,
    ).toBe('split_by only applies to a daily report');
    expect(parseTarsEmbeddingUsageRequest(RANGE, { group_by: 'day', split_by: 'day' }).error).toBe(
      'split_by only applies to a daily report',
    );
    expect(
      parseTarsEmbeddingUsageRequest(RANGE, { group_by: 'day', split_by: 'knowledge_base' }).query,
    ).toEqual({ ...RANGE, group_by: 'day', split_by: 'knowledge_base' });
  });

  it('waits as long as librechat.yaml says, falling back to the defaults', async () => {
    const appConfig = (tarsEmbeddingUsage: unknown) =>
      ({ config: { tarsEmbeddingUsage } }) as Pick<AppConfig, 'config'>;
    expect(getTarsEmbeddingUsageConfig()).toEqual({
      reportTimeoutMs: 60_000,
      messageTimeoutMs: 15_000,
    });
    expect(getTarsEmbeddingUsageConfig(appConfig({ reportTimeoutMs: 120_000 }))).toEqual({
      reportTimeoutMs: 120_000,
      messageTimeoutMs: 15_000,
    });
    expect(getTarsEmbeddingUsageConfig(appConfig({ reportTimeoutMs: 1 })).reportTimeoutMs).toBe(
      60_000,
    );
  });

  it('calls pwc_tars through the request it is given, with the configured timeouts', async () => {
    const request = jest.fn().mockResolvedValue({ message_id: 'm-1', rows: [] });
    const configured = createTarsEmbeddingUsageClient({
      request,
      config: { reportTimeoutMs: 90_000, messageTimeoutMs: 4_000 },
    });

    await configured.fetchMessage('m-1');
    await configured.fetchSummary({ ...RANGE, group_by: 'model' });

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/langflow-service/embedding-usage/messages/m-1',
      { method: 'GET', timeoutMs: 4_000 },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/langflow-service/embedding-usage/summary',
      expect.objectContaining({ method: 'GET', timeoutMs: 90_000 }),
    );
  });

  it('reads one message by its id', async () => {
    const fetchMock = mockBackend({
      status: 200,
      body: { success: true, data: { message_id: 'm/1', rows: [] } },
    });

    await expect(client.fetchMessage('m/1')).resolves.toEqual({
      message_id: 'm/1',
      rows: [],
    });
    expect(usageCall(fetchMock).url.pathname).toBe(
      '/api/langflow-service/embedding-usage/messages/m%2F1',
    );
  });

  it('fails when pwc_tars answers without data', async () => {
    mockBackend({ status: 200, body: { success: true } });

    await expect(client.fetchMessage('m-1')).rejects.toThrow(
      'pwc_tars returned no embedding usage of the message',
    );
  });

  it('fails without calling pwc_tars when the service key is not configured', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, []));

    await expect(
      client.fetchSummary({
        group_by: 'model',
        start_date: '2026-10-01',
        end_date: '2026-10-07',
      }),
    ).rejects.toThrow('service key is not configured');
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes(SYS_CONFIG_PATH))).toBe(
      true,
    );
  });
});
