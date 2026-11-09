jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import type { TarsAvailableToolRow } from './client';
import type { TarsMcpUserServer } from './user';
import { filterVisibleTarsMcpConfigs, getUserTarsMcpTools, withTarsDirectTools } from './user';
import { clearTarsMcpEntryNames } from './names';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const envelope = (data: unknown) => ({ success: true, message: '成功', data });

const jsonResponse = (body: unknown): Response =>
  ({ status: 200, ok: true, json: async () => body }) as Response;

const toolRow = (overrides: Partial<TarsAvailableToolRow> = {}): TarsAvailableToolRow => ({
  server_id: 's-github',
  server_name: 'Github-repo',
  server_code: 'github',
  server_type: 'custom_api',
  tool_id: 't-list',
  tool_name: 'list_repos',
  description: 'List repositories',
  input_schema: null,
  ...overrides,
});

const userServer = (overrides: Partial<TarsMcpUserServer> = {}): TarsMcpUserServer => ({
  id: 's-redmine',
  name: 'Redmine',
  code: 'redmine',
  type: 'openapi',
  is_enabled: true,
  user_enabled: false,
  requires_user_credentials: false,
  has_credentials: false,
  auth_type: 'none',
  login_fields: [],
  tools: [
    { id: 't-a', name: 'list_issues', user_enabled: true },
    { id: 't-b', name: 'get_issue', user_enabled: true },
  ],
  ...overrides,
});

/** Serves the two pwc_tars reads and records every URL that was asked for. */
const mockTars = (rows: TarsAvailableToolRow[], settings: TarsMcpUserServer[]) => {
  const urls: URL[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname === '/api/mcp/available-tools') {
      return jsonResponse(envelope(rows));
    }
    if (url.pathname === '/api/mcp/user-settings') {
      return jsonResponse(envelope(settings));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return urls;
};

describe('getUserTarsMcpTools', () => {
  const savedUrl = process.env.TARS_AUTH_URL;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = BASE_URL;
    clearTarsMcpEntryNames();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedUrl === undefined) {
      delete process.env.TARS_AUTH_URL;
    } else {
      process.env.TARS_AUTH_URL = savedUrl;
    }
  });

  it('asks pwc_tars for the user only — never a brain', async () => {
    const urls = mockTars([], []);

    await getUserTarsMcpTools(USER_ID);

    expect(urls.map((url) => url.pathname).sort()).toEqual([
      '/api/mcp/available-tools',
      '/api/mcp/user-settings',
    ]);
    for (const url of urls) {
      expect(Object.fromEntries(url.searchParams.entries())).toEqual({ user_id: USER_ID });
    }
  });

  it('lists opted-in servers with chat tool keys and offers the rest as opt-ins', async () => {
    mockTars(
      [toolRow(), toolRow({ tool_id: 't-file', tool_name: 'get_file', description: null })],
      [
        userServer({ id: 's-github', name: 'Github-repo', code: 'github', user_enabled: true }),
        userServer(),
      ],
    );

    const servers = await getUserTarsMcpTools(USER_ID);

    expect(servers).toEqual([
      {
        id: 's-github',
        name: 'Github-repo',
        code: 'github',
        type: 'custom_api',
        gateway_name: 'tars_github',
        user_enabled: true,
        tools: [
          {
            name: 'list_repos',
            description: 'List repositories',
            tool_key: 'list_repos_mcp_tars_github',
          },
          { name: 'get_file', description: null, tool_key: 'get_file_mcp_tars_github' },
        ],
      },
      {
        id: 's-redmine',
        name: 'Redmine',
        code: 'redmine',
        type: 'openapi',
        gateway_name: 'tars_redmine',
        user_enabled: false,
        tools: [],
        tool_count: 2,
      },
    ]);
  });

  it('does not offer as an opt-in what cannot be used from chat', async () => {
    mockTars(
      [toolRow({ server_type: 'builtin' })],
      [
        userServer({ id: 's-off', is_enabled: false }),
        userServer({ id: 's-builtin', type: 'builtin' }),
        userServer({ id: 's-github', code: 'github', user_enabled: true, tools: [] }),
      ],
    );

    await expect(getUserTarsMcpTools(USER_ID)).resolves.toEqual([]);
  });

  it('still lists usable tools when the settings read fails', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/mcp/available-tools') {
        return jsonResponse(envelope([toolRow()]));
      }
      return { status: 500, ok: false, json: async () => ({}) } as Response;
    });

    const servers = await getUserTarsMcpTools(USER_ID);

    expect(servers.map((server) => [server.id, server.user_enabled])).toEqual([['s-github', true]]);
  });
});

