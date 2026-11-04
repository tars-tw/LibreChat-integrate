jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  isTarsLocalEndpoint,
  getTarsLocalModelNames,
  getTarsModelProfileNames,
  getTarsModelProfileEndpoint,
  resolveTarsLocalModelBaseURL,
  getTarsUserModelProfileNames,
  invalidateTarsUserModelsCache,
  reorderTarsWhitelistedModels,
  invalidateTarsLocalModelsCache,
  invalidateTarsModelProfilesCache,
  TARS_LOCAL_ENDPOINT_MARKER,
} from './models';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const healthStatus = (endpoints: Array<{ endpoint: string; loaded_models: string[] | null }>) => ({
  endpoints,
});

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsLocalModelsCache();
  invalidateTarsModelProfilesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete process.env.TARS_AUTH_URL;
});

describe('isTarsLocalEndpoint', () => {
  it('matches the marker (with surrounding whitespace) and nothing else', () => {
    expect(isTarsLocalEndpoint(TARS_LOCAL_ENDPOINT_MARKER)).toBe(true);
    expect(isTarsLocalEndpoint('  tars://local  ')).toBe(true);
    expect(isTarsLocalEndpoint('http://219.86.90.151:11434/v1')).toBe(false);
    expect(isTarsLocalEndpoint('${tars:VLLM_API_ENDPOINT}')).toBe(false);
    expect(isTarsLocalEndpoint('')).toBe(false);
    expect(isTarsLocalEndpoint(undefined)).toBe(false);
    expect(isTarsLocalEndpoint(null)).toBe(false);
  });
});

