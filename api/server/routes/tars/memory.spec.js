const express = require('express');
const request = require('supertest');
const { Permissions } = require('librechat-data-provider');

/** Each request names the role's MEMORIES grants it should run under. */
let mockGrants = {};
let mockTarsConfig = {};
const mockUpdateAutoUpdate = jest.fn(async () => ({}));

jest.mock('~/models', () => {
  const { PermissionTypes: types } = jest.requireActual('librechat-data-provider');
  return {
    getRoleByName: async () => ({ permissions: { [types.MEMORIES]: mockGrants } }),
    updateUserMemoryAutoUpdate: (...args) => mockUpdateAutoUpdate(...args),
  };
});

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'lc-1', tarsId: '42', role: 'USER' };
    next();
  },
  configMiddleware: (req, _res, next) => {
    req.config = { config: { tars: mockTarsConfig } };
    next();
  },
}));

const memoryRouter = require('./memory');

/** The app parses JSON bodies globally (`api/server/index.js`). */
const app = express().use(express.json()).use('/api/tars', memoryRouter);

const all = {
  [Permissions.USE]: true,
  [Permissions.READ]: true,
  [Permissions.CREATE]: true,
  [Permissions.UPDATE]: true,
  [Permissions.OPT_OUT]: true,
};

const routes = [
  ['GET', '/api/tars/memory', Permissions.READ],
  ['POST', '/api/tars/memory', Permissions.CREATE],
  ['DELETE', '/api/tars/memory', Permissions.UPDATE],
  ['PUT', '/api/tars/memory/1', Permissions.UPDATE],
  ['DELETE', '/api/tars/memory/1', Permissions.UPDATE],
  ['PATCH', '/api/tars/memory/preferences', Permissions.OPT_OUT],
];

const send = (method, path) =>
  request(app)[method.toLowerCase()](path).send({ content: 'a', memoryAutoUpdate: false });

describe('/api/tars/memory routes', () => {
  let fetchMock;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = 'http://tars.test';
    process.env.TARS_JWT_SECRET = 'memory-route-test-secret';
    mockGrants = { ...all };
    mockTarsConfig = {};
    mockUpdateAutoUpdate.mockClear();
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: [] }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TARS_AUTH_URL;
    delete process.env.TARS_JWT_SECRET;
  });

  it.each(routes)('%s %s is open to a role holding USE and %s', async (method, path) => {
    const response = await send(method, path);
    expect(response.status).toBeLessThan(400);
  });

  it.each(routes)('%s %s refuses a role without %s', async (method, path, permission) => {
    mockGrants = { ...all, [permission]: false };
    const response = await send(method, path);
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpdateAutoUpdate).not.toHaveBeenCalled();
  });

  it.each(routes)('%s %s refuses a role without USE', async (method, path) => {
    mockGrants = { ...all, [Permissions.USE]: false };
    const response = await send(method, path);
    expect(response.status).toBe(403);
  });

  it.each(routes)('%s %s is gone while tars.memoryAssist.enabled is off', async (method, path) => {
    mockTarsConfig = { memoryAssist: { enabled: false } };
    const response = await send(method, path);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpdateAutoUpdate).not.toHaveBeenCalled();
  });
});
