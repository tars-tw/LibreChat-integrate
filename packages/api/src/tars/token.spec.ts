jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsTokenConfigs,
  createTarsTokenConfig,
  updateTarsTokenConfig,
  deleteTarsTokenConfig,
  fetchTarsTokenUserQuotas,
  fetchTarsTokenPrepareData,
  updateTarsTokenSystemDefault,
} from './token';

const BASE_URL = 'http://tars.test';
const ACTOR = { tarsId: '42' };

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const urlOf = (fetchMock: jest.SpyInstance): string => String(fetchMock.mock.calls[0][0]);
const initOf = (fetchMock: jest.SpyInstance): RequestInit =>
  fetchMock.mock.calls[0][1] as RequestInit;
const bodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> =>
  JSON.parse(initOf(fetchMock).body as string);

describe('token quota service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('unwraps the pwc_tars envelope', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: [{ id: 'c1', provider: 'openai' }],
        total: 1,
      }),
    );
    await expect(fetchTarsTokenConfigs({}, BASE_URL)).resolves.toEqual([
      { id: 'c1', provider: 'openai' },
    ]);
  });

  /** An envelope without `data` must read as "no rows", never as undefined. */
  it('falls back to empty collections', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true }));
    await expect(fetchTarsTokenUserQuotas({}, BASE_URL)).resolves.toEqual([]);

    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true }));
    await expect(fetchTarsTokenPrepareData(BASE_URL)).resolves.toEqual({
      groups: [],
      domains: [],
    });
  });

  it('passes filters through as query parameters', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { data: [] }));

    await fetchTarsTokenConfigs({ provider: 'openai', is_active: true }, BASE_URL);

    expect(urlOf(fetchMock)).toContain('provider=openai');
    expect(urlOf(fetchMock)).toContain('is_active=true');
  });

  it('stamps the acting admin onto writes', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(201, { data: { id: 'c1' } }));

    await createTarsTokenConfig(ACTOR, { domain_id: '1', user_group_id: '2' }, BASE_URL);
    expect(bodyOf(fetchMock)).toMatchObject({ created_by: '42' });

    fetchMock.mockClear();
    await updateTarsTokenConfig(ACTOR, 'c1', { default_user_limit: 100 }, BASE_URL);
    expect(bodyOf(fetchMock)).toMatchObject({ updated_by: '42' });

    fetchMock.mockClear();
    await updateTarsTokenSystemDefault(ACTOR, { provider: 'openai' }, BASE_URL);
    expect(bodyOf(fetchMock)).toMatchObject({ provider: 'openai', updated_by: '42' });
  });

  /** Ids reach the URL path, so anything unusual in one must not escape it. */
  it('encodes ids into the path', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    await deleteTarsTokenConfig('a/b', BASE_URL);

    expect(urlOf(fetchMock)).toContain('/delete_token_config/a%2Fb');
    expect(initOf(fetchMock).method).toBe('DELETE');
  });

  it('relays the pwc_tars conflict message', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(409, { error: '此 Domain × 群組 × 供應商 的設定已存在' }));

    await expect(
      createTarsTokenConfig(ACTOR, { domain_id: '1', user_group_id: '2' }, BASE_URL),
    ).rejects.toMatchObject({
      status: 409,
      serverMessage: '此 Domain × 群組 × 供應商 的設定已存在',
    });
  });
});
