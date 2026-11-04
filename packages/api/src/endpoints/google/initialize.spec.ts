import { Providers } from '@librechat/agents';
import { AuthKeys, EModelEndpoint } from 'librechat-data-provider';
import type { EndpointDbMethods, ServerRequest } from '~/types';

const mockGetGoogleConfig = jest.fn(
  (_credentials?: unknown, _options?: unknown, _acceptRawApiKey?: unknown) => ({
    provider: Providers.VERTEXAI,
    llmConfig: { model: 'gemini-2.5-flash' },
  }),
);
const mockIsEnabled = jest.fn();
const mockLoadServiceKey = jest.fn();
const mockCheckUserKeyExpiry = jest.fn();

jest.mock('./llm', () => ({
  getGoogleConfig: (credentials: unknown, options: unknown, acceptRawApiKey?: unknown) =>
    mockGetGoogleConfig(credentials, options, acceptRawApiKey),
}));

jest.mock('~/utils', () => ({
  ...jest.requireActual('~/utils'),
  isEnabled: (value: unknown) => mockIsEnabled(value),
  loadServiceKey: (keyPath: unknown) => mockLoadServiceKey(keyPath),
  checkUserKeyExpiry: (expiresAt: unknown, endpoint: unknown) =>
    mockCheckUserKeyExpiry(expiresAt, endpoint),
}));

const mockGetTarsProviderApiKey = jest.fn();
const mockGetTarsVertexServiceKey = jest.fn();
/**
 * Only the sysconfig and vertex modules: the whole `~/tars` barrel reaches `cacheConfig`, which
 * calls the mocked `isEnabled` at load time, before `mockIsEnabled` is initialised.
 */
jest.mock('~/tars', () => ({
  ...jest.requireActual('~/tars/sysconfig'),
  ...jest.requireActual('~/tars/vertex'),
  getTarsProviderApiKey: (...args: unknown[]) => mockGetTarsProviderApiKey(...args),
  getTarsVertexServiceKey: () => mockGetTarsVertexServiceKey(),
}));

const mockGetGoogleModels = jest.fn((): string[] => []);
/** Its module reaches `cacheConfig` too, for the same reason as above. */
jest.mock('~/endpoints/models', () => ({
  getGoogleModels: () => mockGetGoogleModels(),
}));

const mockNameVertexToolResponses = jest.fn();
jest.mock('~/agents/vertex', () => ({
  nameVertexToolResponses: () => mockNameVertexToolResponses(),
}));

import { initializeGoogle } from './initialize';

function createDb(): EndpointDbMethods {
  return {
    getUserKey: jest.fn().mockResolvedValue('user-google-key'),
    getUserKeyValues: jest.fn().mockResolvedValue({}),
  };
}

function createReq(): ServerRequest {
  return {
    body: {},
    config: {},
    user: { id: 'user-1' },
  } as ServerRequest;
}

function getGoogleConfigCall(): [Record<string, unknown>, Record<string, unknown>] {
  expect(mockGetGoogleConfig).toHaveBeenCalled();
  return mockGetGoogleConfig.mock.calls[0] as unknown as [
    Record<string, unknown>,
    Record<string, unknown>,
  ];
}

