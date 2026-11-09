const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

const mockInvalidateTools = jest.fn();
const mockInvalidateConfig = jest.fn();

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  invalidateTarsMcpToolsCache: () => mockInvalidateTools(),
}));

jest.mock('~/server/services/Config', () => ({
  invalidateConfigCaches: () => mockInvalidateConfig(),
}));

const mockGetUserById = jest.fn();
const mockLoadCatalogs = jest.fn();
const mockResolveConfigs = jest.fn();

jest.mock('~/models', () => ({ getUserById: (...args) => mockGetUserById(...args) }));

jest.mock('~/config', () => ({
  getMCPServersRegistry: () => ({
    resolveAllowlists: async () => ({ allowedDomains: null, allowedAddresses: null }),
  }),
}));

jest.mock('~/server/services/MCP', () => ({
  resolveAllMcpConfigs: (...args) => mockResolveConfigs(...args),
}));

jest.mock('~/server/services/Tools/mcp', () => ({
  loadMCPServerCatalogs: (...args) => mockLoadCatalogs(...args),
}));

const mockTeardown = jest.fn();

jest.mock(
  '~/server/services/tarsOidcTeardown',
  () =>
    (...args) =>
      mockTeardown(...args),
);

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
  requireTarsAdmin: jest.requireActual('~/server/middleware/requireTarsAdmin'),
  configMiddleware: (req, _res, next) => {
    req.config = { config: { tars: { directToolCatalogTimeoutMs: 1234 } } };
    next();
  },
}));

const SECRET = 'mcp-permission-route-test-secret';
const ADMIN = { tarsId: 'tars-admin-1', tarsRoleId: 1 };
const MEMBER = { tarsId: 'tars-user-2', tarsRoleId: 2 };

const mcpRouter = require('./mcp');

/** The app parses JSON bodies globally (`api/server/index.js`). */
const app = express().use(express.json()).use('/api/tars', mcpRouter);

const as = (user, req) => req.set('x-test-user', JSON.stringify(user));

const envelope = (data) => ({ success: true, message: '成功', data });

const jsonResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

/** What reached pwc_tars: path, query, method, body and the user the bearer was signed for. */
const tarsCall = (fetchMock, call = 0) => {
  const [input, init] = fetchMock.mock.calls[call];
  const url = new URL(String(input));
  return {
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    method: init.method ?? 'GET',
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    actingUser: jwt.verify(init.headers.Authorization.slice('Bearer '.length), SECRET).user_id,
  };
};

