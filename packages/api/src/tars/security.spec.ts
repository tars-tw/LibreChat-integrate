jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import {
  setTarsDatasetLevel,
  saveTarsKnowledgeBaseSecurity,
  fetchTarsKnowledgeBaseSecurity,
} from './security';
import { TarsRequestError } from './client';

const BASE_URL = 'http://tars.test';
const SECRET = 'security-secret-security-secret-1234';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const envelope = (data?: unknown) => ({ success: true, data });

/** pwc_tars checks the caller against the knowledge base, so every call is signed as the user. */
const requestOf = (fetchMock: jest.SpyInstance) => {
  const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const url = new URL(String(input));
  const headers = init.headers as Record<string, string>;
  return {
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    method: init.method ?? 'GET',
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    actingUser: (
      jwt.verify(headers.Authorization.slice('Bearer '.length), SECRET, {
        algorithms: ['HS256'],
      }) as JwtPayload
    ).user_id,
  };
};

describe('knowledge base data security', () => {
  const savedSecret = process.env.TARS_JWT_SECRET;

  beforeEach(() => {
    process.env.TARS_JWT_SECRET = SECRET;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    if (savedSecret === undefined) {
      delete process.env.TARS_JWT_SECRET;
    } else {
      process.env.TARS_JWT_SECRET = savedSecret;
    }
  });

  it('reads every level of a knowledge base as the acting user', async () => {
    const assignments = [
      { id: '1', name: '高度機密', description: null, order: 1, principals: [] },
    ];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope(assignments)));

    await expect(fetchTarsKnowledgeBaseSecurity('u1', 'kb1', BASE_URL)).resolves.toEqual(
      assignments,
    );
    expect(requestOf(fetchMock)).toEqual({
      path: '/api/data_security/assignments',
      query: { knowledge_base_id: 'kb1' },
      method: 'GET',
      body: undefined,
      actingUser: 'u1',
    });
  });

  it('reads nothing from a bare reply', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true }));

    await expect(fetchTarsKnowledgeBaseSecurity('u1', 'kb1', BASE_URL)).resolves.toEqual([]);
  });

  it('saves one level, sending only the ids and principals', async () => {
    const result = {
      knowledge_base_id: 'kb1',
      data_security_level_id: '1',
      user_count: 1,
      group_count: 0,
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope(result)));
    const principals = [{ principal_type: 'user' as const, principal_id: 'p1' }];

    await expect(
      saveTarsKnowledgeBaseSecurity('u1', 'kb1', '1', { principals }, BASE_URL),
    ).resolves.toEqual(result);
    expect(requestOf(fetchMock)).toMatchObject({
      path: '/api/data_security/assignments/save',
      method: 'POST',
      body: { knowledge_base_id: 'kb1', data_security_level_id: '1', principals },
      actingUser: 'u1',
    });
  });

  it('maps a level change onto pwc_tars field names', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope({ document_count: 1 })));

    await setTarsDatasetLevel(
      'u1',
      'kb1',
      {
        dataSecurityLevelId: '2',
        documentIds: ['d1'],
        websiteIds: ['w1'],
        fileSystemAssociationIds: ['a1'],
      },
      BASE_URL,
    );

    expect(requestOf(fetchMock)).toMatchObject({
      path: '/api/data_security/datasets/level',
      method: 'POST',
      body: {
        knowledge_base_id: 'kb1',
        data_security_level_id: '2',
        document_ids: ['d1'],
        dataset_website_ids: ['w1'],
        file_system_association_ids: ['a1'],
      },
      actingUser: 'u1',
    });
  });

  it('sends a clear as an explicit null', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope({})));

    await setTarsDatasetLevel(
      'u1',
      'kb1',
      { dataSecurityLevelId: null, documentIds: ['d1'] },
      BASE_URL,
    );

    expect(requestOf(fetchMock).body).toHaveProperty('data_security_level_id', null);
  });

  it('leaves a missing level out, so pwc_tars refuses rather than clears', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope({})));

    await setTarsDatasetLevel('u1', 'kb1', { documentIds: ['d1'] } as never, BASE_URL);

    expect(requestOf(fetchMock).body).not.toHaveProperty('data_security_level_id');
  });

  it("relays pwc_tars's refusal with its status", async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(403, { success: false, message: '沒有權限設定這個知識庫' }));

    const failure = await fetchTarsKnowledgeBaseSecurity('u1', 'kb1', BASE_URL).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TarsRequestError);
    expect(failure).toMatchObject({ status: 403 });
  });
});
