const express = require('express');
const request = require('supertest');

/** Every export is a no-op: the gates under test decide before any handler reaches pwc_tars. */
jest.mock('@librechat/api', () => {
  /** Constants read at module load stay numbers; a stub function would make multer's limits NaN. */
  const stubs = { TARS_TICKET_MAX_FILES: 5, TARS_TICKET_MAX_FILE_MB: 20 };
  return new Proxy(stubs, {
    get: (target, key) => {
      if (key === '__esModule') {
        return false;
      }
      target[key] ??= jest.fn();
      return target[key];
    },
  });
});

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('~/models', () => ({
  getUserById: jest.fn(),
  getConvo: jest.fn(),
  saveConvo: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({ invalidateConfigCaches: jest.fn() }));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: jest.fn((req, res, next) => {
    const header = req.headers['x-test-user'];
    if (!header) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = JSON.parse(header);
    return next();
  }),
  requireTarsAdmin: jest.fn((req, res, next) =>
    req.user?.admin ? next() : res.status(403).json({ error: 'pwc_tars admin access required' }),
  ),
  requireTarsMenuAccess: jest.fn(
    (...keys) =>
      (req, res, next) =>
        req.user?.admin || keys.some((key) => req.user?.menuKeys?.includes(key))
          ? next()
          : res.status(403).json({ error: 'pwc_tars menu access required' }),
  ),
}));

const api = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');
const tarsRouter = require('../tars');

/** Reachable without a JWT on purpose: the MCP gateway checks its own key, the rest serve the login page. */
const PUBLIC_ROUTES = new Set([
  'POST /mcp',
  'GET /mcp',
  'DELETE /mcp',
  'POST /mcp/:serverId',
  'GET /mcp/:serverId',
  'DELETE /mcp/:serverId',
  'GET /settings/logo',
  'GET /settings/license-status',
  'POST /settings/license',
]);

const collectRoutes = (stack) =>
  stack.flatMap((layer) => {
    if (layer.route) {
      const paths = [].concat(layer.route.path);
      const methods = Object.keys(layer.route.methods).filter((method) => method !== '_all');
      return paths.flatMap((path) => methods.map((method) => ({ method, path })));
    }
    return layer.handle?.stack ? collectRoutes(layer.handle.stack) : [];
  });

const toUrl = (path) => `/api/tars${path.replace(/[:*][A-Za-z]+/g, '1')}`;

const user = (fields) => JSON.stringify({ id: 'user-1', tarsId: 7, ...fields });

describe('/api/tars auth gates', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tars', tarsRouter);

  const routes = collectRoutes(tarsRouter.stack);
  const protectedRoutes = routes.filter(
    ({ method, path }) => !PUBLIC_ROUTES.has(`${method.toUpperCase()} ${path}`),
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('finds every sub-router', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(protectedRoutes.length).toBe(routes.length - PUBLIC_ROUTES.size);
  });

  it.each(protectedRoutes.map(({ method, path }) => [method.toUpperCase(), path]))(
    'rejects an unauthenticated %s %s',
    async (method, path) => {
      const res = await request(app)[method.toLowerCase()](toUrl(path));
      expect(res.status).toBe(401);
    },
  );

  it.each([
    ['get', '/domains'],
    ['get', '/models'],
    ['get', '/prompts'],
  ])('lets a non-admin through to %s %s, authenticating once', async (method, path) => {
    const res = await request(app)
      [method](toUrl(path))
      .set('x-test-user', user({ admin: false }));
    expect([401, 403]).not.toContain(res.status);
    expect(requireJwtAuth).toHaveBeenCalledTimes(1);
    expect(requireTarsAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/data-sources/databases'],
    ['get', '/data-sources/file-systems'],
    ['get', '/data-sources/websites'],
    ['get', '/sys-configs'],
    ['get', '/token/configs'],
    ['get', '/usage/openai'],
  ])('keeps %s %s admin-only', async (method, path) => {
    const res = await request(app)
      [method](toUrl(path))
      .set('x-test-user', user({ admin: false }));
    expect(res.status).toBe(403);
    expect(requireJwtAuth).toHaveBeenCalledTimes(1);
  });

  describe('knowledge bases follow the 知識庫清單 grant', () => {
    const KB_LIST_ROUTES = [
      ['get', '/knowledge-bases'],
      ['get', '/knowledge-bases/1/datasets'],
      ['get', '/knowledge-bases/1/documents'],
      ['get', '/knowledge-bases/1/model-bindings'],
      ['get', '/documents/1/chunks'],
      ['get', '/schedules'],
    ];

    it.each(KB_LIST_ROUTES)('refuses %s %s without the grant', async (method, path) => {
      const res = await request(app)
        [method](toUrl(path))
        .set('x-test-user', user({ menuKeys: ['audit.messages'] }));
      expect(res.status).toBe(403);
    });

    it.each(KB_LIST_ROUTES)('opens %s %s to the grant', async (method, path) => {
      const res = await request(app)
        [method](toUrl(path))
        .set('x-test-user', user({ menuKeys: ['kb.list'] }));
      expect([401, 403]).not.toContain(res.status);
      expect(requireJwtAuth).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['get', '/knowledge-bases/models'],
      ['post', '/knowledge-bases'],
      ['post', '/knowledge-bases/upload'],
      ['delete', '/knowledge-bases/1'],
      ['post', '/knowledge-bases/1/documents/retry-stuck'],
      ['post', '/knowledge-bases/1/documents/1/retry-stuck'],
    ])('keeps %s %s admin-only even with the grant', async (method, path) => {
      const res = await request(app)
        [method](toUrl(path))
        .set('x-test-user', user({ menuKeys: ['kb.list'] }));
      expect(res.status).toBe(403);
      expect(requireTarsAdmin).toHaveBeenCalledTimes(1);
    });

    it('refuses an admin-only field on an edit before reaching pwc_tars', async () => {
      api.forbiddenTarsKnowledgeBaseFields.mockReturnValueOnce(['allowed_user_ids']);
      const res = await request(app)
        .put(toUrl('/knowledge-bases/1'))
        .set('x-test-user', user({ menuKeys: ['kb.list'] }))
        .send({ name: 'Renamed', allowed_user_ids: [] });
      expect(res.status).toBe(403);
      expect(api.updateTarsKnowledgeBase).not.toHaveBeenCalled();
    });

    it('passes an edit without admin-only fields through', async () => {
      api.forbiddenTarsKnowledgeBaseFields.mockReturnValueOnce([]);
      const res = await request(app)
        .put(toUrl('/knowledge-bases/1'))
        .set('x-test-user', user({ menuKeys: ['kb.list'] }))
        .send({ name: 'Renamed', new_max_retrieve_count: 10 });
      expect(res.status).toBe(200);
      expect(api.updateTarsKnowledgeBase).toHaveBeenCalledWith(7, '1', {
        name: 'Renamed',
        new_max_retrieve_count: 10,
      });
    });
  });
});