describe('initializeGoogle', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_KEY;
    delete process.env.GOOGLE_REVERSE_PROXY;
    delete process.env.GOOGLE_AUTH_HEADER;
    delete process.env.GOOGLE_SERVICE_KEY_FILE;
    delete process.env.VERTEX_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_PROJECT_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('forces Vertex AI ADC config and ignores GOOGLE_KEY for vertexai endpoint', async () => {
    process.env.GOOGLE_KEY = 'test-api-key';
    process.env.VERTEX_PROJECT_ID = 'fiery-catwalk-385918';
    mockLoadServiceKey.mockResolvedValue(null);

    const db = createDb();

    await initializeGoogle({
      req: createReq(),
      endpoint: Providers.VERTEXAI,
      model_parameters: { model: 'gemini-2.5-flash' },
      db,
    });

    expect(mockLoadServiceKey).toHaveBeenCalledTimes(1);
    expect(db.getUserKey).not.toHaveBeenCalled();
    expect(mockCheckUserKeyExpiry).not.toHaveBeenCalled();

    const [credentials, options] = getGoogleConfigCall();
    expect(credentials).toEqual({
      [AuthKeys.GOOGLE_SERVICE_KEY]: {},
    });
    expect(credentials).not.toHaveProperty(AuthKeys.GOOGLE_API_KEY);
    expect(options).toEqual(
      expect.objectContaining({
        forceVertex: true,
        projectId: 'fiery-catwalk-385918',
        modelOptions: { model: 'gemini-2.5-flash' },
      }),
    );
  });

  it('keeps Google API-key config for the google endpoint', async () => {
    process.env.GOOGLE_KEY = 'test-api-key';
    process.env.VERTEX_PROJECT_ID = 'fiery-catwalk-385918';

    await initializeGoogle({
      req: createReq(),
      endpoint: EModelEndpoint.google,
      model_parameters: { model: 'gemini-2.5-flash' },
      db: createDb(),
    });

    expect(mockLoadServiceKey).not.toHaveBeenCalled();

    const [credentials, options] = getGoogleConfigCall();
    expect(credentials).toEqual({
      [AuthKeys.GOOGLE_SERVICE_KEY]: {},
      [AuthKeys.GOOGLE_API_KEY]: 'test-api-key',
    });
    expect(options).toEqual(
      expect.objectContaining({
        forceVertex: false,
        projectId: undefined,
        modelOptions: { model: 'gemini-2.5-flash' },
      }),
    );
  });

  it('loads the stored API key when a resumed request omits expiry metadata', async () => {
    process.env.GOOGLE_KEY = 'user_provided';
    const db = createDb();

    await initializeGoogle({
      req: createReq(),
      endpoint: EModelEndpoint.google,
      model_parameters: { model: 'gemini-2.5-flash' },
      db,
    });

    expect(db.getUserKey).toHaveBeenCalledWith({
      userId: 'user-1',
      name: EModelEndpoint.google,
    });
    expect(mockCheckUserKeyExpiry).not.toHaveBeenCalled();

    const [credentials] = getGoogleConfigCall();
    expect(credentials).toBe('user-google-key');
  });

  it('resolves configured headers at init (merged over endpoints.all) before getGoogleConfig', async () => {
    process.env.GOOGLE_KEY = 'test-api-key';

    const req = {
      body: { conversationId: 'convo-9' },
      user: { id: 'user-1' },
      config: {
        endpoints: {
          all: { headers: { 'X-Common': 'all', 'X-Override': 'all' } },
          [EModelEndpoint.google]: {
            headers: {
              'X-Override': 'google',
              'X-Conversation-Id': '{{LIBRECHAT_BODY_CONVERSATIONID}}',
              'X-User-Id': '{{LIBRECHAT_USER_ID}}',
            },
          },
        },
      },
    } as unknown as ServerRequest;

    await initializeGoogle({
      req,
      endpoint: EModelEndpoint.google,
      model_parameters: { model: 'gemini-2.5-flash' },
      db: createDb(),
    });

    const [, options] = getGoogleConfigCall();
    expect(options.headers).toEqual({
      'X-Common': 'all',
      'X-Override': 'google',
      'X-Conversation-Id': 'convo-9',
      'X-User-Id': 'user-1',
    });
  });
});