describe('getTarsLocalModelNames', () => {
  it('returns the loaded models across all hosts, sorted', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(
        200,
        healthStatus([
          { endpoint: 'http://219.86.90.151:11434', loaded_models: ['gemma-4-31B'] },
          { endpoint: 'http://202.5.254.233:11434', loaded_models: ['deepseek-reasoner'] },
        ]),
      ),
    );
    await expect(getTarsLocalModelNames()).resolves.toEqual(['deepseek-reasoner', 'gemma-4-31B']);
  });

  it('excludes hosts with an empty or not-yet-probed (null) model list', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(
        200,
        healthStatus([
          { endpoint: 'http://219.86.90.151:11434', loaded_models: ['gemma-4-31B'] },
          { endpoint: 'http://202.5.254.233:11434', loaded_models: [] },
          { endpoint: 'http://198.0.0.1:11434', loaded_models: null },
        ]),
      ),
    );
    await expect(getTarsLocalModelNames()).resolves.toEqual(['gemma-4-31B']);
  });

  it('returns [] without fetching when TARS is unconfigured', async () => {
    delete process.env.TARS_AUTH_URL;
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(getTarsLocalModelNames()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] without throwing when pwc_tars is unreachable on a cold cache', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    await expect(getTarsLocalModelNames()).resolves.toEqual([]);
    await expect(getTarsLocalModelNames()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves from cache within the TTL and refetches after it expires', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(
          200,
          healthStatus([
            { endpoint: 'http://219.86.90.151:11434', loaded_models: ['gemma-4-31B'] },
          ]),
        ),
      );

    await expect(getTarsLocalModelNames()).resolves.toEqual(['gemma-4-31B']);
    await expect(getTarsLocalModelNames()).resolves.toEqual(['gemma-4-31B']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(31_000);
    await expect(getTarsLocalModelNames()).resolves.toEqual(['gemma-4-31B']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight fetch across concurrent lookups', async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));

    const lookups = Promise.all([
      getTarsLocalModelNames(),
      resolveTarsLocalModelBaseURL('gemma-4-31B'),
    ]);
    resolveFetch(
      buildResponse(
        200,
        healthStatus([{ endpoint: 'http://219.86.90.151:11434', loaded_models: ['gemma-4-31B'] }]),
      ),
    );

    await expect(lookups).resolves.toEqual([['gemma-4-31B'], 'http://219.86.90.151:11434/v1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveTarsLocalModelBaseURL', () => {
  it('resolves a model to its host base URL, trimming trailing slashes and appending /v1', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(
        200,
        healthStatus([
          { endpoint: 'http://219.86.90.151:11434/', loaded_models: ['gemma-4-31B'] },
          { endpoint: 'http://202.5.254.233:11434', loaded_models: ['deepseek-reasoner'] },
        ]),
      ),
    );
    await expect(resolveTarsLocalModelBaseURL('gemma-4-31B')).resolves.toBe(
      'http://219.86.90.151:11434/v1',
    );
    await expect(resolveTarsLocalModelBaseURL('deepseek-reasoner')).resolves.toBe(
      'http://202.5.254.233:11434/v1',
    );
  });

  it('returns undefined for a model that is not currently loaded', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(
          200,
          healthStatus([
            { endpoint: 'http://219.86.90.151:11434', loaded_models: ['gemma-4-31B'] },
          ]),
        ),
      );
    await expect(resolveTarsLocalModelBaseURL('qwen-72B')).resolves.toBeUndefined();
  });

  it('returns undefined for an empty model name without fetching', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(resolveTarsLocalModelBaseURL('')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getTarsModelProfileNames', () => {
  const modelList = (names: Array<string | null>) => names.map((model_name) => ({ model_name }));

  it('returns the model_profile names, trimmed and deduplicated', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(200, modelList(['gpt-4o', ' claude-sonnet-4-6 ', 'gpt-4o', '', null])),
      );
    await expect(getTarsModelProfileNames()).resolves.toEqual(['gpt-4o', 'claude-sonnet-4-6']);
  });

  it('returns null without fetching when TARS is unconfigured', async () => {
    delete process.env.TARS_AUTH_URL;
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(getTarsModelProfileNames()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open to null on a cold cache without retrying within the TTL', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    await expect(getTarsModelProfileNames()).resolves.toBeNull();
    await expect(getTarsModelProfileNames()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves from cache within the TTL and refetches after it expires', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, modelList(['gpt-4o'])));

    await expect(getTarsModelProfileNames()).resolves.toEqual(['gpt-4o']);
    await expect(getTarsModelProfileNames()).resolves.toEqual(['gpt-4o']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(61_000);
    await expect(getTarsModelProfileNames()).resolves.toEqual(['gpt-4o']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves the stale list when a refresh fails', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, modelList(['gpt-4o'])))
      .mockRejectedValueOnce(new Error('down'));

    await expect(getTarsModelProfileNames()).resolves.toEqual(['gpt-4o']);
    jest.advanceTimersByTime(61_000);
    await expect(getTarsModelProfileNames()).resolves.toEqual(['gpt-4o']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares a single in-flight fetch across concurrent lookups', async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));

    const lookups = Promise.all([getTarsModelProfileNames(), getTarsModelProfileNames()]);
    resolveFetch(buildResponse(200, modelList(['gpt-4o'])));

    await expect(lookups).resolves.toEqual([['gpt-4o'], ['gpt-4o']]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getTarsModelProfileEndpoint', () => {
  const profiles = {
    model_profiles: [
      { name: 'gemini-3.5-flash(enterprise)', endpoint: 'https://vertex.example/locations/global' },
      { name: 'gpt-5.4-mini', endpoint: null },
    ],
  };

  it('returns a profile endpoint and nothing for a row without one', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, profiles));

    await expect(getTarsModelProfileEndpoint('gemini-3.5-flash(enterprise)')).resolves.toBe(
      'https://vertex.example/locations/global',
    );
    await expect(getTarsModelProfileEndpoint('gpt-5.4-mini')).resolves.toBeUndefined();
    await expect(getTarsModelProfileEndpoint('unknown')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/model/get_model_profiles');
  });

  it('shares one fetch between concurrent callers', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, profiles));

    await Promise.all([
      getTarsModelProfileEndpoint('gpt-5.4-mini'),
      getTarsModelProfileEndpoint('unknown'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns nothing without fetching when TARS is unconfigured', async () => {
    delete process.env.TARS_AUTH_URL;
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(getTarsModelProfileEndpoint('gpt-5.4-mini')).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells a cold failure from a missing row, and asks again on the next read', async () => {
    const model = 'gemini-3.5-flash(enterprise)';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(buildResponse(200, profiles));

    await expect(getTarsModelProfileEndpoint(model)).resolves.toBeNull();
    await expect(getTarsModelProfileEndpoint(model)).resolves.toBeNull();
    await expect(getTarsModelProfileEndpoint(model)).resolves.toBe(
      'https://vertex.example/locations/global',
    );
    await expect(getTarsModelProfileEndpoint('unknown')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats an error status as a cold failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(500, { error: 'boom' }));

    await expect(getTarsModelProfileEndpoint('gpt-5.4-mini')).resolves.toBeNull();
  });

  it('keeps serving the last endpoints when a refresh fails after the TTL', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, profiles))
      .mockRejectedValueOnce(new Error('down'));
    const model = 'gemini-3.5-flash(enterprise)';

    await getTarsModelProfileEndpoint(model);
    jest.advanceTimersByTime(60_001);

    await expect(getTarsModelProfileEndpoint(model)).resolves.toBe(
      'https://vertex.example/locations/global',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await getTarsModelProfileEndpoint(model);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves no endpoint an admin edit dropped when the re-read fails', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, profiles))
      .mockRejectedValueOnce(new Error('down'));
    const model = 'gemini-3.5-flash(enterprise)';

    await getTarsModelProfileEndpoint(model);
    invalidateTarsModelProfilesCache();

    await expect(getTarsModelProfileEndpoint(model)).resolves.toBeNull();
  });

  it('keys a row by its trimmed name, as the name list does', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        model_profiles: [{ name: ' gemini-3.5-flash(enterprise) ', endpoint: 'https://a/v1' }],
      }),
    );

    await expect(getTarsModelProfileEndpoint('gemini-3.5-flash(enterprise)')).resolves.toBe(
      'https://a/v1',
    );
  });

  it('does not keep a read in flight when an admin edit drops the cache', async () => {
    const edited = { model_profiles: [{ name: 'gpt-5.4-mini', endpoint: 'https://new/v1' }] };
    const old = { model_profiles: [{ name: 'gpt-5.4-mini', endpoint: 'https://old/v1' }] };
    let resolveFirst: (value: Response) => void = () => undefined;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(buildResponse(200, edited));

    const racing = getTarsModelProfileEndpoint('gpt-5.4-mini');
    invalidateTarsModelProfilesCache();
    resolveFirst(buildResponse(200, old));

    await expect(racing).resolves.toBe('https://new/v1');
    await expect(getTarsModelProfileEndpoint('gpt-5.4-mini')).resolves.toBe('https://new/v1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-reads pwc_tars after an admin edit drops the cache', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, profiles));

    await getTarsModelProfileEndpoint('gpt-5.4-mini');
    invalidateTarsModelProfilesCache();
    await getTarsModelProfileEndpoint('gpt-5.4-mini');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('when the name list has moved past the endpoint list', () => {
    const regional = 'gemini-x(enterprise)';
    const endpoint = 'https://vertex.example/locations/europe-west4';
    const withRow = (row: { name: string; endpoint: string | null }) => ({ model_profiles: [row] });

    /** Answers the name list with `listed`, and each endpoint read with the next reply. */
    function stubLists(listed: string[], ...endpointReplies: Array<object | Error>) {
      const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (String(url).includes('get_model_list')) {
          return buildResponse(
            200,
            listed.map((model_name) => ({ model_name })),
          );
        }
        const reply = endpointReplies.shift();
        if (reply instanceof Error) {
          throw reply;
        }
        return buildResponse(200, reply ?? { model_profiles: [] });
      });
      return () =>
        fetchMock.mock.calls.filter(([url]) => String(url).includes('get_model_profiles')).length;
    }

    /** An endpoint read, then 30s later a name list that knows about `regional`. */
    async function listAfterEndpointRead() {
      jest.useFakeTimers();
      await getTarsModelProfileEndpoint(regional);
      jest.advanceTimersByTime(30_000);
      await getTarsModelProfileNames();
    }

    it('re-reads for a just-listed profile rather than call its region missing', async () => {
      const endpointReads = stubLists(
        [regional],
        { model_profiles: [] },
        withRow({ name: regional, endpoint }),
      );

      await listAfterEndpointRead();

      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBe(endpoint);
      expect(endpointReads()).toBe(2);
    });

    it('refuses a just-listed profile when the re-read fails, and asks again next time', async () => {
      const endpointReads = stubLists(
        [regional],
        { model_profiles: [] },
        new Error('down'),
        withRow({ name: regional, endpoint }),
      );

      await listAfterEndpointRead();

      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeNull();
      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBe(endpoint);
      expect(endpointReads()).toBe(3);
    });

    it('re-reads a listed profile with no endpoint once, then takes that as its answer', async () => {
      const row = withRow({ name: regional, endpoint: null });
      const endpointReads = stubLists([regional], { model_profiles: [] }, row, row);

      await listAfterEndpointRead();

      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeUndefined();
      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeUndefined();
      expect(endpointReads()).toBe(2);
    });

    it('does not re-read for a pinned model pwc_tars does not list', async () => {
      const endpointReads = stubLists(['gpt-5.4-mini'], { model_profiles: [] });

      await listAfterEndpointRead();

      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeUndefined();
      expect(endpointReads()).toBe(1);
    });

    it('refuses a listed profile the newer endpoint list lacks, without re-reading', async () => {
      const endpointReads = stubLists([regional], { model_profiles: [] });
      jest.useFakeTimers();

      await getTarsModelProfileNames();
      jest.advanceTimersByTime(30_000);

      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeNull();
      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeNull();
      expect(endpointReads()).toBe(1);
    });

    it('refuses a listed profile a re-read still lacks', async () => {
      const endpointReads = stubLists([regional], { model_profiles: [] }, { model_profiles: [] });

      await listAfterEndpointRead();

      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeNull();
      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeNull();
      expect(endpointReads()).toBe(2);
    });

    it('answers again once the endpoint list holds the row after its TTL', async () => {
      const endpointReads = stubLists(
        [regional],
        { model_profiles: [] },
        withRow({ name: regional, endpoint }),
      );
      jest.useFakeTimers();

      await getTarsModelProfileNames();
      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeNull();
      jest.advanceTimersByTime(60_001);

      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBe(endpoint);
      expect(endpointReads()).toBe(2);
    });

    it('takes a row with no endpoint as its answer whichever list is newer', async () => {
      const endpointReads = stubLists([regional], withRow({ name: regional, endpoint: null }));
      jest.useFakeTimers();

      await getTarsModelProfileNames();
      jest.advanceTimersByTime(30_000);

      await expect(getTarsModelProfileEndpoint(regional)).resolves.toBeUndefined();
      expect(endpointReads()).toBe(1);
    });
  });
});

