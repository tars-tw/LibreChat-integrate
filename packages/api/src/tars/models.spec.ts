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
  resolveTarsLocalModelBaseURL,
  invalidateTarsLocalModelsCache,
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
