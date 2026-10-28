jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import {
  saveTarsModelAssignees,
  fetchTarsModelProfiles,
  fetchTarsCloudTypeRules,
  createTarsModelProfile,
  updateTarsModelProfile,
  deleteTarsModelProfile,
  fetchTarsModelAssignees,
  fetchTarsModelPermissions,
} from './modelProfiles';
import type { TarsModelProfile } from './modelProfiles';
import {
  getTarsModelProfileNames,
  getTarsUserModelProfileNames,
  invalidateTarsModelProfilesCache,
} from './models';
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

  it('names the sys_config key a cloud model uses and stores a new value with it', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(201, profile));

    await createTarsModelProfile(
      'admin-1',
      {
        name: 'gpt-5.4',
        type: 'CLOUD',
        endpoint: 'https://api.openai.com/v1',
        sysConfigKey: ' KEY_OPEN_AI_API ',
        apiKeyValue: 'sk-new',
      },
      BASE_URL,
    );

    expect(parseBody(fetchMock)).toMatchObject({
      sys_config_key: 'KEY_OPEN_AI_API',
      api_key_value: 'sk-new',
    });
  });

  it('keeps the stored key when no value is given, and sends neither field without a key', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(201, profile));

    await createTarsModelProfile(
      'admin-1',
      { name: 'x', type: 'CLOUD', endpoint: 'http://h/v1', sysConfigKey: 'KEY_GEMINI_API' },
      BASE_URL,
    );
    expect(parseBody(fetchMock, 0)).toMatchObject({
      sys_config_key: 'KEY_GEMINI_API',
      api_key_value: null,
    });

    await createTarsModelProfile(
      'admin-1',
      { name: 'x', type: 'GOOGLE_VERTEX', endpoint: 'http://h/v1', apiKeyValue: 'ignored' },
      BASE_URL,
    );
    expect(parseBody(fetchMock, 1)).not.toHaveProperty('sys_config_key');
    expect(parseBody(fetchMock, 1)).not.toHaveProperty('api_key_value');
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

describe('fetchTarsCloudTypeRules', () => {
  it('reads the rules as the requesting admin', async () => {
    const rules = {
      cloud_types: ['CLOUD', 'GOOGLE_VERTEX'],
      local_types: ['VLLM'],
      local_type_prefixes: ['VLLM'],
      type_to_key: { GOOGLE_VERTEX: 'KEY_VERTEX_AI_API' },
      all_keys: ['KEY_OPEN_AI_API', 'KEY_VERTEX_AI_API'],
      key_labels: { KEY_OPEN_AI_API: 'OpenAI', KEY_VERTEX_AI_API: 'Vertex AI' },
      key_status: { KEY_OPEN_AI_API: true, KEY_VERTEX_AI_API: false },
    };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, rules));

    await expect(fetchTarsCloudTypeRules('admin-1', BASE_URL)).resolves.toEqual(rules);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/model/cloud_type_rules?user_id=admin-1`,
    );
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

describe('model permission admin proxy', () => {
  const SECRET = 'pwc-tars-test-secret';
  const savedSecret = process.env.TARS_JWT_SECRET;
  const envelope = (data: unknown) => ({ success: true, message: '成功', data });
  const principal = {
    principal_type: 'group' as const,
    principal_id: 'g1',
    name: 'BOSS',
    email: null,
    is_active: true,
  };

  /** pwc_tars gates `/api/model/permission*` with `@admin_required`, so every call is signed as the admin. */
  const requestOf = (fetchMock: jest.SpyInstance, call = 0) => {
    const [input, init] = fetchMock.mock.calls[call] as [string, RequestInit];
    const url = new URL(String(input));
    const headers = init.headers as Record<string, string>;
    return {
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      actingUser: (
        jwt.verify(headers.Authorization.slice('Bearer '.length), SECRET, {
          algorithms: ['HS256'],
        }) as JwtPayload
      ).user_id,
    };
  };

  beforeEach(() => {
    process.env.TARS_JWT_SECRET = SECRET;
  });

  afterAll(() => {
    if (savedSecret === undefined) {
      delete process.env.TARS_JWT_SECRET;
    } else {
      process.env.TARS_JWT_SECRET = savedSecret;
    }
  });

  it('lists every model with assignees as the acting admin', async () => {
    const permissions = [{ model_profile_id: '1', principals: [principal] }];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope(permissions)));

    await expect(fetchTarsModelPermissions('admin-1', BASE_URL)).resolves.toEqual(permissions);
    expect(requestOf(fetchMock)).toEqual({
      path: '/api/model/permission/models',
      query: {},
      method: 'GET',
      body: undefined,
      actingUser: 'admin-1',
    });
  });

  it('reads one model by id and defaults to no assignees on a bare reply', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, envelope([principal])))
      .mockResolvedValueOnce(buildResponse(200, { success: true }));

    await expect(fetchTarsModelAssignees('admin-1', '1', BASE_URL)).resolves.toEqual([principal]);
    expect(requestOf(fetchMock)).toMatchObject({
      path: '/api/model/permission',
      query: { model_profile_id: '1' },
      actingUser: 'admin-1',
    });
    await expect(fetchTarsModelAssignees('admin-1', '1', BASE_URL)).resolves.toEqual([]);
  });

  it('saves one model, sending only the model id and principals', async () => {
    const result = { model_profile_id: '1', user_count: 1, group_count: 1 };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope(result)));
    const principals = [
      { principal_type: 'group' as const, principal_id: 'g1' },
      { principal_type: 'user' as const, principal_id: 'u1' },
    ];

    await expect(saveTarsModelAssignees('admin-1', '1', { principals }, BASE_URL)).resolves.toEqual(
      result,
    );
    expect(requestOf(fetchMock)).toEqual({
      path: '/api/model/permission/save',
      query: {},
      method: 'POST',
      body: { model_profile_id: '1', principals },
      actingUser: 'admin-1',
    });
  });

  it("drops every user's cached model list after a save", async () => {
    process.env.TARS_AUTH_URL = BASE_URL;
    invalidateTarsModelProfilesCache();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, [{ model_name: 'gpt-5.4' }]))
      .mockResolvedValueOnce(buildResponse(200, envelope({ model_profile_id: '1' })))
      .mockResolvedValueOnce(buildResponse(200, []));

    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual(['gpt-5.4']);
    await saveTarsModelAssignees('admin-1', '1', { principals: [] });
    await expect(getTarsUserModelProfileNames('u1')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('relays a refused principal with its status and message', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(400, { success: false, message: '已停用的對象不可新增：GONE' }),
      );

    const call = saveTarsModelAssignees(
      'admin-1',
      '1',
      { principals: [{ principal_type: 'group', principal_id: 'g2' }] },
      BASE_URL,
    );
    await expect(call).rejects.toBeInstanceOf(TarsRequestError);
    await expect(call).rejects.toMatchObject({
      status: 400,
      serverMessage: '已停用的對象不可新增：GONE',
    });
  });
});