describe('filterVisibleTarsMcpConfigs', () => {
  const savedUrl = process.env.TARS_AUTH_URL;
  const configs = {
    workflow: { title: 'yaml' },
    tars: { title: 'legacy aggregate' },
    tars_github: { title: 'Github-repo' },
    tars_redmine: { title: 'Redmine' },
    tars_maps: { title: 'Google Maps' },
  };

  beforeEach(() => {
    process.env.TARS_AUTH_URL = BASE_URL;
    clearTarsMcpEntryNames();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedUrl === undefined) {
      delete process.env.TARS_AUTH_URL;
    } else {
      process.env.TARS_AUTH_URL = savedUrl;
    }
  });

  it('keeps only assigned, opted-in gateway entries and every other server', async () => {
    mockTars(
      [],
      [
        userServer({ id: 's-github', code: 'github', user_enabled: true }),
        userServer({ id: 's-redmine', code: 'redmine', user_enabled: false }),
      ],
    );

    await expect(filterVisibleTarsMcpConfigs(configs, USER_ID)).resolves.toEqual({
      workflow: configs.workflow,
      tars: configs.tars,
      tars_github: configs.tars_github,
    });
  });

  it('hides every gateway entry from a user with no assignment', async () => {
    mockTars([], []);

    await expect(filterVisibleTarsMcpConfigs(configs, USER_ID)).resolves.toEqual({
      workflow: configs.workflow,
      tars: configs.tars,
    });
  });

  it('fails closed for an unlinked account without asking pwc_tars', async () => {
    const urls = mockTars([], []);

    await expect(filterVisibleTarsMcpConfigs(configs, undefined)).resolves.toEqual({
      workflow: configs.workflow,
      tars: configs.tars,
    });
    expect(urls).toEqual([]);
  });

  it('fails closed when pwc_tars cannot be reached', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ status: 500, ok: false, json: async () => ({}) } as Response);

    await expect(filterVisibleTarsMcpConfigs(configs, USER_ID)).resolves.toEqual({
      workflow: configs.workflow,
      tars: configs.tars,
    });
  });

  it('skips the pwc_tars read when no gateway entry is configured', async () => {
    const urls = mockTars([], []);
    const yamlOnly = { workflow: configs.workflow };

    await expect(filterVisibleTarsMcpConfigs(yamlOnly, USER_ID)).resolves.toBe(yamlOnly);
    expect(urls).toEqual([]);
  });

  it('leaves the config alone when the gateway is not configured', async () => {
    delete process.env.TARS_AUTH_URL;
    const urls = mockTars([], []);

    await expect(filterVisibleTarsMcpConfigs(configs, USER_ID)).resolves.toBe(configs);
    expect(urls).toEqual([]);
  });
});

describe('getUserTarsMcpTools with OIDC servers', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps an enabled OIDC server usable even though pwc_tars lists no tools for it', async () => {
    process.env.TARS_AUTH_URL = BASE_URL;
    clearTarsMcpEntryNames();
    const oidc = userServer({
      id: 's-oidc',
      name: 'Secure',
      code: 'secure',
      type: 'external',
      user_enabled: true,
      auth_type: 'oidc',
      tools: [],
    });
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input) =>
        jsonResponse(envelope(String(input).includes('available-tools') ? [] : [oidc])),
      );
    await expect(getUserTarsMcpTools(USER_ID)).resolves.toEqual([
      expect.objectContaining({
        id: 's-oidc',
        gateway_name: 'tars_secure',
        user_enabled: true,
        tools: [],
      }),
    ]);
  });
});

