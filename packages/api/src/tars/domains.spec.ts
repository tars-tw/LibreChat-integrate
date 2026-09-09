jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  createTarsDomain,
  deleteTarsDomain,
  updateTarsDomain,
  fetchTarsDomainById,
  fetchTarsDomainsForUser,
} from './domains';
import type { TarsDomain } from './domains';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const domain = (id: number, name: string): TarsDomain => ({
  id,
  name,
  description: `${name} description`,
  role_ids: '1,2',
  knowledge_base_ids: 'kb-1',
  domain_functions: '{}',
  prompt_instruction: null,
  iframe_url: null,
  status: true,
});

describe('fetchTarsDomainsForUser', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns [] without calling pwc_tars when tarsId is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(fetchTarsDomainsForUser('', BASE_URL)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests get_domain_by_user with the user id and returns sys_domains', async () => {
    const domains = [domain(1, 'Finance'), domain(2, 'HR')];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { sys_domains: domains }));

    const result = await fetchTarsDomainsForUser('u1', BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/domain_settings/get_domain_by_user?user_id=u1`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(domains);
  });

  it('defaults to [] when the response omits sys_domains', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await expect(fetchTarsDomainsForUser('u1', BASE_URL)).resolves.toEqual([]);
  });

  it('throws when no base URL is configured', async () => {
    await expect(fetchTarsDomainsForUser('u1', undefined)).rejects.toThrow('TARS_AUTH_URL');
  });

  it('throws on a non-2xx pwc_tars response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(500, {}));
    await expect(fetchTarsDomainsForUser('u1', BASE_URL)).rejects.toThrow('status 500');
  });
});

describe('fetchTarsDomainById', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves a domain the user is authorized for (numeric/string agnostic)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(200, { sys_domains: [domain(1, 'Finance'), domain(2, 'HR')] }),
      );

    const result = await fetchTarsDomainById('u1', '2', BASE_URL);
    expect(result).toMatchObject({ id: 2, name: 'HR' });
  });

  it('returns null when the domain is outside the user grants', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { sys_domains: [domain(1, 'Finance')] }));

    await expect(fetchTarsDomainById('u1', 999, BASE_URL)).resolves.toBeNull();
  });
});

describe('deleteTarsDomain', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** pwc_tars records the operator in its audit log from the query string. */
  it('passes the operator id as a query param', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'ok' }));

    await deleteTarsDomain('admin', 7, BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/domain_settings/delete_domain/7?operator_id=admin`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('plugin_functions merge on create / update', () => {
  const stored = JSON.stringify({
    web_search: { enabled: true, default_value: true },
    'plugin:old_tool': { kind: 'plugin', name: 'old_tool', enabled: true, default_value: true },
  });
  const listing = {
    plugin_tools: [
      { name: 'text_stats', display_name: 'Text Stats', description: 'Count words.', ok: true },
      { name: 'broken', display_name: 'Broken', description: '', ok: false, problems: ['x'] },
    ],
    plugin_dirs: [],
    errors: [],
  };

  const mockBackend = () => {
    const bodies: Record<string, unknown[]> = { create: [], update: [] };
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.endsWith('/api/domain_settings/plugin_tools')) {
        return buildResponse(200, listing);
      }
      if (url.includes('/api/domain_settings/get_domains?id=7')) {
        return buildResponse(200, {
          sys_domains: [{ ...domain(7, 'Finance'), domain_functions: stored }],
        });
      }
      if (url.endsWith('/api/domain_settings/create_domain')) {
        bodies.create.push(body);
        return buildResponse(200, {
          domain: { ...domain(9, body.name), domain_functions: stored },
        });
      }
      if (url.includes('/api/domain_settings/update_domain/')) {
        bodies.update.push(body);
        return buildResponse(200, {
          domain: { ...domain(7, body.name), domain_functions: body.domain_functions },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    return { fetchMock, bodies };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('update merges the switches into the stored block and drops stale plugin keys', async () => {
    const { bodies } = mockBackend();
    await updateTarsDomain(
      'admin',
      7,
      {
        name: 'Finance',
        plugin_functions: {
          text_stats: { enabled: true, default_value: false },
          broken: { enabled: true, default_value: true },
        },
      },
      BASE_URL,
    );
    const sent = bodies.update[0] as { domain_functions: string; plugin_functions?: unknown };
    expect(sent.plugin_functions).toBeUndefined();
    expect(JSON.parse(sent.domain_functions)).toEqual({
      web_search: { enabled: true, default_value: true },
      'plugin:text_stats': {
        kind: 'plugin',
        name: 'text_stats',
        enabled: true,
        default_value: false,
        display_name: 'Text Stats',
        description: 'Count words.',
      },
    });
  });

  it('update leaves an explicit domain_functions alone', async () => {
    const { bodies, fetchMock } = mockBackend();
    await updateTarsDomain(
      'admin',
      7,
      {
        name: 'Finance',
        domain_functions: '{}',
        plugin_functions: { text_stats: { enabled: true, default_value: true } },
      },
      BASE_URL,
    );
    expect((bodies.update[0] as { domain_functions: string }).domain_functions).toBe('{}');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/plugin_tools'))).toBe(false);
  });

  it('create lets pwc_tars default the block, then merges the switches with a follow-up update', async () => {
    const { bodies } = mockBackend();
    const result = await createTarsDomain(
      'admin',
      {
        name: 'New brain',
        plugin_functions: { text_stats: { enabled: true, default_value: true } },
      },
      BASE_URL,
    );
    expect(bodies.create[0]).toEqual({ name: 'New brain', created_by: 'admin' });
    expect(bodies.update).toHaveLength(1);
    const merged = JSON.parse((bodies.update[0] as { domain_functions: string }).domain_functions);
    expect(merged['plugin:text_stats'].enabled).toBe(true);
    expect(merged.web_search).toEqual({ enabled: true, default_value: true });
    expect(result.id).toBe(7);
  });

  it('create without switches is a single call', async () => {
    const { bodies } = mockBackend();
    await createTarsDomain('admin', { name: 'Plain' }, BASE_URL);
    expect(bodies.create).toHaveLength(1);
    expect(bodies.update).toHaveLength(0);
  });
});
