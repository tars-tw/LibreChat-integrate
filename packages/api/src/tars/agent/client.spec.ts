jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import type { TarsMemoryDocument } from '~/tars/memory/client';
import type { TarsAgentBindings } from './bindings';
import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { invalidateTarsScopedKnowledgeBasesCache } from '~/tars/scope';
import { runTarsAgent, listTarsAgentScope } from './client';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const knowledgeBases = [
  { id: 'kb-general', name: '通用知識庫', description: '含資料庫', has_sql_database: true },
  { id: 'kb-docs', name: '文件庫', description: '', has_sql_database: false },
  { id: 'kb-erp', name: 'ERP', description: '', has_sql_database: true },
  { id: 'kb-hr', name: '人資知識庫', description: '別的腦的', has_sql_database: true },
];

/** Domain 100 binds one database-backed base; domain 200 binds two. */
const domains = {
  sys_domains: [
    { id: 100, name: '通用腦', knowledge_base_ids: 'kb-general,kb-docs' },
    { id: 200, name: '雙庫腦', knowledge_base_ids: 'kb-general,kb-docs,kb-erp' },
  ],
};

const documents = [
  { id: 'doc-1', filename: 'orders.xlsx' },
  { id: 'doc-2', filename: 'stock.csv' },
] as TarsMemoryDocument[];

const all: TarsAgentBindings = { knowledgeBases: true, database: true, chart: true, documents };
const kbAndDb: TarsAgentBindings = {
  knowledgeBases: true,
  database: true,
  chart: false,
  documents: [],
};

const answerBody = {
  success: true,
  data: {
    answer: '共 65 張',
    model_name: 'gemini-3.6-flash',
    tokens: { total: 500 },
    sql: 'SELECT count(*) FROM information_schema.tables',
  },
};

const mockBackend = (
  agent: { status: number; body: unknown } = { status: 200, body: answerBody },
) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/knowledge_base/prepare_data')) {
      return buildResponse(200, { knowledge_bases: knowledgeBases });
    }
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, domains);
    }
    if (url.includes('/api/langflow-service/agent')) {
      return buildResponse(agent.status, agent.body);
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gemini-3.6-flash' }]);
    }
    if (url.includes('/api/sys_config/prepare_data')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'from-sysconfig', status: 'active' },
      ]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const agentCall = (fetchMock: jest.SpyInstance): RequestInit | undefined =>
  fetchMock.mock.calls.find(([url]) => String(url).includes('/api/langflow-service/agent'))?.[1] as
    | RequestInit
    | undefined;

const agentBodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> =>
  JSON.parse(String(agentCall(fetchMock)?.body));

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  delete process.env.TARS_AGENT_TIMEOUT_MS;
  delete process.env.TARS_TABLE_TASK_TIMEOUT_MS;
  invalidateTarsScopedKnowledgeBasesCache();
  invalidateTarsSysConfigCache();
  invalidateTarsModelProfilesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('listTarsAgentScope', () => {
  it('lists only the halves the bindings switch on', async () => {
    mockBackend();
    const scope = await listTarsAgentScope(USER_ID, 100, all);
    expect(scope.knowledgeBases.map((base) => base.knowledge_base_id)).toEqual([
      'kb-general',
      'kb-docs',
    ]);
    expect(scope.databases.map((database) => database.knowledge_base_id)).toEqual(['kb-general']);
    expect(scope.documents).toEqual(documents);
    expect(scope.chart).toBe(true);
  });

  it('leaves an unbound half empty without asking pwc_tars for it', async () => {
    const fetchMock = mockBackend();
    const scope = await listTarsAgentScope(USER_ID, 100, {
      knowledgeBases: false,
      database: false,
      chart: true,
      documents: [],
    });
    expect(scope.knowledgeBases).toEqual([]);
    expect(scope.databases).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('runTarsAgent', () => {
  it('binds the knowledge bases, the only database and every spreadsheet in one call', async () => {
    const fetchMock = mockBackend();

    const result = await runTarsAgent(USER_ID, {
      question: '台北到成田的班機',
      bindings: all,
      domainId: 100,
      model: 'gemini-3.6-flash',
    });
    expect(result).toMatchObject({
      answer: '共 65 張',
      knowledgeBaseIds: ['kb-general', 'kb-docs'],
      databaseKnowledgeBaseId: 'kb-general',
      documentIds: ['doc-1', 'doc-2'],
    });
    expect(agentBodyOf(fetchMock)).toEqual({
      query: '台北到成田的班機',
      knowledge_base_ids: 'kb-general,kb-docs',
      database_knowledge_base_id: 'kb-general',
      document_ids: 'doc-1,doc-2',
      model_name: 'gemini-3.6-flash',
    });
  });

  it('sends only what is bound', async () => {
    const fetchMock = mockBackend();
    await runTarsAgent(USER_ID, {
      question: 'q',
      bindings: { knowledgeBases: false, database: true, chart: false, documents: [] },
      domainId: 100,
    });
    expect(agentBodyOf(fetchMock)).toEqual({
      query: 'q',
      database_knowledge_base_id: 'kb-general',
      model_name: undefined,
    });
  });

  it('binds no database when the brain has several and the model named none', async () => {
    const fetchMock = mockBackend();
    const result = await runTarsAgent(USER_ID, { question: 'q', bindings: kbAndDb, domainId: 200 });
    expect(result.databaseKnowledgeBaseId).toBeUndefined();
    expect(agentBodyOf(fetchMock)).not.toHaveProperty('database_knowledge_base_id');
  });

  it('binds the database the model named out of several', async () => {
    const fetchMock = mockBackend();
    await runTarsAgent(USER_ID, {
      question: 'q',
      bindings: kbAndDb,
      domainId: 200,
      databaseKnowledgeBaseId: 'kb-erp',
    });
    expect(agentBodyOf(fetchMock)).toMatchObject({ database_knowledge_base_id: 'kb-erp' });
  });

  it('refuses a database or knowledge base outside the brain', async () => {
    mockBackend();
    await expect(
      runTarsAgent(USER_ID, {
        question: 'q',
        bindings: kbAndDb,
        domainId: 100,
        databaseKnowledgeBaseId: 'kb-hr',
      }),
    ).rejects.toThrow('kb-hr');
    await expect(
      runTarsAgent(USER_ID, {
        question: 'q',
        bindings: kbAndDb,
        domainId: 100,
        knowledgeBaseIds: ['kb-erp'],
      }),
    ).rejects.toThrow('kb-erp');
  });

  it('refuses to narrow a half that is not bound this turn', async () => {
    mockBackend();
    await expect(
      runTarsAgent(USER_ID, {
        question: 'q',
        bindings: { knowledgeBases: false, database: false, chart: true, documents: [] },
        domainId: 100,
        knowledgeBaseIds: ['kb-general'],
      }),
    ).rejects.toThrow('No knowledge base is bound');
  });

  it('drops spreadsheet ids outside the conversation', async () => {
    const fetchMock = mockBackend();
    await runTarsAgent(USER_ID, {
      question: 'q',
      bindings: all,
      domainId: 100,
      documentIds: ['doc-2', 'foreign'],
    });
    expect(agentBodyOf(fetchMock)).toMatchObject({ document_ids: 'doc-2' });
  });

  it('gives a table task its long budget only when spreadsheets and knowledge bases are both bound', async () => {
    const tarsFetch = jest.requireActual<typeof import('~/tars/client')>('~/tars/client');
    const spy = jest.spyOn(tarsFetch, 'tarsFetch');
    mockBackend();
    await runTarsAgent(USER_ID, { question: 'q', bindings: all, domainId: 100 });
    const withDocs = spy.mock.calls.find(([path]) => path === '/api/langflow-service/agent')?.[1];
    expect(withDocs?.timeoutMs).toBe(1_740_000);
    spy.mockClear();
    await runTarsAgent(USER_ID, { question: 'q', bindings: kbAndDb, domainId: 100 });
    const withoutDocs = spy.mock.calls.find(
      ([path]) => path === '/api/langflow-service/agent',
    )?.[1];
    expect(withoutDocs?.timeoutMs).toBe(240_000);
  });

  it('appends a chart or file link the answer left out', async () => {
    mockBackend({
      status: 200,
      body: {
        success: true,
        data: { answer: '畫好了', chart_url: 'http://tars.test/static/quickchart/c.png' },
      },
    });
    const result = await runTarsAgent(USER_ID, { question: 'q', bindings: kbAndDb, domainId: 100 });
    expect(result.answer).toMatch(/^畫好了\n\n!\[chart\]\(/);
  });

  it('carries the run trace back for the chat', async () => {
    const trace = [{ type: 'tool_call', id: 'c1', name: 'sql_query', input: {} }];
    mockBackend({ status: 200, body: { success: true, data: { ...answerBody.data, trace } } });
    const result = await runTarsAgent(USER_ID, { question: 'q', bindings: kbAndDb, domainId: 100 });
    expect(result.trace?.trace).toEqual(trace);
    expect(result.trace?.sql).toBe('SELECT count(*) FROM information_schema.tables');
  });
});