describe('initializeGoogle streamRate resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_KEY = 'test-api-key';
  });

  async function initWithConfig(
    endpointsConfig: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const req = createReq();
    (req as unknown as { config: Record<string, unknown> }).config = {
      endpoints: endpointsConfig,
    };
    const result = await initializeGoogle({
      req,
      endpoint: EModelEndpoint.google,
      model_parameters: { model: 'gemini-2.5-flash' },
      db: createDb(),
    });
    return result.llmConfig as Record<string, unknown>;
  }

  it('wires the endpoint streamRate into llmConfig._lc_stream_delay', async () => {
    const llmConfig = await initWithConfig({ [EModelEndpoint.google]: { streamRate: 25 } });
    expect(llmConfig._lc_stream_delay).toBe(25);
  });

  it('preserves the endpoint streamRate when `endpoints.all` exists without one', async () => {
    const llmConfig = await initWithConfig({
      [EModelEndpoint.google]: { streamRate: 25 },
      all: { activityLabel: true },
    });
    expect(llmConfig._lc_stream_delay).toBe(25);
  });

  it('lets `endpoints.all.streamRate` override the endpoint value', async () => {
    const llmConfig = await initWithConfig({
      [EModelEndpoint.google]: { streamRate: 25 },
      all: { streamRate: 10 },
    });
    expect(llmConfig._lc_stream_delay).toBe(10);
  });

  it('lets `endpoints.all.streamRate: 0` disable smoothing explicitly', async () => {
    const llmConfig = await initWithConfig({
      [EModelEndpoint.google]: { streamRate: 25 },
      all: { streamRate: 0 },
    });
    expect(llmConfig._lc_stream_delay).toBe(0);
  });

  it('leaves the delay unset when neither level configures a streamRate', async () => {
    const llmConfig = await initWithConfig({ all: { activityLabel: true } });
    expect(llmConfig._lc_stream_delay).toBeUndefined();
  });
});

describe('initializeGoogle – sentinel key chain', () => {
  const originalEnv = process.env;
  const noUserKeyError = () => new Error(JSON.stringify({ type: 'no_user_key' }));

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GOOGLE_KEY = 'user_provided';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('prefers the stored personal key without consulting sys_config', async () => {
    const db = createDb();
    await initializeGoogle({
      req: createReq(),
      endpoint: EModelEndpoint.google,
      model_parameters: { model: 'gemini-2.5-flash' },
      db,
    });

    const [credentials] = getGoogleConfigCall();
    expect(credentials).toBe('user-google-key');
    expect(mockGetTarsProviderApiKey).not.toHaveBeenCalled();
  });

  it('falls back to the sys_config key when the user has no stored key', async () => {
    const db = createDb();
    (db.getUserKey as jest.Mock).mockRejectedValue(noUserKeyError());
    mockGetTarsProviderApiKey.mockResolvedValue('g-tars-key');

    await initializeGoogle({
      req: createReq(),
      endpoint: EModelEndpoint.google,
      model_parameters: { model: 'gemini-2.5-flash' },
      db,
    });

    const [credentials] = getGoogleConfigCall();
    expect(credentials).toEqual(
      expect.objectContaining({ [AuthKeys.GOOGLE_API_KEY]: 'g-tars-key' }),
    );
    expect(mockGetTarsProviderApiKey).toHaveBeenCalledWith(EModelEndpoint.google);
  });

  it('throws NO_USER_KEY when neither a personal key nor a sys_config key exists', async () => {
    const db = createDb();
    (db.getUserKey as jest.Mock).mockRejectedValue(noUserKeyError());
    mockGetTarsProviderApiKey.mockResolvedValue(undefined);

    await expect(
      initializeGoogle({
        req: createReq(),
        endpoint: EModelEndpoint.google,
        model_parameters: { model: 'gemini-2.5-flash' },
        db,
      }),
    ).rejects.toThrow('no_user_key');
  });

  it('rethrows non-NO_USER_KEY errors instead of masking them with sys_config', async () => {
    const db = createDb();
    (db.getUserKey as jest.Mock).mockRejectedValue(
      new Error(JSON.stringify({ type: 'invalid_user_key' })),
    );
    mockGetTarsProviderApiKey.mockResolvedValue('g-tars-key');

    await expect(
      initializeGoogle({
        req: createReq(),
        endpoint: EModelEndpoint.google,
        model_parameters: { model: 'gemini-2.5-flash' },
        db,
      }),
    ).rejects.toThrow('invalid_user_key');
  });

  it('never consults sys_config on the vertexai endpoint', async () => {
    mockLoadServiceKey.mockResolvedValue(null);
    const db = createDb();

    await initializeGoogle({
      req: createReq(),
      endpoint: Providers.VERTEXAI,
      model_parameters: { model: 'gemini-2.5-flash' },
      db,
    });

    expect(mockGetTarsProviderApiKey).not.toHaveBeenCalled();
    expect(db.getUserKey).not.toHaveBeenCalled();
  });
});

