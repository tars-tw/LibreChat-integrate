const express = require('express');
const request = require('supertest');

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
  requireTarsMenuAccess: jest.requireActual('~/server/middleware/requireTarsMenuAccess'),
}));

const datasetsRouter = require('./datasets');

const TARS_URL = 'http://tars.test';
const SECRET = 'datasets-route-secret-0123456789abcdef';
const MANAGER = { tarsId: 'u-1', tarsRoleId: 109, tarsAdminMenuKeys: ['kb.list'] };
const OUTSIDER = { tarsId: 'u-2', tarsRoleId: 110, tarsAdminMenuKeys: [] };
const KB = '/api/tars/knowledge-bases/kb1';

/** The app parses JSON bodies globally (`api/server/index.js`). */
const app = express().use(express.json()).use('/api/tars', datasetsRouter);

const as = (user, call) => call(request(app)).set('x-test-user', JSON.stringify(user));

const reply = (status, body) => ({
  status,
  ok: status < 300,
  json: async () => body,
});

const sentTo = (fetchMock) => {
  const [input, init] = fetchMock.mock.calls[0];
  const url = new URL(String(input));
  return {
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body: init.body ? JSON.parse(init.body) : undefined,
  };
};

describe('knowledge base data security routes', () => {
  const saved = { url: process.env.TARS_AUTH_URL, secret: process.env.TARS_JWT_SECRET };
  let fetchMock;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = TARS_URL;
    process.env.TARS_JWT_SECRET = SECRET;
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(reply(200, { success: true, data: [] }));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    process.env.TARS_AUTH_URL = saved.url;
    process.env.TARS_JWT_SECRET = saved.secret;
    if (saved.url === undefined) {
      delete process.env.TARS_AUTH_URL;
    }
    if (saved.secret === undefined) {
      delete process.env.TARS_JWT_SECRET;
    }
  });

  it.each([
    ['get', `${KB}/data-security`],
    ['put', `${KB}/data-security/1`],
    ['post', `${KB}/datasets/level`],
  ])('refuses %s %s without the knowledge base menu', async (method, path) => {
    const res = await as(OUTSIDER, (agent) => agent[method](path));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the levels of the knowledge base in the path', async () => {
    const assignments = [{ id: '1', name: '高度機密', order: 1, principals: [] }];
    fetchMock.mockResolvedValue(reply(200, { success: true, data: assignments }));

    const res = await as(MANAGER, (agent) => agent.get(`${KB}/data-security`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ assignments });
    expect(sentTo(fetchMock)).toMatchObject({
      path: '/api/data_security/assignments',
      query: { knowledge_base_id: 'kb1' },
    });
  });

  it('saves the level in the path', async () => {
    const principals = [{ principal_type: 'user', principal_id: 'p1' }];

    const res = await as(MANAGER, (agent) =>
      agent.put(`${KB}/data-security/2`).send({ principals }),
    );

    expect(res.status).toBe(200);
    expect(sentTo(fetchMock)).toMatchObject({
      path: '/api/data_security/assignments/save',
      body: { knowledge_base_id: 'kb1', data_security_level_id: '2', principals },
    });
  });

  it('passes an explicit clear through to pwc_tars', async () => {
    const res = await as(MANAGER, (agent) =>
      agent.post(`${KB}/datasets/level`).send({ dataSecurityLevelId: null, documentIds: ['d1'] }),
    );

    expect(res.status).toBe(200);
    expect(sentTo(fetchMock).body).toEqual({
      knowledge_base_id: 'kb1',
      data_security_level_id: null,
      document_ids: ['d1'],
    });
  });

  it("relays pwc_tars's refusal with its reason", async () => {
    fetchMock.mockResolvedValue(reply(403, { success: false, message: '沒有權限設定這個知識庫' }));

    const res = await as(MANAGER, (agent) => agent.get(`${KB}/data-security`));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: '沒有權限設定這個知識庫' });
  });

  it('forwards the level chosen when importing a document group', async () => {
    const res = await as(MANAGER, (agent) =>
      agent.post(`${KB}/file-systems/fs1`).send({ name: 'Reports', dataSecurityLevelId: '1' }),
    );

    expect(res.status).toBe(201);
    expect(sentTo(fetchMock)).toMatchObject({
      path: '/api/knowledge_detail/upload_file_server_files',
      body: { dataset_file_system_id: 'fs1', data_security_level_id: '1' },
    });
  });
});
