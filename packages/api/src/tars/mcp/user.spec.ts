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
import { filterVisibleTarsMcpConfigs, getUserTarsMcpTools } from './user';
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
