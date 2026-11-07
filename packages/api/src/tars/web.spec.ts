jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import {
  AuthType,
  SearchProviders,
  ScraperProviders,
  RerankerTypes,
} from 'librechat-data-provider';
import type { TCustomConfig } from 'librechat-data-provider';
import { loadTarsWebSearchAuth, resolveTarsWebSearchAuthValues } from './web';
import { invalidateTarsSysConfigCache } from './sysconfig';

const BASE_URL = 'http://tars.test';

const tavilyOnly: TCustomConfig['webSearch'] = {
  tavilyApiKey: '${tars:KEY_TAVILY}',
  tavilySearchUrl: '${TAVILY_SEARCH_URL}',
  tavilyExtractUrl: '${TAVILY_EXTRACT_URL}',
  searchProvider: SearchProviders.TAVILY,
  scraperProvider: ScraperProviders.TAVILY,
  rerankerType: RerankerTypes.NONE,
};

const sysConfigRows = (value: string | null) => [
  { key: 'KEY_TAVILY', value, status: 'active' },
  { key: 'KEY_OPEN_AI_API', value: 'sk-unrelated', status: 'active' },
];

const mockSysConfig = (value: string | null) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => sysConfigRows(value),
  } as Response);

const loadAuthValues = jest.fn(async ({ authFields }: { authFields: string[] }) =>
  Object.fromEntries(authFields.map((field) => [field, ''])),
);

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsSysConfigCache();
  loadAuthValues.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.TARS_AUTH_URL;
});

describe('resolveTarsWebSearchAuthValues', () => {
  it('maps each ${tars:KEY} reference to its sys_config value', async () => {
    mockSysConfig(' tvly-123 ');
    const values = await resolveTarsWebSearchAuthValues(tavilyOnly);
    expect([...values]).toEqual([['tars:KEY_TAVILY', 'tvly-123']]);
  });

  it('maps an unset row to undefined', async () => {
    mockSysConfig('DEFAULT');
    const values = await resolveTarsWebSearchAuthValues(tavilyOnly);
    expect([...values]).toEqual([['tars:KEY_TAVILY', undefined]]);
  });

  it('skips the fetch when no key references sys_config', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const values = await resolveTarsWebSearchAuthValues({ tavilyApiKey: '${TAVILY_API_KEY}' });
    expect(values.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('loadTarsWebSearchAuth', () => {
  it('authenticates Tavily from KEY_TAVILY as system-defined', async () => {
    mockSysConfig('tvly-123');
    const result = await loadTarsWebSearchAuth({
      userId: 'user-1',
      webSearchConfig: tavilyOnly,
      loadAuthValues,
    });
    expect(result.authenticated).toBe(true);
    expect(result.authResult.tavilyApiKey).toBe('tvly-123');
    expect(result.authTypes.every(([, type]) => type === AuthType.SYSTEM_DEFINED)).toBe(true);
  });

  it('is unauthenticated while KEY_TAVILY is unset', async () => {
    mockSysConfig('');
    const result = await loadTarsWebSearchAuth({
      userId: 'user-1',
      webSearchConfig: tavilyOnly,
      loadAuthValues,
    });
    expect(result.authenticated).toBe(false);
  });

  it('reports an unset KEY_TAVILY as system-defined and names Tavily, so no one is asked for it', async () => {
    mockSysConfig(null);
    const result = await loadTarsWebSearchAuth({
      userId: 'user-1',
      webSearchConfig: tavilyOnly,
      loadAuthValues,
    });
    expect(result.authenticated).toBe(false);
    expect(result.missingKeyProvider).toBe('Tavily');
    expect(result.authTypes).toEqual([
      ['providers', AuthType.SYSTEM_DEFINED],
      ['scrapers', AuthType.SYSTEM_DEFINED],
      ['rerankers', AuthType.SYSTEM_DEFINED],
    ]);
  });

  it('names no missing key once KEY_TAVILY is set', async () => {
    mockSysConfig('tvly-123');
    const result = await loadTarsWebSearchAuth({
      userId: 'user-1',
      webSearchConfig: tavilyOnly,
      loadAuthValues,
    });
    expect(result.missingKeyProvider).toBeUndefined();
  });

  it('leaves a category on a user-provided key asking the user', async () => {
    mockSysConfig(null);
    const result = await loadTarsWebSearchAuth({
      userId: 'user-1',
      webSearchConfig: {
        ...tavilyOnly,
        scraperProvider: ScraperProviders.FIRECRAWL,
        firecrawlApiKey: '${FIRECRAWL_API_KEY}',
      },
      loadAuthValues,
    });
    expect(result.missingKeyProvider).toBe('Tavily');
    expect(result.authTypes).toEqual([
      ['providers', AuthType.SYSTEM_DEFINED],
      ['scrapers', AuthType.USER_PROVIDED],
      ['rerankers', AuthType.SYSTEM_DEFINED],
    ]);
  });

  it('keeps the upstream result when no key references sys_config', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await loadTarsWebSearchAuth({
      userId: 'user-1',
      webSearchConfig: { ...tavilyOnly, tavilyApiKey: '${TAVILY_API_KEY}' },
      loadAuthValues,
    });
    expect(result.missingKeyProvider).toBeUndefined();
    expect(result.authTypes.some(([, type]) => type === AuthType.USER_PROVIDED)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
