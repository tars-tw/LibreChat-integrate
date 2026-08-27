jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { runTarsSqlAgent, listTarsSqlDatabases, invalidateTarsSqlDatabasesCache } from './client';

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
  { id: 'kb-other', name: '人資知識庫', description: '別的腦的', has_sql_database: true },
  { id: 'kb-plain', name: '文件庫', description: null, has_sql_database: false },
];

/** Domain 100 (通用腦) binds `kb-sql` and a database-less knowledge base. */
const domainResponse = {
  sys_domains: [{ id: 100, name: '通用腦', knowledge_base_ids: 'kb-sql,kb-plain' }],
};

const mockBackend = (sql?: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/knowledge_base/prepare_data')) {
      return buildResponse(200, { knowledge_bases: knowledgeBases });
    }
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, domainResponse);
    }
    if (url.includes('/api/langflow-service/sql')) {
      return buildResponse(sql?.status ?? 200, sql?.body ?? {});
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gpt-5.4-mini' }, { model_name: 'gpt-5.5' }]);
    }
    if (url.includes('/api/sys_config/prepare_data')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'from-sysconfig', status: 'active' },
      ]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const answerBody = {
  success: true,
  data: { answer: '共有 9 個模型', model_name: 'gpt-5.4-mini', tokens: { total: 8983 } },
};

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  delete process.env.TARS_SQL_SERVICE_KEY;
  delete process.env.TARS_SQL_AGENT_MODEL;
  delete process.env.TARS_SQL_AGENT_USE_GATEWAY;
  invalidateTarsSqlDatabasesCache();
  invalidateTarsSysConfigCache();
  invalidateTarsModelProfilesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('listTarsSqlDatabases', () => {
  it('keeps only knowledge bases with a bound database', async () => {
    mockBackend();
    await expect(listTarsSqlDatabases(USER_ID)).resolves.toEqual([
      { knowledge_base_id: 'kb-sql', name: '通用知識庫', description: '含資料庫' },
      { knowledge_base_id: 'kb-other', name: '人資知識庫', description: '別的腦的' },
    ]);
  });

  it('narrows the list to the databases the active brain binds', async () => {
    mockBackend();
    await expect(listTarsSqlDatabases(USER_ID, 100)).resolves.toEqual([
      { knowledge_base_id: 'kb-sql', name: '通用知識庫', description: '含資料庫' },
    ]);
  });

  it('caches each brain separately', async () => {
    const fetchMock = mockBackend();
    await listTarsSqlDatabases(USER_ID, 100);
    await listTarsSqlDatabases(USER_ID, 100);
    const scopedCalls = fetchMock.mock.calls.length;
    await listTarsSqlDatabases(USER_ID);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(scopedCalls);
  });

  it('returns nothing for an unlinked user without calling pwc_tars', async () => {
    const fetchMock = mockBackend();
    await expect(listTarsSqlDatabases('')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves repeat calls from the cache', async () => {
    const fetchMock = mockBackend();
    await listTarsSqlDatabases(USER_ID);
    await listTarsSqlDatabases(USER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('runTarsSqlAgent', () => {
  it('runs the question against the bound database', async () => {
    process.env.TARS_SQL_SERVICE_KEY = 'service-key';
    process.env.TARS_SQL_AGENT_MODEL = 'gpt-5.4-mini';
    const fetchMock = mockBackend({ status: 200, body: answerBody });

    await expect(
      runTarsSqlAgent(USER_ID, { question: '有什麼模型？', knowledgeBaseId: 'kb-sql' }),
    ).resolves.toEqual({ answer: '共有 9 個模型', modelName: 'gpt-5.4-mini', totalTokens: 8983 });

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/sql'),
    );
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-TARS-Service-Key']).toBe('service-key');
    expect((init.headers as Record<string, string>)['X-Use-Librechat-Gateway']).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({
      query: '有什麼模型？',
      knowledge_base_id: 'kb-sql',
      model_name: 'gpt-5.4-mini',
    });
  });

  it('falls back to the sys_config service key', async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });
    await runTarsSqlAgent(USER_ID, { question: 'q', knowledgeBaseId: 'kb-sql' });

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/sql'),
    );
    expect(
      ((call?.[1] as RequestInit).headers as Record<string, string>)['X-TARS-Service-Key'],
    ).toBe('from-sysconfig');
  });

  it('sends the gateway headers when routing through LibreChat', async () => {
    process.env.TARS_SQL_SERVICE_KEY = 'service-key';
    process.env.TARS_SQL_AGENT_USE_GATEWAY = 'true';
    const fetchMock = mockBackend({ status: 200, body: answerBody });

    await runTarsSqlAgent(USER_ID, {
      question: 'q',
      knowledgeBaseId: 'kb-sql',
      librechatUserId: 'lc-1',
    });

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/sql'),
    );
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Use-Librechat-Gateway']).toBe('true');
    expect(headers['X-Librechat-User-Id']).toBe('lc-1');
  });

  it('refuses a knowledge base the user cannot reach', async () => {
    process.env.TARS_SQL_SERVICE_KEY = 'service-key';
    const fetchMock = mockBackend({ status: 200, body: answerBody });

    await expect(
      runTarsSqlAgent(USER_ID, { question: 'q', knowledgeBaseId: 'kb-plain' }),
    ).rejects.toThrow(/not one of the databases bound/);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/langflow-service/sql')),
    ).toBe(false);
  });

  it('surfaces the pwc_tars failure message', async () => {
    process.env.TARS_SQL_SERVICE_KEY = 'service-key';
    mockBackend({ status: 400, body: { message: '資料庫 schema 資訊尚未生成' } });

    await expect(
      runTarsSqlAgent(USER_ID, { question: 'q', knowledgeBaseId: 'kb-sql' }),
    ).rejects.toMatchObject({ status: 400, serverMessage: '資料庫 schema 資訊尚未生成' });
  });
});

const sqlBodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> => {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes('/api/langflow-service/sql'),
  );
  return JSON.parse(String((call?.[1] as RequestInit).body));
};

describe('SQL agent model selection', () => {
  beforeEach(() => {
    process.env.TARS_SQL_SERVICE_KEY = 'service-key';
  });

  it("runs on the model the caller's chat turn resolved to", async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });
    await runTarsSqlAgent(USER_ID, {
      question: 'q',
      knowledgeBaseId: 'kb-sql',
      model: 'gpt-5.5',
    });
    expect(sqlBodyOf(fetchMock).model_name).toBe('gpt-5.5');
  });

  it('sends the pwc_tars spelling of the model', async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });
    await runTarsSqlAgent(USER_ID, {
      question: 'q',
      knowledgeBaseId: 'kb-sql',
      model: 'GPT-5.4-Mini',
    });
    expect(sqlBodyOf(fetchMock).model_name).toBe('gpt-5.4-mini');
  });

  it('falls back to the pwc_tars default when the chat model has no model_profile', async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });
    await runTarsSqlAgent(USER_ID, {
      question: 'q',
      knowledgeBaseId: 'kb-sql',
      model: 'claude-opus-5',
    });
    expect(sqlBodyOf(fetchMock).model_name).toBeUndefined();
  });

  it('falls back to the pwc_tars default when the turn names no model', async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });

    await runTarsSqlAgent(USER_ID, { question: 'q', knowledgeBaseId: 'kb-sql' });
    expect(sqlBodyOf(fetchMock).model_name).toBeUndefined();
  });

  it('logs which model the nested loop ran on', async () => {
    const { logger } = jest.requireMock('@librechat/data-schemas');
    mockBackend({ status: 200, body: answerBody });

    await runTarsSqlAgent(USER_ID, {
      question: 'q',
      knowledgeBaseId: 'kb-sql',
      model: 'gpt-5.5',
    });

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('requested=gpt-5.5 used=gpt-5.4-mini'),
    );
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('via=pwc_tars-direct'));
  });

  it('lets the env pin override the chat model', async () => {
    process.env.TARS_SQL_AGENT_MODEL = 'deepseek-reasoner';
    const fetchMock = mockBackend({ status: 200, body: answerBody });

    await runTarsSqlAgent(USER_ID, {
      question: 'q',
      knowledgeBaseId: 'kb-sql',
      model: 'gpt-5.5',
    });
    expect(sqlBodyOf(fetchMock).model_name).toBe('deepseek-reasoner');
  });
});