describe('getUserTarsMcpTools with an OIDC server', () => {
  const setting = userServer({
    id: 's-oidc',
    code: 'demo',
    type: 'external',
    auth_type: 'oidc',
    user_enabled: true,
    tools: [],
    tool_config: { whoami: false },
  });
  const load = jest.fn().mockResolvedValue(
    new Map([
      [
        'tars_demo',
        {
          health_mcp_tars_demo: { function: { description: 'Up?' } },
          whoami_mcp_tars_demo: { function: {} },
          closed_mcp_tars_demo: { function: {} },
        },
      ],
    ]),
  );

  beforeEach(() => {
    process.env.TARS_AUTH_URL = BASE_URL;
    clearTarsMcpEntryNames();
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const { pathname } = new URL(String(input));
      const routes: Record<string, unknown> = {
        '/api/mcp/available-tools': [],
        '/api/mcp/user-settings': [setting],
        '/api/mcp/servers': [
          { id: 's-oidc', tool_config: { enabled_tools: ['health', 'whoami'] } },
        ],
      };
      return jsonResponse(envelope(routes[pathname]));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TARS_AUTH_URL;
  });

  it('offers the chat menu only tools the admin opened and the user left on', async () => {
    const [server] = await getUserTarsMcpTools(USER_ID, load);

    expect(server).toMatchObject({ gateway_name: 'tars_demo', user_enabled: true });
    expect(server.tools).toEqual([
      { name: 'health', description: 'Up?', tool_key: 'health_mcp_tars_demo' },
    ]);
  });
});

