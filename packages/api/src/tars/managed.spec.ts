jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import express from 'express';
import request from 'supertest';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { TarsAccessUser } from '~/auth/tars';
import {
  checkTarsKnowledgeAccess,
  tarsScheduleTargetOf,
  tarsKnowledgeTargetOf,
  canUseTarsAdminPageNow,
  withTarsAdminMenuKeys,
  resolveTarsAdminMenuKeys,
  requireTarsScheduleAccess,
  requireTarsKnowledgeBase,
} from './access';
import {
  fetchTarsManagedKnowledgeBases,
  invalidateTarsManagedKnowledgeBasesCache,
} from './managed';
import { updateTarsKnowledgeBase } from './knowledge';

const BASE_URL = 'http://tars.test';
const MANAGER = { tarsId: 'u-manager', tarsRoleId: 2, tarsAdminMenuKeys: [] as string[] };
const OUTSIDER = { tarsId: 'u-outsider', tarsRoleId: 2, tarsAdminMenuKeys: [] as string[] };
const ADMIN = { tarsId: 'u-admin', tarsRoleId: 1, tarsAdminMenuKeys: [] as string[] };

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

/** pwc_tars: the manager manages kb1; doc-1/chunk-1/web-1/fs-1/sch-1 live in kb1, doc-2 in kb2. */
const OWNERS: Record<string, Record<string, string[]>> = {
  document_ids: { 'doc-1': ['kb1'], 'doc-2': ['kb2'] },
  chunk_ids: { 'chunk-1': ['kb1'], 'chunk-2': ['kb2'] },
  website_ids: { 'web-1': ['kb1', 'kb2'], 'web-2': ['kb2'] },
  sql_binding_ids: { 'bind-1': ['kb1'] },
  file_system_association_ids: { 'fs-1': ['kb1'], 'fs-2': ['kb2'] },
  schedule_ids: { 'sch-1': ['kb1'], 'sch-2': ['kb2'] },
};

const mockBackend = (managed: Record<string, string[]> = { 'u-manager': ['kb1'] }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/km_permission/managed_knowledge_bases') {
      const userId = url.searchParams.get('user_id') ?? '';
      return buildResponse(200, {
        success: true,
        data: { all: false, knowledge_base_ids: managed[userId] ?? [] },
      });
    }
    if (url.pathname === '/api/km_permission/resource_owners') {
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, string[]>;
      const data = Object.fromEntries(
        Object.entries(body).map(([type, ids]) => [
          type,
          Object.fromEntries(
            ids.filter((id) => OWNERS[type]?.[id]).map((id) => [id, OWNERS[type][id]]),
          ),
        ]),
      );
      return buildResponse(200, { success: true, data });
    }
    if (url.pathname.startsWith('/api/knowledge_base/update_knowledge_base/')) {
      return buildResponse(200, { knowledge_base: { id: 'kb1', name: 'HR' } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const callsTo = (fetchMock: jest.SpyInstance, path: string) =>
  fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname === path).length;

const MANAGED_PATH = '/api/km_permission/managed_knowledge_bases';
const OWNERS_PATH = '/api/km_permission/resource_owners';

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsManagedKnowledgeBasesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchTarsManagedKnowledgeBases', () => {
  it('reads the management list once a minute and shares a request in flight', async () => {
    const fetchMock = mockBackend();

    const [first, second] = await Promise.all([
      fetchTarsManagedKnowledgeBases('u-manager'),
      fetchTarsManagedKnowledgeBases('u-manager'),
    ]);
    await fetchTarsManagedKnowledgeBases('u-manager');

    expect(first).toEqual({ all: false, ids: new Set(['kb1']) });
    expect(second).toBe(first);
    expect(callsTo(fetchMock, MANAGED_PATH)).toBe(1);

    invalidateTarsManagedKnowledgeBasesCache();
    await fetchTarsManagedKnowledgeBases('u-manager');
    expect(callsTo(fetchMock, MANAGED_PATH)).toBe(2);
  });

  it('is dropped when a knowledge base management list is saved', async () => {
    const fetchMock = mockBackend();
    await fetchTarsManagedKnowledgeBases('u-manager');

    await updateTarsKnowledgeBase('u-admin', 'kb1', { name: 'HR' });
    await fetchTarsManagedKnowledgeBases('u-manager');
    expect(callsTo(fetchMock, MANAGED_PATH)).toBe(1);

    await updateTarsKnowledgeBase('u-admin', 'kb1', { allowed_user_ids: ['u-manager'] });
    await fetchTarsManagedKnowledgeBases('u-manager');
    expect(callsTo(fetchMock, MANAGED_PATH)).toBe(2);
  });
});