describe('initializeGoogle – pwc_tars (enterprise) models on Vertex AI', () => {
  const originalEnv = process.env;
  const serviceKey = {
    type: 'service_account',
    project_id: 'acme-gemini',
    client_email: 'tars@acme-gemini.iam.gserviceaccount.com',
    private_key: 'pk',
  };

  const initializeModel = (model: string) =>
    initializeGoogle({
      req: createReq(),
      endpoint: EModelEndpoint.google,
      model_parameters: { model },
      db: createDb(),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GOOGLE_KEY = 'user_provided';
    process.env.VERTEX_PROJECT_ID = 'env-project';
    mockGetGoogleModels.mockReturnValue([
      'gemini-3.5-flash(enterprise)',
      'gemini-2.5-pro(enterprise)',
    ]);
  });

  afterAll(() => {
    process.env = originalEnv;
    mockGetGoogleModels.mockReturnValue([]);
  });

  it('refuses an unlisted model without waiting on the key read', async () => {
    mockGetTarsVertexServiceKey.mockReturnValue(new Promise(() => undefined));

    await expect(initializeModel('gemini-9-flash(enterprise)')).rejects.toThrow(
      'not listed by pwc_tars',
    );
  });

  it('names tool responses on the Vertex client, and leaves the Gemini API alone', async () => {
    mockGetTarsVertexServiceKey.mockResolvedValue(serviceKey);

    await initializeModel('gemini-3.5-flash(enterprise)');
    expect(mockNameVertexToolResponses).toHaveBeenCalledTimes(1);

    mockNameVertexToolResponses.mockClear();
    await initializeModel('gemini-3.5-flash');
    expect(mockNameVertexToolResponses).not.toHaveBeenCalled();
  });

  it.each([
    ['a name neither listed nor pinned', 'gemini-9-flash(enterprise)'],
    ['a marker placed elsewhere in the name', 'gemini(enterprise)-3.5-flash'],
    ['a path in the name', 'gemini-3.5-flash(enterprise)/../../../endpoints/other'],
  ])('refuses %s before building a client', async (_label, model) => {
    mockGetTarsVertexServiceKey.mockResolvedValue(serviceKey);

    await expect(initializeModel(model)).rejects.toThrow('not listed by pwc_tars');

    expect(mockGetGoogleConfig).not.toHaveBeenCalled();
  });

  it('runs a model pwc_tars lists without a pin', async () => {
    const { invalidateTarsModelProfilesCache } = jest.requireActual('~/tars/models');
    invalidateTarsModelProfilesCache();
    process.env.TARS_AUTH_URL = 'http://tars.test';
    mockGetGoogleModels.mockReturnValue([]);
    mockGetTarsVertexServiceKey.mockResolvedValue(serviceKey);
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      async (url) =>
        ({
          status: 200,
          ok: true,
          json: async () =>
            String(url).includes('get_model_list')
              ? [{ model_name: 'gemini-3.5-flash(enterprise)' }]
              : { model_profiles: [{ name: 'gemini-3.5-flash(enterprise)', endpoint: null }] },
        }) as Response,
    );

    await initializeModel('gemini-3.5-flash(enterprise)');

    expect(mockGetGoogleConfig).toHaveBeenCalled();
    fetchMock.mockRestore();
    invalidateTarsModelProfilesCache();
  });

  it('refuses a listed model whose row the endpoint list lacks', async () => {
    const { invalidateTarsModelProfilesCache } = jest.requireActual('~/tars/models');
    invalidateTarsModelProfilesCache();
    process.env.TARS_AUTH_URL = 'http://tars.test';
    delete process.env.GOOGLE_LOC;
    mockGetGoogleModels.mockReturnValue([]);
    mockGetTarsVertexServiceKey.mockResolvedValue(serviceKey);
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      async (url) =>
        ({
          status: 200,
          ok: true,
          json: async () =>
            String(url).includes('get_model_list')
              ? [{ model_name: 'gemini-3.5-flash(enterprise)' }]
              : { model_profiles: [] },
        }) as Response,
    );

    await expect(initializeModel('gemini-3.5-flash(enterprise)')).rejects.toThrow(
      'has no known location',
    );

    expect(mockGetGoogleConfig).not.toHaveBeenCalled();
    fetchMock.mockRestore();
    invalidateTarsModelProfilesCache();
  });

  describe('when pwc_tars cannot say where a model runs', () => {
    const { invalidateTarsModelProfilesCache } = jest.requireActual('~/tars/models');
    const model = 'gemini-3.5-flash(enterprise)';
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      invalidateTarsModelProfilesCache();
      process.env.TARS_AUTH_URL = 'http://tars.test';
      delete process.env.GOOGLE_LOC;
      mockGetTarsVertexServiceKey.mockResolvedValue(serviceKey);
      fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    });

    afterEach(() => {
      fetchMock.mockRestore();
      invalidateTarsModelProfilesCache();
    });

    it('refuses a pinned model rather than send it to global', async () => {
      await expect(initializeModel(model)).rejects.toThrow('no known location');

      expect(mockGetGoogleConfig).not.toHaveBeenCalled();
    });

    it('runs it on GOOGLE_LOC, with nothing to read', async () => {
      process.env.GOOGLE_LOC = 'asia-east1';

      await initializeModel(model);

      expect(getGoogleConfigCall()[1].defaultLocation).toBe('asia-east1');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('runs on Vertex with the sys_config service account and the bare model id', async () => {
    mockGetTarsVertexServiceKey.mockResolvedValue(serviceKey);
    const db = createDb();

    const result = await initializeGoogle({
      req: createReq(),
      endpoint: EModelEndpoint.google,
      model_parameters: { model: 'gemini-3.5-flash(enterprise)', temperature: 0.2 },
      db,
    });

    expect(result.llmConfig).toMatchObject({
      metadata: { tars_model: 'gemini-3.5-flash(enterprise)' },
    });

    const [credentials, options] = getGoogleConfigCall();
    expect(credentials).toEqual({ [AuthKeys.GOOGLE_SERVICE_KEY]: serviceKey });
    expect(options).toMatchObject({
      forceVertex: true,
      projectId: undefined,
      modelOptions: { model: 'gemini-3.5-flash', temperature: 0.2 },
    });
    expect(db.getUserKey).not.toHaveBeenCalled();
    expect(mockGetTarsProviderApiKey).not.toHaveBeenCalled();
    expect(mockLoadServiceKey).not.toHaveBeenCalled();
  });

  it('falls back to the service key file when sys_config holds none', async () => {
    mockGetTarsVertexServiceKey.mockResolvedValue(undefined);
    mockLoadServiceKey.mockResolvedValue(serviceKey);
    process.env.GOOGLE_SERVICE_KEY_FILE = '/keys/vertex.json';

    await initializeModel('gemini-2.5-pro(enterprise)');

    expect(mockLoadServiceKey).toHaveBeenCalledWith('/keys/vertex.json');
    const [credentials, options] = getGoogleConfigCall();
    expect(credentials).toEqual({ [AuthKeys.GOOGLE_SERVICE_KEY]: serviceKey });
    expect(options).toMatchObject({ modelOptions: { model: 'gemini-2.5-pro' } });
  });

  it('refuses with a setup hint when no service account is available', async () => {
    mockGetTarsVertexServiceKey.mockResolvedValue(undefined);
    mockLoadServiceKey.mockResolvedValue(null);

    await expect(initializeModel('gemini-3.5-flash(enterprise)')).rejects.toThrow(
      'KEY_VERTEX_AI_API',
    );
    expect(mockGetGoogleConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['a project, which Vertex could not bill', { client_email: 'a@b.c', private_key: 'pk' }],
    ['a private key, which Google auth signs with', { project_id: 'p', client_email: 'a@b.c' }],
    ['a client email, as an OAuth client lacks', { project_id: 'p', private_key: 'pk' }],
  ])('refuses a key file without %s', async (_label, key) => {
    mockGetTarsVertexServiceKey.mockResolvedValue(undefined);
    mockLoadServiceKey.mockResolvedValue(key);

    await expect(initializeModel('gemini-3.5-flash(enterprise)')).rejects.toThrow(
      'needs a service account',
    );
  });

  it('refuses when reading the key file throws, instead of calling Vertex without a project', async () => {
    mockGetTarsVertexServiceKey.mockResolvedValue(undefined);
    mockLoadServiceKey.mockRejectedValue(new Error('EACCES'));

    await expect(initializeModel('gemini-3.5-flash(enterprise)')).rejects.toThrow(
      'needs a service account',
    );
  });

  it('ignores a configured GOOGLE_KEY, which is not a Vertex credential', async () => {
    process.env.GOOGLE_KEY = 'real-gemini-api-key';
    mockGetTarsVertexServiceKey.mockResolvedValue(serviceKey);
    mockGetTarsProviderApiKey.mockResolvedValue('tars-gemini-key');

    await initializeModel('gemini-3.5-flash(enterprise)');

    const [credentials, options] = getGoogleConfigCall();
    expect(credentials).toEqual({ [AuthKeys.GOOGLE_SERVICE_KEY]: serviceKey });
    expect(options).toMatchObject({ forceVertex: true });
    expect(mockGetTarsProviderApiKey).not.toHaveBeenCalled();
  });

  it("drops the Gemini API's reverse proxy and auth header, and defaults to the global location", async () => {
    process.env.GOOGLE_REVERSE_PROXY = 'https://gemini-proxy.example.com';
    process.env.GOOGLE_AUTH_HEADER = 'true';
    mockIsEnabled.mockReturnValue(true);
    mockGetTarsVertexServiceKey.mockResolvedValue(serviceKey);

    await initializeModel('gemini-3.5-flash(enterprise)');

    const [, options] = getGoogleConfigCall();
    expect(options.reverseProxyUrl).toBeUndefined();
    expect(options.authHeader).toBeUndefined();
    expect(options.defaultLocation).toBe('global');
  });

  it('keeps the reverse proxy and auth header for an unmarked model', async () => {
    process.env.GOOGLE_REVERSE_PROXY = 'https://gemini-proxy.example.com';
    process.env.GOOGLE_AUTH_HEADER = 'true';
    mockIsEnabled.mockReturnValue(true);

    await initializeModel('gemini-3.5-flash');

    const [, options] = getGoogleConfigCall();
    expect(options.reverseProxyUrl).toBe('https://gemini-proxy.example.com');
    expect(options.authHeader).toBe(true);
    expect(options.defaultLocation).toBeUndefined();
  });

  it('leaves unmarked Gemini models on the Gemini API key chain', async () => {
    await initializeModel('gemini-3.5-flash');

    expect(mockGetTarsVertexServiceKey).not.toHaveBeenCalled();
    expect(mockGetGoogleConfig.mock.results[0].value.llmConfig).not.toHaveProperty('metadata');
    const [credentials, options] = getGoogleConfigCall();
    expect(credentials).toBe('user-google-key');
    expect(options).toMatchObject({
      forceVertex: false,
      modelOptions: { model: 'gemini-3.5-flash' },
    });
  });
});
