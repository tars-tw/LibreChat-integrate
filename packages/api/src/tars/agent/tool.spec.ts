jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { Tools } from 'librechat-data-provider';
import type { TarsMemoryDocument } from '~/tars/memory/client';
import type { TarsAgentBindings } from './bindings';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { invalidateTarsScopedKnowledgeBasesCache } from '~/tars/scope';
import { createTarsAgentTool, buildTarsAgentContext } from './tool';

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
];

const domains = {
  sys_domains: [
    { id: 100, name: '通用腦', knowledge_base_ids: 'kb-general,kb-docs' },
    { id: 200, name: '雙庫腦', knowledge_base_ids: 'kb-general,kb-erp' },
  ],
};

const documents = [{ id: 'doc-1', filename: 'orders.xlsx' }] as TarsMemoryDocument[];

const kbAndDb: TarsAgentBindings = {
  knowledgeBases: true,
  database: true,
  chart: false,
  documents: [],
};
const none: TarsAgentBindings = {
  knowledgeBases: false,
  database: false,
  chart: false,
  documents: [],
};

const answerBody = {
  success: true,
  data: { answer: '共 65 張', model_name: 'gemini-3.6-flash', tokens: { total: 500 } },
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
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gemini-3.6-flash' }]);
    }
    if (url.includes('/api/sys_config/prepare_data')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'from-sysconfig', status: 'active' },
      ]);
    }
    if (url.includes('/api/langflow-service/agent')) {
      return buildResponse(agent.status, agent.body);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsScopedKnowledgeBasesCache();
  invalidateTarsSysConfigCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createTarsAgentTool', () => {
  it('advertises exactly what the turn binds', async () => {
    mockBackend();
    const agentTool = await createTarsAgentTool({
      tarsUserId: USER_ID,
      domainId: 100,
      bindings: { knowledgeBases: true, database: true, chart: true, documents },
    });

    expect(agentTool.name).toBe('tars_agent');
    expect(agentTool.responseFormat).toBe('content_and_artifact');
    expect(agentTool.description).toContain('通用知識庫');
    expect(agentTool.description).toContain('bound automatically');
    expect(agentTool.description).toContain('orders.xlsx');
    expect(agentTool.description).toContain('Charts:');
  });

  it('leaves out what is switched off', async () => {
    mockBackend();
    const agentTool = await createTarsAgentTool({
      tarsUserId: USER_ID,
      domainId: 100,
      bindings: { knowledgeBases: true, database: false, chart: false, documents: [] },
    });
    expect(agentTool.description).toContain('Knowledge bases');
    expect(agentTool.description).not.toContain('Database:');
    expect(agentTool.description).not.toContain('Charts:');
    expect(agentTool.description).not.toContain('Attached spreadsheets');
  });

  it('lists the databases to choose from when the brain binds several', async () => {
    mockBackend();
    const agentTool = await createTarsAgentTool({
      tarsUserId: USER_ID,
      domainId: 200,
      bindings: kbAndDb,
    });
    expect(agentTool.description).toContain('pass one as `database_knowledge_base_id`');
    expect(agentTool.description).toContain('kb-erp');
  });

  it('answers through one combined pwc_tars run and attaches its trace', async () => {
    const trace = [
      { type: 'turn', turn: 1 },
      { type: 'tool_call', id: 'c1', name: 'knowledge_search', input: { query: '班機' } },
      { type: 'tool_call', id: 'c2', name: 'sql_query', input: { sql: 'SELECT 1' } },
    ];
    const fetchMock = mockBackend({
      status: 200,
      body: { success: true, data: { ...answerBody.data, trace } },
    });
    const agentTool = await createTarsAgentTool({
      tarsUserId: USER_ID,
      domainId: 100,
      bindings: kbAndDb,
      model: 'gemini-3.6-flash',
    });

    const message = await agentTool.invoke({
      id: 'call-1',
      name: 'tars_agent',
      type: 'tool_call',
      args: { question: '台北到成田的班機' },
    });
    expect(message.content).toBe('共 65 張');
    expect(message.artifact?.[Tools.tars_trace]?.trace).toEqual(trace);
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/agent'),
    );
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      query: '台北到成田的班機',
      knowledge_base_ids: 'kb-general,kb-docs',
      database_knowledge_base_id: 'kb-general',
      model_name: 'gemini-3.6-flash',
    });
  });

  it('says so when nothing is bound, without calling pwc_tars', async () => {
    const fetchMock = mockBackend();
    const agentTool = await createTarsAgentTool({
      tarsUserId: USER_ID,
      domainId: 100,
      bindings: none,
    });
    expect(agentTool.description).toContain('Nothing is bound');
    await expect(agentTool.invoke({ question: 'q' })).resolves.toContain('Nothing is bound');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the pwc_tars failure as tool output rather than throwing', async () => {
    mockBackend({ status: 400, body: { message: '資料庫 schema 資訊尚未生成' } });
    const agentTool = await createTarsAgentTool({
      tarsUserId: USER_ID,
      domainId: 100,
      bindings: kbAndDb,
    });
    await expect(agentTool.invoke({ question: 'q' })).resolves.toContain(
      '資料庫 schema 資訊尚未生成',
    );
  });

  it('reaches nothing without a pwc_tars identity', async () => {
    const fetchMock = mockBackend();
    const agentTool = await createTarsAgentTool({
      tarsUserId: undefined,
      domainId: 100,
      bindings: kbAndDb,
    });
    await expect(agentTool.invoke({ question: 'q' })).resolves.toContain('not linked to pwc_tars');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buildTarsAgentContext', () => {
  it('names what is bound for the definition-only load path', async () => {
    mockBackend();
    const context = await buildTarsAgentContext(USER_ID, 100, {
      knowledgeBases: true,
      database: true,
      chart: false,
      documents,
    });
    expect(context).toContain('`tars_agent` Runtime Context');
    expect(context).toContain('kb-general');
    expect(context).toContain('bound automatically');
    expect(context).toContain('doc-1');
  });
});
