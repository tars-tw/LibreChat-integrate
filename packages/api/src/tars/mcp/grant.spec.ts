jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import type { TTarsMcpPermissionPrincipal } from 'librechat-data-provider';
import type { TarsDirectory } from '~/tars/directory';
import type { TarsMcpUserServer } from './user';
import { createTarsMcpGrantEnable, newlyGrantedServers } from './grant';

const ADMIN = 'admin-1';

const user = (id: string, servers: string[], is_active = true): TTarsMcpPermissionPrincipal => ({
  principal_type: 'user',
  principal_id: id,
  name: id,
  is_active,
  mcp_server_ids: servers,
  server_count: servers.length,
});

const group = (id: string, servers: string[], is_active = true): TTarsMcpPermissionPrincipal => ({
  ...user(id, servers, is_active),
  principal_type: 'group',
});

const DIRECTORY: TarsDirectory = {
  users: [],
  groups: [{ id: 'g1', name: 'UAT', memberIds: ['bob', 'cat'] }],
};

const WHOLE = (serverId: string) => ({ mcp_server_id: serverId, mcp_tool_ids: [] });

describe('newlyGrantedServers', () => {
  it('names a user assigned a server they did not hold', () => {
    const plan = newlyGrantedServers([user('amy', ['s1'])], [user('amy', ['s1', 's2'])], DIRECTORY);
    expect(plan).toEqual(new Map([['amy', [WHOLE('s2')]]]));
  });

  it("reaches a newly assigned group's active members", () => {
    const plan = newlyGrantedServers([], [group('g1', ['s1'])], DIRECTORY);
    expect(plan).toEqual(
      new Map([
        ['bob', [WHOLE('s1')]],
        ['cat', [WHOLE('s1')]],
      ]),
    );
  });

  it('skips a member who already held the server through another grant', () => {
    const plan = newlyGrantedServers(
      [user('bob', ['s1'])],
      [user('bob', ['s1']), group('g1', ['s1'])],
      DIRECTORY,
    );
    expect(plan).toEqual(new Map([['cat', [WHOLE('s1')]]]));
  });

  it('leaves out disabled users and groups', () => {
    const plan = newlyGrantedServers(
      [],
      [user('amy', ['s1'], false), group('g1', ['s1'], false)],
      DIRECTORY,
    );
    expect(plan.size).toBe(0);
  });

  it('turns nothing on when a save only removes', () => {
    const plan = newlyGrantedServers([user('amy', ['s1', 's2'])], [user('amy', ['s1'])], DIRECTORY);
    expect(plan.size).toBe(0);
  });
});

describe('createTarsMcpGrantEnable', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['TARS_AUTH_URL', 'TARS_JWT_SECRET', 'TARS_MCP_ENABLED']) {
      saved[key] = process.env[key];
    }
    process.env.TARS_AUTH_URL = 'http://tars.test';
    process.env.TARS_JWT_SECRET = 'grant-enable-test-secret';
    delete process.env.TARS_MCP_ENABLED;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const jsonResponse = (data: unknown): Response =>
    ({ status: 200, ok: true, json: async () => ({ success: true, data }) }) as unknown as Response;

  const setting = (overrides: Partial<TarsMcpUserServer> = {}): TarsMcpUserServer => ({
    id: 's2',
    name: 'Weather',
    type: 'openapi',
    is_enabled: true,
    user_enabled: false,
    requires_user_credentials: false,
    has_credentials: false,
    auth_type: 'none',
    login_fields: [],
    tool_config: {},
    tools: [{ id: 't1', name: 'forecast', user_enabled: true }],
    ...overrides,
  });

  /** Serves the grant overview (before, then after the save) and My Tools; records writes. */
  const mockTars = (overviews: TTarsMcpPermissionPrincipal[][], settings: unknown[]) => {
    const writes: unknown[] = [];
    let overviewReads = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/mcp/permission/principals') {
        const overview = overviews[Math.min(overviewReads, overviews.length - 1)];
        overviewReads += 1;
        return jsonResponse(overview);
      }
      if (url.pathname === '/api/mcp/user-settings' && init?.method === 'PUT') {
        writes.push(JSON.parse(String(init.body)));
        return jsonResponse({});
      }
      if (url.pathname === '/api/mcp/user-settings') {
        return jsonResponse(settings);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    return { writes, overviewReads: () => overviewReads };
  };

  const directory = { refresh: jest.fn().mockResolvedValue(DIRECTORY) };

  /** Lets the work started after the save run to completion. */
  const settle = async () => {
    for (let round = 0; round < 30; round += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  it('saves, then turns the new server on for the newly assigned user', async () => {
    const { writes } = mockTars([[user('amy', ['s1'])], [user('amy', ['s1', 's2'])]], [setting()]);
    const save = jest.fn().mockResolvedValue({ server_count: 2 });

    const result = await createTarsMcpGrantEnable({ directory }).saveThenEnable(ADMIN, save);
    await settle();

    expect(result).toEqual({ server_count: 2 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([{ user_id: 'amy', server_id: 's2', is_enabled: true }]);
  });

  it('keeps a server off while it waits for the user to give credentials', async () => {
    const { writes } = mockTars(
      [[], [user('amy', ['s2'])]],
      [setting({ requires_user_credentials: true })],
    );

    await createTarsMcpGrantEnable({ directory }).saveThenEnable(ADMIN, async () => ({}));
    await settle();

    expect(writes).toEqual([]);
  });

  it('leaves alone someone already assigned, even if they switched it off', async () => {
    const { writes } = mockTars([[user('amy', ['s2'])], [user('amy', ['s2'])]], [setting()]);

    await createTarsMcpGrantEnable({ directory }).saveThenEnable(ADMIN, async () => ({}));
    await settle();

    expect(writes).toEqual([]);
  });

  it('still saves when the grants cannot be read first, and turns nothing on', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('pwc_tars down'));
    const save = jest.fn().mockResolvedValue({ ok: true });

    const result = await createTarsMcpGrantEnable({ directory }).saveThenEnable(ADMIN, save);
    await settle();

    expect(result).toEqual({ ok: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('resolves the save even when enabling fails afterwards', async () => {
    let reads = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      reads += 1;
      if (reads === 1) {
        return jsonResponse([]);
      }
      throw new Error('pwc_tars down');
    });

    const result = await createTarsMcpGrantEnable({ directory }).saveThenEnable(
      ADMIN,
      async () => 'saved',
    );
    await settle();

    expect(result).toBe('saved');
  });

  it('does not read the grants when the gateway is off', async () => {
    process.env.TARS_MCP_ENABLED = 'false';
    const { overviewReads } = mockTars([[]], []);

    await createTarsMcpGrantEnable({ directory }).saveThenEnable(ADMIN, async () => ({}));
    await settle();

    expect(overviewReads()).toBe(0);
  });

  it('lets a failed save reject without turning anything on', async () => {
    const { writes, overviewReads } = mockTars([[], [user('amy', ['s2'])]], [setting()]);

    await expect(
      createTarsMcpGrantEnable({ directory }).saveThenEnable(ADMIN, async () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    await settle();

    expect(overviewReads()).toBe(1);
    expect(writes).toEqual([]);
  });
});