describe('getTarsUserModelProfileNames', () => {
  const modelList = (names: Array<string | null>) => names.map((model_name) => ({ model_name }));
  const requestedUrl = (fetchMock: jest.SpyInstance, call = 0) =>
    new URL(String(fetchMock.mock.calls[call][0]));

  it("asks pwc_tars for the user's own list, trimmed and deduplicated", async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, modelList(['gpt-4o', ' gpt-4o ', '', null, 'o3'])));

    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual(['gpt-4o', 'o3']);
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toBe('/api/model/get_user_model_list');
    expect(url.searchParams.get('user_id')).toBe('u1');
  });

  it('returns null without fetching when TARS is unconfigured', async () => {
    delete process.env.TARS_AUTH_URL;
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(getTarsUserModelProfileNames('u1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives an account with no pwc_tars link the global list', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, modelList(['gpt-4o'])));

    await expect(getTarsUserModelProfileNames(undefined)).resolves.toEqual(['gpt-4o']);
    expect(requestedUrl(fetchMock).pathname).toBe('/api/model/get_model_list');
  });

  it('caches each user separately and refetches after the TTL', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, modelList(['gpt-4o'])))
      .mockResolvedValueOnce(buildResponse(200, modelList(['o3'])))
      .mockResolvedValueOnce(buildResponse(200, modelList(['gpt-4o', 'o3'])));

    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual(['gpt-4o']);
    await expect(getTarsUserModelProfileNames('u2')).resolves.toEqual(['o3']);
    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual(['gpt-4o']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(61_000);
    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual(['gpt-4o', 'o3']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a permission save', invalidateTarsUserModelsCache],
    ['a profile write', invalidateTarsModelProfilesCache],
  ])('rereads every user after %s', async (_label, invalidate) => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, modelList(['gpt-4o'])))
      .mockResolvedValueOnce(buildResponse(200, modelList([])));

    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual(['gpt-4o']);
    invalidate();
    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight fetch per user', async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));

    const lookups = Promise.all([
      getTarsUserModelProfileNames('u1'),
      getTarsUserModelProfileNames('u1'),
    ]);
    resolveFetch(buildResponse(200, modelList(['gpt-4o'])));

    await expect(lookups).resolves.toEqual([['gpt-4o'], ['gpt-4o']]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache an answer that was in flight when the cache was dropped', async () => {
    let resolveFirst: (value: Response) => void = () => undefined;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(buildResponse(200, modelList(['o3'])));

    const stale = getTarsUserModelProfileNames('u1');
    invalidateTarsUserModelsCache();
    resolveFirst(buildResponse(200, modelList(['gpt-4o'])));
    await expect(stale).resolves.toEqual(['gpt-4o']);

    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual(['o3']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on a failed fetch and does not cache the failure', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(buildResponse(200, modelList(['gpt-4o'])));

    await expect(getTarsUserModelProfileNames('u1')).rejects.toThrow('down');
    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual(['gpt-4o']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('reorderTarsWhitelistedModels', () => {
  const whitelist = (names: string[]) =>
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(
        200,
        names.map((model_name) => ({ model_name })),
      ),
    );

  it('moves whitelisted models to the front, keeping relative order on both sides', async () => {
    whitelist(['gpt-4o-mini', 'GPT-4o']);
    await expect(
      reorderTarsWhitelistedModels({
        openAI: ['gpt-3.5-turbo', 'gpt-4o', 'gpt-4', 'gpt-4o-mini'],
        google: ['gemini-2.0-flash'],
      }),
    ).resolves.toEqual({
      openAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4'],
      google: ['gemini-2.0-flash'],
    });
  });

  it('returns the config untouched when TARS is unconfigured', async () => {
    delete process.env.TARS_AUTH_URL;
    const config = { openAI: ['gpt-3.5-turbo', 'gpt-4o'] };
    await expect(reorderTarsWhitelistedModels(config)).resolves.toBe(config);
  });

  it('returns the config untouched when the whitelist fetch fails cold', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    const config = { openAI: ['gpt-3.5-turbo', 'gpt-4o'] };
    await expect(reorderTarsWhitelistedModels(config)).resolves.toBe(config);
  });

  it('leaves endpoints untouched when all or none of their models are whitelisted', async () => {
    whitelist(['gpt-4o', 'gemini-2.0-flash']);
    const config = {
      openAI: ['claude-3-5-sonnet', 'o1'],
      google: ['gemini-2.0-flash'],
    };
    const result = await reorderTarsWhitelistedModels(config);
    expect(result.openAI).toEqual(['claude-3-5-sonnet', 'o1']);
    expect(result.google).toEqual(['gemini-2.0-flash']);
  });
});