describe('TARS MCP permission admin routes', () => {
  const saved = {};

  beforeEach(() => {
    for (const key of ['TARS_AUTH_URL', 'TARS_JWT_SECRET']) {
      saved[key] = process.env[key];
    }
    process.env.TARS_AUTH_URL = 'http://tars.test';
    process.env.TARS_JWT_SECRET = SECRET;
    mockInvalidateTools.mockClear();
    mockInvalidateConfig.mockClear();
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

  it('refuses non-admins before calling pwc_tars', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await as(MEMBER, request(app).get('/api/tars/mcp/admin/permissions/principals'));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists principals as the acting admin', async () => {
    const principals = [{ principal_type: 'user', principal_id: 'u1', name: 'Amy' }];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope(principals)));

    const res = await as(ADMIN, request(app).get('/api/tars/mcp/admin/permissions/principals'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ principals });
    expect(tarsCall(fetchMock)).toMatchObject({
      path: '/api/mcp/permission/principals',
      actingUser: ADMIN.tarsId,
    });
  });

  it('reads one principal by its query id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope([])));

    const res = await as(
      ADMIN,
      request(app).get('/api/tars/mcp/admin/permissions?user_group_id=g1'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ permissions: [] });
    expect(tarsCall(fetchMock)).toMatchObject({
      path: '/api/mcp/permission',
      query: { user_group_id: 'g1' },
    });
  });

  it('saves and invalidates the MCP caches', async () => {
    const result = { user_ids: ['u1'], user_group_ids: [], server_count: 1 };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope(result)));
    const payload = {
      user_ids: ['u1'],
      user_group_ids: [],
      servers: [{ mcp_server_id: 's1', mcp_tool_ids: ['t1'] }],
    };

    const res = await as(
      ADMIN,
      request(app).post('/api/tars/mcp/admin/permissions/save').send(payload),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result });
    expect(tarsCall(fetchMock)).toMatchObject({
      path: '/api/mcp/permission/save',
      method: 'POST',
      body: payload,
      actingUser: ADMIN.tarsId,
    });
    expect(mockInvalidateTools).toHaveBeenCalledTimes(1);
    expect(mockInvalidateConfig).toHaveBeenCalledTimes(1);
  });

  it("relays pwc_tars's validation message without invalidating anything", async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(400, { success: false, message: '已停用的群組不可編輯：TARS_AIS' }),
      );

    const res = await as(
      ADMIN,
      request(app)
        .post('/api/tars/mcp/admin/permissions/save')
        .send({ user_group_ids: ['g2'], servers: [] }),
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '已停用的群組不可編輯：TARS_AIS' });
    expect(mockInvalidateTools).not.toHaveBeenCalled();
  });

  it('removes one principal and invalidates the MCP caches', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope({ deleted: 2 })));

    const res = await as(ADMIN, request(app).delete('/api/tars/mcp/admin/permissions?user_id=u1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 2 });
    expect(tarsCall(fetchMock)).toMatchObject({
      path: '/api/mcp/permission',
      query: { user_id: 'u1' },
      method: 'DELETE',
    });
    expect(mockInvalidateTools).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/tars/mcp/user/tools', () => {
  const savedUrl = process.env.TARS_AUTH_URL;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = 'http://tars.test';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedUrl === undefined) {
      delete process.env.TARS_AUTH_URL;
    } else {
      process.env.TARS_AUTH_URL = savedUrl;
    }
  });

  it("serves the caller's assigned servers without any brain in the request", async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope([])));

    const res = await as(MEMBER, request(app).get('/api/tars/mcp/user/tools'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ servers: [] });
    const asked = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(asked.map((url) => url.pathname).sort()).toEqual([
      '/api/mcp/available-tools',
      '/api/mcp/user-settings',
    ]);
    for (const url of asked) {
      expect(Object.fromEntries(url.searchParams.entries())).toEqual({ user_id: MEMBER.tarsId });
    }
  });

  it('refuses an account that is not linked to pwc_tars', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await as({ tarsRoleId: 2 }, request(app).get('/api/tars/mcp/user/tools'));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TARS OIDC server token teardown', () => {
  const saved = {};
  const OIDC = {
    id: 's1',
    name: 'Demo',
    code: 'demo',
    type: 'external',
    is_enabled: true,
    connection_config: {
      transport: 'streamable_http',
      url: 'https://mcp.example.com/mcp',
      auth: { type: 'oidc', issuer: 'https://idp.example.com', client_id: 'c1' },
    },
  };
  const ADMIN_USER = { ...ADMIN, id: 'mongo-admin' };
  const SERVER_PATH = '/api/mcp/servers/s1';
  let fetchMock;

  const stub = (reply = {}) => {
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const { pathname } = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (reply[`${method} ${pathname}`] instanceof Error) {
        throw reply[`${method} ${pathname}`];
      }
      const fallback = pathname === '/api/mcp/servers' && method === 'GET' ? [OIDC] : {};
      return jsonResponse(200, envelope(reply[`${method} ${pathname}`] ?? fallback));
    });
  };

  const tornDown = () => mockTeardown.mock.calls[0][0].map((target) => target.serverId);

  beforeEach(() => {
    saved.TARS_AUTH_URL = process.env.TARS_AUTH_URL;
    saved.TARS_JWT_SECRET = process.env.TARS_JWT_SECRET;
    process.env.TARS_AUTH_URL = 'http://tars.test';
    process.env.TARS_JWT_SECRET = SECRET;
    mockTeardown.mockReset().mockResolvedValue(undefined);
    mockInvalidateTools.mockClear();
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

  it('clears the tokens after pwc_tars deleted the server and the caches are dropped', async () => {
    stub();
    const res = await as(ADMIN_USER, request(app).delete('/api/tars/mcp/admin/servers/s1'));

    expect(res.status).toBe(200);
    expect(tornDown()).toEqual(['s1']);
    expect(mockTeardown.mock.calls[0][1]).toBe('mongo-admin');
    expect(mockTeardown.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockInvalidateTools.mock.invocationCallOrder[0],
    );
  });

  it('keeps the tokens when pwc_tars refused the delete', async () => {
    stub({ [`DELETE ${SERVER_PATH}`]: new Error('refused') });
    const res = await as(ADMIN_USER, request(app).delete('/api/tars/mcp/admin/servers/s1'));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockTeardown).not.toHaveBeenCalled();
  });

  it('does not delete when the server could not be read first', async () => {
    stub({ 'GET /api/mcp/servers': new Error('down') });
    const res = await as(ADMIN_USER, request(app).delete('/api/tars/mcp/admin/servers/s1'));

    expect(res.status).toBeGreaterThanOrEqual(400);
    const methods = fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET');
    expect(methods).not.toContain('DELETE');
  });

  it('skips a deleted server that is not OIDC', async () => {
    stub({ 'GET /api/mcp/servers': [{ ...OIDC, connection_config: { auth: { type: 'none' } } }] });
    await as(ADMIN_USER, request(app).delete('/api/tars/mcp/admin/servers/s1'));

    expect(tornDown()).toEqual([]);
  });

  it('clears only what a batch actually deleted', async () => {
    stub({
      'GET /api/mcp/servers': [OIDC, { ...OIDC, id: 's2', code: 'kept' }],
      'POST /api/mcp/servers/batch-delete': {
        deleted: [{ id: 's1', name: 'Demo' }],
        skipped: [{ id: 's2', name: 'Kept', reason: 'builtin' }],
        not_found: [],
      },
    });
    const res = await as(
      ADMIN_USER,
      request(app)
        .post('/api/tars/mcp/admin/servers/batch-delete')
        .send({ ids: ['s1', 's2'] }),
    );

    expect(res.status).toBe(200);
    expect(tornDown()).toEqual(['s1']);
  });

  it('clears the tokens when an update re-points the server', async () => {
    stub({
      [`PUT ${SERVER_PATH}`]: {
        ...OIDC,
        connection_config: { ...OIDC.connection_config, url: 'https://new.example.com/mcp' },
      },
    });
    await as(
      ADMIN_USER,
      request(app).put('/api/tars/mcp/admin/servers/s1').send({ is_enabled: true }),
    );

    expect(tornDown()).toEqual(['s1']);
  });

  it('keeps the tokens when an update changes nothing they depend on', async () => {
    stub({ [`PUT ${SERVER_PATH}`]: { ...OIDC, name: 'Renamed' } });
    await as(
      ADMIN_USER,
      request(app).put('/api/tars/mcp/admin/servers/s1').send({ name: 'Renamed' }),
    );

    expect(tornDown()).toEqual([]);
  });
});