describe('withTarsDirectTools', () => {
  const oidcServer = (overrides: Partial<TarsMcpUserServer> = {}): TarsMcpUserServer =>
    userServer({
      id: 's-oidc',
      code: 'demo',
      type: 'external',
      auth_type: 'oidc',
      user_enabled: true,
      tools: [],
      gateway_name: 'tars_demo',
      tool_config: { get_user_id: false },
      ...overrides,
    });
  const catalog = {
    health_mcp_tars_demo: { function: { description: 'Up?', parameters: { type: 'object' } } },
    get_user_id_mcp_tars_demo: { function: {} },
  };

  const allOpen = [{ id: 's-oidc', tool_config: { enabled_tools: ['health', 'get_user_id'] } }];
  const stubServerList = (servers: unknown = allOpen) =>
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(envelope(servers)) as Response);

  beforeEach(() => {
    process.env.TARS_AUTH_URL = BASE_URL;
    stubServerList();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TARS_AUTH_URL;
  });

  it('lists only the tools an admin opened', async () => {
    stubServerList([{ id: 's-oidc', tool_config: { enabled_tools: ['get_user_id'] } }]);
    const load = jest.fn().mockResolvedValue(new Map([['tars_demo', catalog]]));

    const [server] = await withTarsDirectTools([oidcServer()], load);

    expect(server.tools.map((tool) => tool.name)).toEqual(['get_user_id']);
  });

  it('lists nothing until an admin opens a tool', async () => {
    stubServerList([{ id: 's-oidc' }]);
    const load = jest.fn().mockResolvedValue(new Map([['tars_demo', catalog]]));

    const [server] = await withTarsDirectTools([oidcServer()], load);

    expect(server.tools).toEqual([]);
    expect(server.tools_status).toBe('none_opened');
  });

  it('gives up on a server that does not answer, within the limit', async () => {
    const load = jest.fn(
      (_names: string[], signal?: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const [server] = await withTarsDirectTools([oidcServer()], load, 20);

    expect(server.tools).toEqual([]);
    expect(server.tools_status).toBe('timeout');
    expect(load.mock.calls[0][1]?.aborted).toBe(true);
  });

  it('keeps listing a healthy server when another does not answer', async () => {
    stubServerList([...allOpen, { id: 's-stuck', tool_config: { enabled_tools: ['anything'] } }]);
    const load = jest.fn((names: string[], signal?: AbortSignal) =>
      names[0] === 'tars_demo'
        ? Promise.resolve(new Map([['tars_demo', catalog]]))
        : new Promise<never>((_, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
    );

    const [healthy, stuck] = await withTarsDirectTools(
      [oidcServer(), oidcServer({ id: 's-stuck', gateway_name: 'tars_stuck' })],
      load,
      20,
    );

    expect(healthy.tools_status).toBe('ok');
    expect(healthy.tools.map((tool) => tool.name)).toEqual(['health', 'get_user_id']);
    expect(stuck.tools_status).toBe('timeout');
    expect(stuck.tools).toEqual([]);
  });

  it('reports a failed read on that server alone', async () => {
    const load = jest.fn((names: string[]) =>
      names[0] === 'tars_demo'
        ? Promise.resolve(new Map([['tars_demo', catalog]]))
        : Promise.reject(new Error('boom')),
    );

    const [healthy, broken] = await withTarsDirectTools(
      [oidcServer(), oidcServer({ id: 's-broken', gateway_name: 'tars_broken' })],
      load,
    );

    expect(healthy.tools_status).toBe('ok');
    expect(broken.tools_status).toBe('error');
  });

  it("fills an OIDC server's tools from the catalog and applies the user's switches", async () => {
    const load = jest.fn().mockResolvedValue(new Map([['tars_demo', catalog]]));
    const [server] = await withTarsDirectTools([oidcServer()], load);

    expect(load).toHaveBeenCalledWith(['tars_demo'], expect.any(AbortSignal));
    expect(server.tools_status).toBe('ok');
    expect(server.tools).toEqual([
      {
        id: 'health',
        name: 'health',
        description: 'Up?',
        input_schema: { type: 'object' },
        user_enabled: true,
        tool_key: 'health_mcp_tars_demo',
      },
      {
        id: 'get_user_id',
        name: 'get_user_id',
        description: null,
        input_schema: null,
        user_enabled: false,
        tool_key: 'get_user_id_mcp_tars_demo',
      },
    ]);
  });

  it('uses the upstream name for a tool whose key dropped a redundant prefix', async () => {
    stubServerList([{ id: 's-oidc', tool_config: { enabled_tools: ['demo_health'] } }]);
    const stripped = { health_mcp_tars_demo: { serverToolName: 'demo_health', function: {} } };
    const load = jest.fn().mockResolvedValue(new Map([['tars_demo', stripped]]));
    const [server] = await withTarsDirectTools(
      [oidcServer({ tool_config: { demo_health: false } })],
      load,
    );

    expect(server.tools[0]).toMatchObject({ name: 'demo_health', user_enabled: false });
  });

  it('does not load a catalog for a server that is off, not OIDC or has no entry', async () => {
    const load = jest.fn();
    const servers = [
      oidcServer({ user_enabled: false }),
      oidcServer({ auth_type: 'none' }),
      oidcServer({ gateway_name: undefined }),
    ];

    await expect(withTarsDirectTools(servers, load)).resolves.toEqual(servers);
    expect(load).not.toHaveBeenCalled();
  });

  it('leaves the tools empty when the catalog is missing or cannot be read', async () => {
    const empty = await withTarsDirectTools([oidcServer()], jest.fn().mockResolvedValue(new Map()));
    expect(empty[0].tools).toEqual([]);
    expect(empty[0].tools_status).toBe('not_connected');

    const failed = await withTarsDirectTools(
      [oidcServer()],
      jest.fn().mockRejectedValue(new Error('down')),
    );
    expect(failed[0].tools).toEqual([]);
    expect(failed[0].tools_status).toBe('error');
  });
});
