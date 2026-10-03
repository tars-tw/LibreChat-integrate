jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsModelProfiles,
  createTarsModelProfile,
  updateTarsModelProfile,
  deleteTarsModelProfile,
} from './modelProfiles';
import type { TarsModelProfile } from './modelProfiles';
import { getTarsModelProfileNames, invalidateTarsModelProfilesCache } from './models';
import { TarsRequestError } from './client';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const profile: TarsModelProfile = {
  id: 'b1c2',
  name: 'gpt-5.4',
  version: 'v1',
  type: 'CLOUD',
  description: '{"zh-TW":"雲端模型"}',
  status: 1,
  config: '{"max_token": 8192}',
  endpoint: 'https://api.openai.com/v1',
  api_version: null,
};

const parseBody = (fetchMock: jest.SpyInstance, call = 0): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.TARS_AUTH_URL;
});

describe('fetchTarsModelProfiles', () => {
  it('lists the admin view of every profile as the requesting admin', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { model_profiles: [profile] }));

    await expect(fetchTarsModelProfiles('admin-1', BASE_URL)).resolves.toEqual([profile]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/model/admin/get_model_profiles?user_id=admin-1`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('defaults to an empty list when the response is bare', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await expect(fetchTarsModelProfiles('admin-1', BASE_URL)).resolves.toEqual([]);
  });
});

describe('createTarsModelProfile', () => {
  it('trims the required fields, sends blank optionals as null and stamps the creator', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(201, profile));

    await expect(
      createTarsModelProfile(
        'admin-1',
        {
          name: ' gpt-5.4 ',
          type: 'CLOUD',
          endpoint: ' https://api.openai.com/v1 ',
          version: '',
          description: '  ',
          config: '{"max_token": 8192}',
        },
        BASE_URL,
      ),
    ).resolves.toEqual(profile);

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/model/create_model_profile`);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(parseBody(fetchMock)).toEqual({
      name: 'gpt-5.4',
      type: 'CLOUD',
      endpoint: 'https://api.openai.com/v1',
      version: null,
      description: null,
      config: '{"max_token": 8192}',
      api_version: null,
      created_by: 'admin-1',
      user_id: 'admin-1',
    });
  });

  it("relays pwc_tars's own validation message", async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { error: 'config is not valid JSON' }));

    await expect(
      createTarsModelProfile(
        'admin-1',
        { name: 'x', type: 'CLOUD', endpoint: 'http://10.0.0.5:8000/v1' },
        BASE_URL,
      ),
    ).rejects.toMatchObject({ status: 400, serverMessage: 'config is not valid JSON' });
  });
});

describe('input guard', () => {
  it.each([
    ['an unknown type', { name: 'x', type: 'asfa', endpoint: 'https://api.openai.com/v1' }],
    ['a missing type', { name: 'x', endpoint: 'https://api.openai.com/v1' }],
    ['a non-URL endpoint', { name: 'x', type: 'CLOUD', endpoint: 'fasdfa' }],
    ['a non-http endpoint', { name: 'x', type: 'VLLM', endpoint: 'ftp://10.0.0.5/v1' }],
    ['a missing endpoint', { name: 'x', type: 'VLLM' }],
  ])('refuses to create a model with %s, without calling pwc_tars', async (_label, input) => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(createTarsModelProfile('admin-1', input, BASE_URL)).rejects.toMatchObject({
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks only the fields an update changes, so a legacy type can stay', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, profile));

    await updateTarsModelProfile('admin-1', 'b1c2', { name: 'renamed' }, BASE_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      updateTarsModelProfile('admin-1', 'b1c2', { endpoint: 'not a url' }, BASE_URL),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateTarsModelProfile('admin-1', 'b1c2', { type: 'OPEN_AI' }, BASE_URL),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('updateTarsModelProfile', () => {
  it('sends only the supplied fields so pwc_tars keeps the rest', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, profile));

    await updateTarsModelProfile('admin-1', 'b1c2', { enabled: false }, BASE_URL);

    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PUT');
    expect(parseBody(fetchMock)).toEqual({
      id: 'b1c2',
      status: 0,
      updated_by: 'admin-1',
      user_id: 'admin-1',
    });
  });

  it("sends '' for cleared optionals and maps apiVersion onto api_version", async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, profile));

    await updateTarsModelProfile(
      'admin-1',
      'b1c2',
      { name: 'gpt-5.4', version: '', apiVersion: ' 2024-02-15 ', config: '' },
      BASE_URL,
    );

    expect(parseBody(fetchMock)).toEqual({
      id: 'b1c2',
      name: 'gpt-5.4',
      version: '',
      config: '',
      api_version: '2024-02-15',
      updated_by: 'admin-1',
      user_id: 'admin-1',
    });
  });

  it('splits the retarget summary off the returned profile', async () => {
    const sync = {
      target: { id: 'd3', name: 'default' },
      knowledge_base: 1,
      sys_model: 2,
      sys_rag_model: 0,
      sys_domain: 0,
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { ...profile, sync }));

    await expect(
      updateTarsModelProfile('admin-1', 'b1c2', { enabled: false }, BASE_URL),
    ).resolves.toEqual({ profile, sync });
  });

  it('surfaces the no-fallback conflict as a 409', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(409, { error: 'No active fallback model is configured' }));

    const error = await updateTarsModelProfile(
      'admin-1',
      'b1c2',
      { enabled: false },
      BASE_URL,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TarsRequestError);
    expect(error).toMatchObject({ status: 409 });
  });
});

describe('deleteTarsModelProfile', () => {
  it('soft-deletes through a DELETE body and returns the retarget summary', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, id: 'b1c2' }));

    await expect(deleteTarsModelProfile('admin-1', 'b1c2', BASE_URL)).resolves.toEqual({
      sync: null,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/api/model/delete_model_profile`);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
    expect(parseBody(fetchMock)).toEqual({ id: 'b1c2', user_id: 'admin-1' });
  });
});

describe('model whitelist cache', () => {
  it('is refreshed after a profile write instead of waiting out its TTL', async () => {
    process.env.TARS_AUTH_URL = BASE_URL;
    invalidateTarsModelProfilesCache();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, [{ model_name: 'old' }]))
      .mockResolvedValueOnce(buildResponse(200, profile))
      .mockResolvedValueOnce(buildResponse(200, [{ model_name: 'old' }, { model_name: 'new' }]));

    await expect(getTarsModelProfileNames()).resolves.toEqual(['old']);
    await createTarsModelProfile('admin-1', {
      name: 'new',
      type: 'CLOUD',
      endpoint: 'http://10.0.0.5:8000/v1',
    });
    await expect(getTarsModelProfileNames()).resolves.toEqual(['old', 'new']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
