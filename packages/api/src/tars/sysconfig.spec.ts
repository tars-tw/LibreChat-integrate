jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { EModelEndpoint } from 'librechat-data-provider';
import {
  fetchTarsSysConfigs,
  updateTarsSysConfig,
  getTarsProviderApiKey,
  resolveTarsProviderKey,
  invalidateTarsSysConfigCache,
} from './sysconfig';
import type { TarsSysConfig } from './sysconfig';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const row = (key: string, value: string | null, status = 'active'): TarsSysConfig => ({
  id: 1,
  category: 'endpoints',
  key,
  value,
  type: 'string',
  description: null,
  status,
  is_displayed: true,
  created_by: 'u1',
  created_name: 'admin',
  updated_by: null,
  updated_name: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: null,
});

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsSysConfigCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete process.env.TARS_AUTH_URL;
});

describe('fetchTarsSysConfigs', () => {
  it('requests prepare_data and returns the bare array', async () => {
    const rows = [row('KEY_OPEN_AI_API', 'sk-live')];
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, rows));

    const result = await fetchTarsSysConfigs(BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/sys_config/prepare_data`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(rows);
  });

  it('defaults to [] when the response body is null', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, null));
    await expect(fetchTarsSysConfigs(BASE_URL)).resolves.toEqual([]);
  });
});

describe('updateTarsSysConfig', () => {
  it('sends the update payload with updated_by/updated_name', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: '更新成功' }));

    await updateTarsSysConfig(
      { tarsId: 'u1', name: 'admin' },
      { key: 'KEY_OPEN_AI_API', value: 'sk-new', description: 'OpenAI key', status: 'active' },
      BASE_URL,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/sys_config/update_sys_config`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          key: 'KEY_OPEN_AI_API',
          value: 'sk-new',
          description: 'OpenAI key',
          status: 'active',
          updated_by: 'u1',
          updated_name: 'admin',
        }),
      }),
    );
  });

  it('invalidates the key cache so the next lookup refetches', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, [row('KEY_OPEN_AI_API', 'sk-old')]));

    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-old');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(buildResponse(200, { message: '更新成功' }));
    await updateTarsSysConfig({ tarsId: 'u1', name: 'admin' }, { key: 'KEY_OPEN_AI_API' });

    fetchMock.mockResolvedValueOnce(buildResponse(200, [row('KEY_OPEN_AI_API', 'sk-new')]));
    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-new');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('getTarsProviderApiKey', () => {
  it('returns undefined without fetching when TARS is unconfigured', async () => {
    delete process.env.TARS_AUTH_URL;
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps each provider to its sys_config key', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(200, [
          row('KEY_OPEN_AI_API', 'sk-openai'),
          row('KEY_ANTHROPIC_API', 'sk-anthropic'),
          row('KEY_GEMINI_API', 'sk-gemini'),
        ]),
      );

    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-openai');
    await expect(getTarsProviderApiKey(EModelEndpoint.anthropic)).resolves.toBe('sk-anthropic');
    await expect(getTarsProviderApiKey(EModelEndpoint.google)).resolves.toBe('sk-gemini');
  });

  it('ignores inactive, empty, whitespace and DEFAULT values', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(200, [
          row('KEY_OPEN_AI_API', 'sk-live', 'inactive'),
          row('KEY_ANTHROPIC_API', '   '),
          row('KEY_GEMINI_API', 'Default'),
        ]),
      );

    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBeUndefined();
    await expect(getTarsProviderApiKey(EModelEndpoint.anthropic)).resolves.toBeUndefined();
    await expect(getTarsProviderApiKey(EModelEndpoint.google)).resolves.toBeUndefined();
  });

  it('trims values', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, [row('KEY_OPEN_AI_API', '  sk-live  ')]));
    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-live');
  });

  it('serves from cache within the TTL and refetches after it expires', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, [row('KEY_OPEN_AI_API', 'sk-live')]));

    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-live');
    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-live');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(31_000);
    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-live');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight fetch across concurrent lookups', async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));

    const lookups = Promise.all([
      getTarsProviderApiKey(EModelEndpoint.openAI),
      getTarsProviderApiKey(EModelEndpoint.anthropic),
      getTarsProviderApiKey(EModelEndpoint.openAI),
    ]);
    resolveFetch(buildResponse(200, [row('KEY_OPEN_AI_API', 'sk-live')]));

    await expect(lookups).resolves.toEqual(['sk-live', undefined, 'sk-live']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined without throwing when the fetch fails on a cold cache', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBeUndefined();
    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves stale values when a refresh fails on a warm cache', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, [row('KEY_OPEN_AI_API', 'sk-live')]));

    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-live');

    jest.advanceTimersByTime(31_000);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(getTarsProviderApiKey(EModelEndpoint.openAI)).resolves.toBe('sk-live');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('resolveTarsProviderKey', () => {
  it('passes the user_provided sentinel through without consulting pwc_tars', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(resolveTarsProviderKey('user_provided', EModelEndpoint.openAI)).resolves.toBe(
      'user_provided',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the sys_config value over the env value', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, [row('KEY_OPEN_AI_API', 'sk-tars')]));
    await expect(resolveTarsProviderKey('sk-env', EModelEndpoint.openAI)).resolves.toBe('sk-tars');
  });

  it('falls back to the env value when sys_config has no usable key', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, []));
    await expect(resolveTarsProviderKey('sk-env', EModelEndpoint.openAI)).resolves.toBe('sk-env');
  });
});