describe('知識庫清單 entry', () => {
  it('adds 知識庫清單 for anyone on a management list', async () => {
    mockBackend();

    await expect(resolveTarsAdminMenuKeys(MANAGER)).resolves.toEqual(['kb.list']);
    await expect(
      resolveTarsAdminMenuKeys({ ...MANAGER, tarsAdminMenuKeys: ['prompt.list'] }),
    ).resolves.toEqual(['prompt.list', 'kb.list']);
    await expect(resolveTarsAdminMenuKeys(OUTSIDER)).resolves.toEqual([]);
  });

  it('asks pwc_tars only when the answer can change', async () => {
    const fetchMock = mockBackend();
    const roleGranted = { ...OUTSIDER, tarsAdminMenuKeys: ['kb.list'] };

    await expect(resolveTarsAdminMenuKeys(roleGranted)).resolves.toBe(
      roleGranted.tarsAdminMenuKeys,
    );
    await expect(resolveTarsAdminMenuKeys(ADMIN)).resolves.toBe(ADMIN.tarsAdminMenuKeys);
    await expect(resolveTarsAdminMenuKeys({ tarsAdminMenuKeys: ['x'] })).resolves.toEqual(['x']);
    await expect(resolveTarsAdminMenuKeys(null)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the role grants when pwc_tars cannot answer', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

    await expect(
      resolveTarsAdminMenuKeys({ ...MANAGER, tarsAdminMenuKeys: ['prompt.list'] }),
    ).resolves.toEqual(['prompt.list']);
  });

  it('decorates the user a loader returns, leaving others untouched', async () => {
    mockBackend();
    const load = withTarsAdminMenuKeys(
      async (id: string): Promise<TarsAccessUser & { name: string }> =>
        id === 'local' ? { name: 'local user' } : { ...MANAGER, name: 'manager' },
    );

    await expect(load('manager')).resolves.toEqual({
      ...MANAGER,
      name: 'manager',
      tarsAdminMenuKeys: ['kb.list'],
    });
    await expect(load('local')).resolves.toEqual({ name: 'local user' });
  });

  it('opens 知識庫清單 pages to managers, and nothing else', async () => {
    const fetchMock = mockBackend();

    await expect(canUseTarsAdminPageNow(MANAGER, ['kb.list'])).resolves.toBe(true);
    await expect(canUseTarsAdminPageNow(OUTSIDER, ['kb.list'])).resolves.toBe(false);
    const before = fetchMock.mock.calls.length;
    await expect(canUseTarsAdminPageNow(MANAGER, ['prompt.list'])).resolves.toBe(false);
    await expect(canUseTarsAdminPageNow(ADMIN, ['prompt.list'])).resolves.toBe(true);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('fails closed when pwc_tars cannot answer', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

    await expect(canUseTarsAdminPageNow(MANAGER, ['kb.list'])).resolves.toBe(false);
  });
});

describe('checkTarsKnowledgeAccess', () => {
  it('lets an admin through without asking pwc_tars', async () => {
    const fetchMock = mockBackend();

    await expect(
      checkTarsKnowledgeAccess(ADMIN, { knowledgeBaseId: 'kb2', resources: { document_ids: 'x' } }),
    ).resolves.toBe('allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors pwc_tars saying the user manages everything', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(200, { success: true, data: { all: true, knowledge_base_ids: [] } }),
      );

    await expect(checkTarsKnowledgeAccess(MANAGER, { knowledgeBaseId: 'kb9' })).resolves.toBe(
      'allowed',
    );
  });

  it('allows only knowledge bases on the management list', async () => {
    const fetchMock = mockBackend();

    await expect(checkTarsKnowledgeAccess(MANAGER, { knowledgeBaseId: 'kb1' })).resolves.toBe(
      'allowed',
    );
    await expect(checkTarsKnowledgeAccess(MANAGER, { knowledgeBaseId: 'kb2' })).resolves.toBe(
      'forbidden',
    );
    await expect(checkTarsKnowledgeAccess(OUTSIDER, { knowledgeBaseId: 'kb1' })).resolves.toBe(
      'forbidden',
    );
    await expect(checkTarsKnowledgeAccess({}, { knowledgeBaseId: 'kb1' })).resolves.toBe(
      'forbidden',
    );
    expect(callsTo(fetchMock, OWNERS_PATH)).toBe(0);
  });

  it('requires every named dataset to belong to the knowledge base in the path', async () => {
    mockBackend();
    const check = (resources: Record<string, unknown>) =>
      checkTarsKnowledgeAccess(MANAGER, { knowledgeBaseId: 'kb1', resources });

    await expect(check({ document_ids: ['doc-1'], website_ids: 'web-1' })).resolves.toBe('allowed');
    await expect(check({ document_ids: ['doc-1', 'doc-2'] })).resolves.toBe('forbidden');
    await expect(check({ website_ids: 'web-2' })).resolves.toBe('forbidden');
    await expect(check({ document_ids: 'ghost' })).resolves.toBe('not_found');
    await expect(check({ document_ids: ['', null], website_ids: [] })).resolves.toBe('allowed');
  });

  it('without a knowledge base in the path, requires a managed one', async () => {
    mockBackend();

    await expect(
      checkTarsKnowledgeAccess(MANAGER, { resources: { chunk_ids: 'chunk-1' } }),
    ).resolves.toBe('allowed');
    await expect(
      checkTarsKnowledgeAccess(MANAGER, { resources: { chunk_ids: 'chunk-2' } }),
    ).resolves.toBe('forbidden');
    await expect(checkTarsKnowledgeAccess(MANAGER, {})).resolves.toBe('forbidden');
  });
});

describe('request targets', () => {
  const req = (fields: Partial<Record<'params' | 'body' | 'query', unknown>>) =>
    fields as unknown as ExpressRequest;

  it('reads every id a knowledge base route may carry', () => {
    expect(
      tarsKnowledgeTargetOf(
        req({
          params: { id: 'kb1', docId: 'doc-1', chunkId: 'chunk-1', websiteId: 'web-1' },
          body: {
            documentIds: ['doc-2'],
            websiteIds: ['web-2'],
            bindingId: 'bind-1',
            associationId: 'fs-1',
            existingAssociationId: 'fs-3',
            fileSystemAssociationIds: ['fs-2'],
          },
          query: { associationId: 'fs-4' },
        }),
      ),
    ).toEqual({
      knowledgeBaseId: 'kb1',
      resources: {
        document_ids: ['doc-1', ['doc-2']],
        chunk_ids: 'chunk-1',
        website_ids: ['web-1', ['web-2']],
        sql_binding_ids: 'bind-1',
        file_system_association_ids: ['fs-1', 'fs-3', 'fs-4', ['fs-2']],
      },
    });
  });

  it('reads a schedule, or the knowledge base and dataset of a new one', () => {
    expect(tarsScheduleTargetOf(req({ params: { id: 'sch-1' } }))).toEqual({
      resources: { schedule_ids: 'sch-1' },
    });
    expect(
      tarsScheduleTargetOf(
        req({
          params: {},
          body: { knowledgeBaseId: 'kb1', datasetType: 'website', datasetId: 'web-1' },
        }),
      ),
    ).toEqual({
      knowledgeBaseId: 'kb1',
      resources: { file_system_association_ids: undefined, website_ids: 'web-1' },
    });
    expect(
      tarsScheduleTargetOf(
        req({
          params: {},
          body: {
            knowledgeBaseId: 'kb1',
            datasetType: 'file_system',
            datasetId: 'fsys',
            associationId: 'fs-1',
          },
        }),
      ),
    ).toEqual({
      knowledgeBaseId: 'kb1',
      resources: { file_system_association_ids: 'fs-1', website_ids: undefined },
    });
    expect(tarsScheduleTargetOf(req({ params: {}, query: { knowledgeBaseId: 'kb2' } }))).toEqual({
      knowledgeBaseId: 'kb2',
      resources: { file_system_association_ids: undefined, website_ids: undefined },
    });
    expect(tarsScheduleTargetOf(req({ params: {}, query: {} }))).toBeNull();
  });
});

describe('route guards on a real Express router', () => {
  const asUser =
    (user: object) =>
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction): void => {
      (req as ExpressRequest & { user: object }).user = user;
      next();
    };

  /** Mirrors how knowledge.js, datasets.js and schedules.js mount the guards. */
  const appFor = (user: object) => {
    const router = express.Router();
    router.use(express.json());
    router.use(['/knowledge-bases', '/documents', '/schedules'], asUser(user));
    for (const path of [
      '/knowledge-bases/:id',
      '/knowledge-bases/:id/documents/:docId',
      '/documents/:docId',
      '/documents/:docId/chunks/:chunkId',
    ]) {
      router.use(path, requireTarsKnowledgeBase);
    }
    router.use('/knowledge-bases/:id/websites/:websiteId', requireTarsKnowledgeBase);
    router.use('/schedules', requireTarsScheduleAccess);
    router.use('/schedules/:id', requireTarsScheduleAccess);
    const ok = (_req: ExpressRequest, res: ExpressResponse) => {
      res.json({ ok: true });
    };
    router.get('/knowledge-bases/:id/documents', ok);
    router.put('/knowledge-bases/:id/documents/:docId/rename', ok);
    router.put('/documents/:docId/chunks/:chunkId', ok);
    router.put('/knowledge-bases/:id/websites/:websiteId', ok);
    router.post('/knowledge-bases/:id/datasets/batch-delete', ok);
    router.get('/schedules', ok);
    router.post('/schedules', ok);
    router.post('/schedules/:id/run', ok);
    const app = express();
    app.use('/api/tars', router);
    return app;
  };

  it("serves a manager's own knowledge base and refuses the rest", async () => {
    mockBackend();
    const app = appFor(MANAGER);

    expect((await request(app).get('/api/tars/knowledge-bases/kb1/documents')).status).toBe(200);
    expect((await request(app).get('/api/tars/knowledge-bases/kb2/documents')).status).toBe(403);
  });

  it('checks the datasets a path names against its knowledge base', async () => {
    mockBackend();
    const app = appFor(MANAGER);

    expect(
      (await request(app).put('/api/tars/knowledge-bases/kb1/documents/doc-1/rename')).status,
    ).toBe(200);
    expect(
      (await request(app).put('/api/tars/knowledge-bases/kb1/documents/doc-2/rename')).status,
    ).toBe(403);
    expect(
      (await request(app).put('/api/tars/knowledge-bases/kb1/documents/ghost/rename')).status,
    ).toBe(404);
    expect((await request(app).put('/api/tars/knowledge-bases/kb1/websites/web-1')).status).toBe(
      200,
    );
    expect((await request(app).put('/api/tars/knowledge-bases/kb1/websites/web-2')).status).toBe(
      403,
    );
    expect((await request(app).put('/api/tars/documents/doc-1/chunks/chunk-1')).status).toBe(200);
    expect((await request(app).put('/api/tars/documents/doc-1/chunks/chunk-2')).status).toBe(403);
    expect((await request(app).put('/api/tars/documents/doc-2/chunks/chunk-2')).status).toBe(403);
  });

  it('checks the datasets a body names', async () => {
    mockBackend();
    const app = appFor(MANAGER);
    const batch = (body: object) =>
      request(app).post('/api/tars/knowledge-bases/kb1/datasets/batch-delete').send(body);

    expect(
      (await batch({ documentIds: ['doc-1'], fileSystemAssociationIds: ['fs-1'] })).status,
    ).toBe(200);
    expect((await batch({ documentIds: ['doc-1', 'doc-2'] })).status).toBe(403);
    expect((await batch({ fileSystemAssociationIds: ['fs-2'] })).status).toBe(403);
  });

  it('guards schedules by their knowledge base', async () => {
    mockBackend();
    const app = appFor(MANAGER);

    expect((await request(app).get('/api/tars/schedules')).status).toBe(200);
    expect((await request(app).get('/api/tars/schedules?knowledgeBaseId=kb1')).status).toBe(200);
    expect((await request(app).get('/api/tars/schedules?knowledgeBaseId=kb2')).status).toBe(403);
    expect((await request(app).post('/api/tars/schedules/sch-1/run')).status).toBe(200);
    expect((await request(app).post('/api/tars/schedules/sch-2/run')).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/tars/schedules')
          .send({ knowledgeBaseId: 'kb1', datasetType: 'file_system', associationId: 'fs-2' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/tars/schedules')
          .send({ knowledgeBaseId: 'kb1', datasetType: 'website', datasetId: 'web-1' })
      ).status,
    ).toBe(200);
  });

  it('lets an admin through everything', async () => {
    const fetchMock = mockBackend();
    const app = appFor(ADMIN);

    expect(
      (await request(app).put('/api/tars/knowledge-bases/kb2/documents/doc-2/rename')).status,
    ).toBe(200);
    expect((await request(app).post('/api/tars/schedules/sch-2/run')).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 503 when pwc_tars cannot say', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

    expect(
      (await request(appFor(MANAGER)).get('/api/tars/knowledge-bases/kb1/documents')).status,
    ).toBe(503);
  });
});
