jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { invalidateTarsSqlDatabasesCache } from './client';
import { createTarsSqlTool } from './tool';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const knowledgeBases = [
  { id: 'kb-sql', name: '通用知識庫', description: '含資料庫', has_sql_database: true },
  { id: 'kb-other', name: '人資知識庫', description: '', has_sql_database: true },
  { id: 'kb-plain', name: '文件庫', description: '', has_sql_database: false },
];

const answerBody = {
  success: true,
  data: { answer: '共有 9 個模型', model_name: 'gpt-5.4-mini', tokens: { total: 8983 } },
};

/** Domain 100 binds `kb-sql` only; domain 235 binds both database-backed bases. */
const mockBackend = (sql: { status: number; body: unknown } = { status: 200, body: answerBody }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/knowledge_base/prepare_data')) {
      return buildResponse(200, { knowledge_bases: knowledgeBases });
    }
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, {
        sys_domains: [
          { id: 100, name: '通用腦', knowledge_base_ids: 'kb-sql,kb-plain' },
          { id: 235, name: '雙庫腦', knowledge_base_ids: 'kb-sql,kb-other' },
        ],
      });
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gpt-5.4-mini' }]);
    }
    if (url.includes('/api/langflow-service/sql')) {
      return buildResponse(sql.status, sql.body);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const sqlBodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> => {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes('/api/langflow-service/sql'),
  );
  return JSON.parse(String((call?.[1] as RequestInit).body));
};

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  process.env.TARS_SQL_SERVICE_KEY = 'service-key';
  delete process.env.TARS_SQL_AGENT_MODEL;
  invalidateTarsSqlDatabasesCache();
});

afterEach(() => {
  delete process.env.TARS_SQL_SERVICE_KEY;
  jest.restoreAllMocks();
});

describe('createTarsSqlTool', () => {
  it('is named for the native tool and advertises the single bound database', async () => {
    mockBackend();
    const sqlTool = await createTarsSqlTool({ tarsUserId: USER_ID, domainId: 100 });

    expect(sqlTool.name).toBe('sql_agent');
    expect(sqlTool.description).toContain('通用知識庫');
    expect(sqlTool.description).not.toContain('人資知識庫');
  });

  it("queries the brain's only database without being told which", async () => {
    const fetchMock = mockBackend();
    const sqlTool = await createTarsSqlTool({
      tarsUserId: USER_ID,
      domainId: 100,
      model: 'gpt-5.4-mini',
    });

    await expect(sqlTool.invoke({ question: '有什麼模型？' })).resolves.toBe('共有 9 個模型');
    expect(sqlBodyOf(fetchMock)).toEqual({
      query: '有什麼模型？',
      knowledge_base_id: 'kb-sql',
      model_name: 'gpt-5.4-mini',
    });
  });

  it('lists the choices when a brain binds several and none was named', async () => {
    mockBackend();
    const sqlTool = await createTarsSqlTool({ tarsUserId: USER_ID, domainId: 235 });

    expect(sqlTool.description).toContain('kb-other');
    await expect(sqlTool.invoke({ question: 'q' })).resolves.toContain('Pick a database first');
  });

  it('refuses a database outside the active brain', async () => {
    mockBackend();
    const sqlTool = await createTarsSqlTool({ tarsUserId: USER_ID, domainId: 100 });

    await expect(
      sqlTool.invoke({ question: 'q', knowledge_base_id: 'kb-other' }),
    ).resolves.toContain('not one of the databases bound');
  });

  it('says so when the brain binds no database at all', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/knowledge_base/prepare_data')) {
        return buildResponse(200, { knowledge_bases: [knowledgeBases[2]] });
      }
      if (url.includes('/api/domain_settings/get_domain_by_user')) {
        return buildResponse(200, {
          sys_domains: [{ id: 100, name: '通用腦', knowledge_base_ids: 'kb-plain' }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const sqlTool = await createTarsSqlTool({ tarsUserId: USER_ID, domainId: 100 });

    expect(sqlTool.description).toContain('No database is bound');
    await expect(sqlTool.invoke({ question: 'q' })).resolves.toContain('nothing to query');
  });

  it('returns the pwc_tars failure as tool output rather than throwing', async () => {
    mockBackend({ status: 400, body: { message: '資料庫 schema 資訊尚未生成' } });
    const sqlTool = await createTarsSqlTool({ tarsUserId: USER_ID, domainId: 100 });

    await expect(sqlTool.invoke({ question: 'q' })).resolves.toContain(
      '資料庫 schema 資訊尚未生成',
    );
  });
});

describe('createTarsSqlTool without a pwc_tars identity', () => {
  it('reaches nothing and never calls pwc_tars', async () => {
    const fetchMock = mockBackend();
    const sqlTool = await createTarsSqlTool({ tarsUserId: undefined, domainId: 100 });

    expect(sqlTool.description).toContain('not linked to pwc_tars');
    await expect(sqlTool.invoke({ question: 'q' })).resolves.toContain('not linked to pwc_tars');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
