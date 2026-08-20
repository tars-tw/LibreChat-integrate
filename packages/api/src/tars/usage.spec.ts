jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { fetchTarsProviderUsage } from './usage';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const urlOf = (fetchMock: jest.SpyInstance): string => String(fetchMock.mock.calls[0][0]);

describe('fetchTarsProviderUsage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls the provider-specific pwc_tars endpoint', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { costs: { total: 1 } }));

    await fetchTarsProviderUsage('anthropic', { month: '2026-07' }, BASE_URL);

    expect(urlOf(fetchMock)).toContain('/api/settings/anthropic/get_usage');
    expect(urlOf(fetchMock)).toContain('month=2026-07');
  });

  /** A budget of zero is a real setting; only an absent one may be dropped. */
  it('forwards a zero budget but omits an absent one', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { costs: { total: 0 } }));

    await fetchTarsProviderUsage('openai', { month: '2026-07', budget: 0 }, BASE_URL);
    expect(urlOf(fetchMock)).toContain('budget=0');

    fetchMock.mockClear();
    await fetchTarsProviderUsage('openai', { month: '2026-07' }, BASE_URL);
    expect(urlOf(fetchMock)).not.toContain('budget');
  });

  it('relays the pwc_tars failure message', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { error: '系統未配置 OpenAI Price Query API Key' }));

    await expect(
      fetchTarsProviderUsage('openai', { month: '2026-07' }, BASE_URL),
    ).rejects.toMatchObject({
      status: 400,
      serverMessage: '系統未配置 OpenAI Price Query API Key',
    });
  });
});
