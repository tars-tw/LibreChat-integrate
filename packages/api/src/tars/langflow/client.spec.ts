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
  langflowTimeoutMs,
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
    if (url.includes('/api/sys_config/prepare_data')) {
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

  it('throws before calling pwc_tars when no service key is configured', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/sys_config/prepare_data')) {
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