describe('TARS OIDC MCP tool routes', () => {
  const { canUseTarsDirectMcpServer } = require('@librechat/api');
  const saved = {};
  const SERVER = {
    id: 's1',
    code: 'demo',
    type: 'external',
    is_enabled: true,
    tool_config: { enabled_tools: ['health'] },
    connection_config: { auth: { type: 'oidc', issuer: 'https://idp.example.com' } },
  };
  const CATALOG = new Map([
    [
      'tars_demo',
      {
        health_mcp_tars_demo: { function: { description: 'Up?' } },
        whoami_mcp_tars_demo: { function: {} },
      },
    ],
  ]);
  const SETTING = {
    id: 's1',
    code: 'demo',
    type: 'external',
    is_enabled: true,
    user_enabled: true,
    auth_type: 'oidc',
    tool_config: {},
    tools: [],
  };
  let fetchMock;

  const respondByPath = (routes) => {
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const { pathname } = new URL(String(input));
      return jsonResponse(200, envelope(routes[pathname] ?? {}));
    });
  };

  beforeEach(() => {
    saved.TARS_AUTH_URL = process.env.TARS_AUTH_URL;
    saved.TARS_JWT_SECRET = process.env.TARS_JWT_SECRET;
    process.env.TARS_AUTH_URL = 'http://tars.test';
    process.env.TARS_JWT_SECRET = SECRET;
    mockInvalidateTools.mockClear();
    mockInvalidateConfig.mockClear();
    mockLoadCatalogs.mockReset().mockResolvedValue({ serverTools: CATALOG });
    mockResolveConfigs.mockReset().mockResolvedValue({ tars_demo: { oauth: {} } });
    mockGetUserById.mockReset();
    respondByPath({
      '/api/mcp/servers': [SERVER],
      '/api/mcp/servers/s1': SERVER,
      '/api/mcp/user-settings': [SETTING],
      '/api/mcp/available-tools': [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('lists the admin catalog with only the opened tools on', async () => {
    const response = await as(
      ADMIN,
      request(app).get('/api/tars/mcp/admin/servers/s1/direct-tools'),
    ).expect(200);

    expect(response.body.tools).toEqual([
      { name: 'health', description: 'Up?', is_enabled: true },
      { name: 'whoami', description: null, is_enabled: false },
    ]);
    expect(response.body.tools_status).toBe('ok');
    expect(mockLoadCatalogs.mock.calls[0][0].servers).toEqual([
      { serverName: 'tars_demo', serverConfig: { oauth: {} } },
    ]);
  });

  it('saves the allow-list and refreshes the caches', async () => {
    const response = await as(
      ADMIN,
      request(app)
        .put('/api/tars/mcp/admin/servers/s1/direct-tools')
        .send({ enabled_tools: ['whoami'] }),
    ).expect(200);

    expect(response.body).toEqual({ enabled_tools: ['whoami'] });
    const put = fetchMock.mock.calls.find(([, init]) => init.method === 'PUT');
    expect(JSON.parse(put[1].body).tool_config.enabled_tools).toEqual(['whoami']);
    expect(mockInvalidateTools).toHaveBeenCalled();
    expect(mockInvalidateConfig).toHaveBeenCalled();
  });

  it('keeps both routes from a non-admin', async () => {
    const path = '/api/tars/mcp/admin/servers/s1/direct-tools';
    await as(MEMBER, request(app).get(path)).expect(403);
    await as(MEMBER, request(app).put(path).send({ enabled_tools: [] })).expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows My Tools only the opened tools, read from the user catalog', async () => {
    const response = await as(MEMBER, request(app).get('/api/tars/mcp/user/settings')).expect(200);

    expect(response.body.servers[0].tools.map((tool) => tool.name)).toEqual(['health']);
    expect(response.body.servers[0].tools_status).toBe('ok');
  });

  it('applies the configured limit to a catalog that does not answer', async () => {
    const timeout = jest.spyOn(global, 'setTimeout');
    mockLoadCatalogs.mockResolvedValue({ serverTools: new Map() });

    await as(MEMBER, request(app).get('/api/tars/mcp/user/tools')).expect(200);

    expect(timeout.mock.calls.some(([, ms]) => ms === 1234)).toBe(true);
  });

  it('resolves a background caller by its LibreChat id, as the route wired it', async () => {
    mockGetUserById.mockResolvedValue({ tarsId: 'tars-user-2' });

    await expect(
      canUseTarsDirectMcpServer('tars_demo', { oauth: {} }, { id: 'mongo-1' }),
    ).resolves.toBe(true);
    expect(mockGetUserById).toHaveBeenCalledWith('mongo-1', 'tarsId');
  });
});
