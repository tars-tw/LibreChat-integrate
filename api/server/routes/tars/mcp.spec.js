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

jest.mock('~/models', () => ({ getUserById: jest.fn() }));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
  requireTarsAdmin: jest.requireActual('~/server/middleware/requireTarsAdmin'),
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
