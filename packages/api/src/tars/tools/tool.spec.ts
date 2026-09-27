jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { Tools, AgentCapabilities } from 'librechat-data-provider';
import type { TarsMemoryDocument } from '~/tars/memory/client';
import { invalidateTarsPluginManifestsCache } from '~/tars/plugins/client';
import { invalidateTarsScopedKnowledgeBasesCache } from '~/tars/scope';
import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { tarsToolStreamResponse } from './mocks';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import {
  buildTarsToolsContext,
  createTarsBuiltinTool,
  resolveTarsBuiltinTools,
  getTarsBuiltinDefinition,
} from './tool';

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

const manifest = (
  name: string,
  properties: Record<string, unknown>,
  context: object[],
  guide = '',
) => ({
  name,
  kind: 'builtin',
  description: `${name} description`,
  display_name: name,
  input_schema: { type: 'object', properties, required: Object.keys(properties).slice(0, 1) },
  context_fields: context,
  long_running: name === 'run_table_task',
  guide,
});

/** pwc_tars's own guide bodies name its tools; the SQL pair shares one. */
const SEARCH_GUIDE = '查企業知識庫，回答時附上來源檔名。';
const SQL_GUIDE = '先用 sql_schema 看資料表結構，再寫一條只讀 SQL 給 sql_query。';

const listing = {
  success: true,
  data: {
    tools: [
      manifest(
        'knowledge_search',
        { query: { type: 'string' } },
        [{ name: 'knowledge_base_ids', required: true }],
        SEARCH_GUIDE,
      ),
      manifest(
        'sql_schema',
        { tables: { type: 'array', items: { type: 'string' } } },
        [{ name: 'knowledge_base_id', required: true }],
        SQL_GUIDE,
      ),
      manifest(
        'sql_query',
        { purpose: { type: 'string' }, sql: { type: 'string' } },
        [{ name: 'knowledge_base_id', required: true }],
        SQL_GUIDE,
      ),
      manifest('create_chart', { instruction: { type: 'string' } }, [
        { name: 'document_ids', required: false },
        { name: 'conversation_id', required: false },
        { name: 'knowledge_base_id', required: false },
        { name: 'model_name', required: false },
      ]),
      { name: 'summarize_text', kind: 'plugin', description: 'plugin', input_schema: {} },
    ],
  },
};

const sourceContent = ['IT200 06:35 11:00 台北 成田', 'IT202 14:15 18:35'].join('\n\n---\n\n');

type ToolRun = { status: number; body: unknown; progress?: string[] };

const ok = (data: Record<string, unknown>): ToolRun => ({
  status: 200,
  body: {
    success: true,
    data: {
      content: '',
      is_error: false,
      summary: '',
      final_text: '',
      sources: [],
      generated_urls: [],
      ...data,
    },
  },
});

const mockBackend = (
  run: ToolRun = ok({ content: 'done' }),
  toolsListing: ToolRun = { status: 200, body: listing },
) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
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
        { key: 'KEY_LANGFLOW_API_KEY', value: 'service-key', status: 'active' },
      ]);
    }
    if (url.endsWith('/api/langflow-service/tools') && init?.method === 'GET') {
      return buildResponse(toolsListing.status, toolsListing.body);
    }
    if (url.includes('/api/langflow-service/tools/') && url.endsWith('/stream')) {
      return tarsToolStreamResponse(run.status, run.body, run.progress);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const toolCallOf = (fetchMock: jest.SpyInstance) =>
  fetchMock.mock.calls.find(
    ([url]) =>
      String(url).includes('/api/langflow-service/tools/') && !String(url).endsWith('/tools'),
  );

const bodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> =>
  JSON.parse(String((toolCallOf(fetchMock)?.[1] as RequestInit).body));

const invoke = async (
  builtin: Awaited<ReturnType<typeof createTarsBuiltinTool>>,
  name: string,
  args: Record<string, unknown>,
) => builtin!.invoke({ id: 'call-1', name, type: 'tool_call', args });

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  process.env.JWT_SECRET = 'test-secret';
  invalidateTarsScopedKnowledgeBasesCache();
  invalidateTarsSysConfigCache();
  invalidateTarsModelProfilesCache();
  invalidateTarsPluginManifestsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveTarsBuiltinTools', () => {
  it('keeps the requested tools pwc_tars lists and primes their definitions', async () => {
    mockBackend();
    expect(getTarsBuiltinDefinition('tars_knowledge_search')).toBeUndefined();

    const allowed = await resolveTarsBuiltinTools([
      'tars_knowledge_search',
      'tars_data_query',
      'web_search',
    ]);
    expect([...allowed]).toEqual(['tars_knowledge_search']);

    const definition = getTarsBuiltinDefinition('tars_knowledge_search');
    expect(definition).toMatchObject({
      name: 'tars_knowledge_search',
      description: 'knowledge_search description',
      toolType: 'builtin',
      responseFormat: 'content_and_artifact',
    });
    expect(Object.keys(definition?.schema.properties ?? {})).toEqual([
      'query',
      'knowledge_base_ids',
    ]);
    expect(
      Object.keys(getTarsBuiltinDefinition('tars_sql_query')?.schema.properties ?? {}),
    ).toEqual(['purpose', 'sql', 'database_knowledge_base_id']);
  });

  it('drops a tool whose chat switch capability the deployment turned off', async () => {
    mockBackend();
    const allowed = await resolveTarsBuiltinTools(
      ['tars_knowledge_search', 'tars_sql_query'],
      (capability) => capability !== AgentCapabilities.sql_agent,
    );
    expect([...allowed]).toEqual(['tars_knowledge_search']);
  });

  it('equips nothing when pwc_tars is not configured or its listing fails', async () => {
    const fetchMock = mockBackend(undefined, { status: 500, body: {} });
    await expect(resolveTarsBuiltinTools(['tars_knowledge_search'])).resolves.toEqual(new Set());

    delete process.env.TARS_AUTH_URL;
    fetchMock.mockClear();
    await expect(resolveTarsBuiltinTools(['tars_knowledge_search'])).resolves.toEqual(new Set());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createTarsBuiltinTool', () => {
  it('searches the brain’s knowledge bases and reports the files it read', async () => {
    const fetchMock = mockBackend(
      ok({
        content: '[1] source: TigerairTaiwan.pdf ...',
        summary: '2 chunks',
        sources: [{ filename: 'TigerairTaiwan.pdf', content: sourceContent, type: 'knowledge' }],
      }),
    );
    const builtin = await createTarsBuiltinTool({
      toolName: 'tars_knowledge_search',
      tarsUserId: USER_ID,
      domainId: 100,
      question: '台北到成田的班機？',
    });

    const message = await invoke(builtin, 'tars_knowledge_search', { query: '台北 成田 班機' });
    expect(message.content).toBe('[1] source: TigerairTaiwan.pdf ...');
    expect(message.artifact?.[Tools.tars_trace]).toEqual({
      trace: [],
      step: {
        tool: 'knowledge_search',
        ok: true,
        summary: '2 chunks',
        sources: [{ filename: 'TigerairTaiwan.pdf', chunks: 2, excerpt: sourceContent }],
      },
    });
    expect(String(toolCallOf(fetchMock)?.[0])).toBe(
      `${BASE_URL}/api/langflow-service/tools/knowledge_search/stream`,
    );
    expect(bodyOf(fetchMock)).toEqual({
      inputs: { query: '台北 成田 班機' },
      context: { question: '台北到成田的班機？', knowledge_base_ids: 'kb-general,kb-docs' },
    });
  });

  it('narrows to the named knowledge bases and refuses one outside the brain', async () => {
    const fetchMock = mockBackend();
    const builtin = await createTarsBuiltinTool({
      toolName: 'tars_knowledge_search',
      tarsUserId: USER_ID,
      domainId: 100,
    });

    await invoke(builtin, 'tars_knowledge_search', { query: 'q', knowledge_base_ids: ['kb-docs'] });
    expect(bodyOf(fetchMock).context).toEqual({ knowledge_base_ids: 'kb-docs' });

    fetchMock.mockClear();
    const refused = await invoke(builtin, 'tars_knowledge_search', {
      query: 'q',
      knowledge_base_ids: ['kb-hr'],
    });
    expect(refused.content).toContain('"kb-hr" is not bound to the active brain');
    expect(refused.artifact?.[Tools.tars_trace]?.step?.ok).toBe(false);
    expect(toolCallOf(fetchMock)).toBeUndefined();
  });

  it('binds the only database automatically and asks for one when several are bound', async () => {
    const fetchMock = mockBackend(ok({ content: '| n |\n| 65 |', summary: '1 rows' }));
    const single = await createTarsBuiltinTool({
      toolName: 'tars_sql_query',
      tarsUserId: USER_ID,
      domainId: 100,
    });
    const message = await invoke(single, 'tars_sql_query', { purpose: 'count', sql: 'SELECT 1' });
    expect(bodyOf(fetchMock)).toEqual({
      inputs: { purpose: 'count', sql: 'SELECT 1' },
      context: { knowledge_base_id: 'kb-general' },
    });
    expect(message.artifact?.[Tools.tars_trace]?.step).toEqual({
      tool: 'sql_query',
      ok: true,
      summary: '1 rows',
      output: '| n |\n| 65 |',
      truncated: false,
    });

    fetchMock.mockClear();
    const several = await createTarsBuiltinTool({
      toolName: 'tars_sql_query',
      tarsUserId: USER_ID,
      domainId: 200,
    });
    const refused = await invoke(several, 'tars_sql_query', { purpose: 'p', sql: 'SELECT 1' });
    expect(refused.content).toContain('Several databases are bound');
    expect(toolCallOf(fetchMock)).toBeUndefined();

    await invoke(several, 'tars_sql_query', {
      purpose: 'p',
      sql: 'SELECT 1',
      database_knowledge_base_id: 'kb-erp',
    });
    expect(bodyOf(fetchMock).context).toEqual({ knowledge_base_id: 'kb-erp' });
  });

  it('gives a chart the spreadsheets, the model, and the database only when it is switched on', async () => {
    const chartUrl = 'http://tars.host/static/quickchart/chart_1.png';
    const fetchMock = mockBackend(
      ok({ content: 'chart ready', generated_urls: [{ type: 'chart', url: chartUrl }] }),
    );
    const withoutDatabase = await createTarsBuiltinTool({
      toolName: 'tars_create_chart',
      tarsUserId: USER_ID,
      domainId: 100,
      agentTools: ['tars_create_chart'],
      documents,
      model: 'Gemini-3.6-Flash',
    });
    const message = await invoke(withoutDatabase, 'tars_create_chart', { instruction: 'bar' });
    expect(bodyOf(fetchMock).context).toEqual({
      model_name: 'gemini-3.6-flash',
      document_ids: 'doc-1,doc-2',
    });
    expect(message.content).toMatch(
      /^chart ready\n\n!\[chart\]\(\/api\/tars\/static\/quickchart\/chart_1\.png\?sig=[\w-]+\)$/,
    );
    const step = message.artifact?.[Tools.tars_trace]?.step;
    expect(step?.links?.[0]?.url).toMatch(/^\/api\/tars\/static\/quickchart\/chart_1\.png\?sig=/);

    const refused = await invoke(withoutDatabase, 'tars_create_chart', {
      instruction: 'bar',
      database_knowledge_base_id: 'kb-general',
    });
    expect(refused.content).toContain('No database is switched on');

    fetchMock.mockClear();
    const withDatabase = await createTarsBuiltinTool({
      toolName: 'tars_create_chart',
      tarsUserId: USER_ID,
      domainId: 100,
      agentTools: ['tars_create_chart', 'tars_sql_query'],
    });
    await invoke(withDatabase, 'tars_create_chart', { instruction: 'bar' });
    expect(bodyOf(fetchMock).context).toEqual({ knowledge_base_id: 'kb-general' });
  });

  it('relays the progress pwc_tars streams to the card of the call that asked', async () => {
    mockBackend({
      ...ok({ content: '[1] source: a.pdf', summary: '1 chunks' }),
      progress: ['正在檢索知識庫…', '正在重新排序…'],
    });
    const reportProgress = jest.fn();
    const builtin = await createTarsBuiltinTool({
      toolName: 'tars_knowledge_search',
      tarsUserId: USER_ID,
      domainId: 100,
      reportProgress,
    });

    const message = await invoke(builtin, 'tars_knowledge_search', { query: 'q' });
    expect(message.content).toBe('[1] source: a.pdf');
    expect(reportProgress.mock.calls.map(([line]) => line)).toEqual([
      '正在檢索知識庫…',
      '正在重新排序…',
    ]);
    expect(reportProgress.mock.calls[0][1]).toMatchObject({ toolCall: { id: 'call-1' } });
  });

  it('relays a pwc_tars error message to the model', async () => {
    mockBackend({
      status: 400,
      body: {
        success: false,
        message: 'SQL 執行失敗：no such table',
        error_code: 'invalid_request',
      },
    });
    const builtin = await createTarsBuiltinTool({
      toolName: 'tars_sql_query',
      tarsUserId: USER_ID,
      domainId: 100,
    });
    const message = await invoke(builtin, 'tars_sql_query', { purpose: 'p', sql: 'SELECT x' });
    expect(message.content).toContain('failed');
    expect(message.artifact?.[Tools.tars_trace]?.step?.ok).toBe(false);
  });

  it('is not built, rather than failing the batch, when pwc_tars cannot be listed', async () => {
    mockBackend(undefined, { status: 503, body: {} });
    await expect(
      createTarsBuiltinTool({ toolName: 'tars_knowledge_search', tarsUserId: USER_ID }),
    ).resolves.toBeUndefined();
  });

  it('is not built for a tool pwc_tars does not list, and refuses unlinked accounts', async () => {
    const fetchMock = mockBackend();
    await expect(
      createTarsBuiltinTool({ toolName: 'tars_data_query', tarsUserId: USER_ID }),
    ).resolves.toBeUndefined();

    const unlinked = await createTarsBuiltinTool({ toolName: 'tars_knowledge_search' });
    const message = await invoke(unlinked, 'tars_knowledge_search', { query: 'q' });
    expect(message.content).toContain('not linked to pwc_tars');
    expect(toolCallOf(fetchMock)).toBeUndefined();
  });
});

describe('buildTarsToolsContext', () => {
  it("writes pwc_tars's guide for the mounted tools and what the brain lets them reach", async () => {
    mockBackend();
    const tools = ['tars_knowledge_search', 'tars_sql_schema', 'tars_sql_query', 'web_search'];
    await resolveTarsBuiltinTools(tools);
    const context = await buildTarsToolsContext({ tarsUserId: USER_ID, domainId: 200, tools });
    expect(context).toContain('# TARS tools');
    expect(context).toContain(`- tars_knowledge_search：${SEARCH_GUIDE}`);
    expect(context).toContain(
      '- tars_sql_schema / tars_sql_query：先用 tars_sql_schema 看資料表結構，再寫一條只讀 SQL 給 tars_sql_query。',
    );
    expect(context).not.toContain('tars_create_chart');
    expect(context).toContain('- 通用知識庫（knowledge_base_id: kb-general）— 含資料庫');
    expect(context).toContain('- ERP（knowledge_base_id: kb-erp）');
    expect(context).toContain('`database_knowledge_base_id`');
    expect(context).not.toContain('人資知識庫');
  });

  it('is absent without TARS tools and says so for an unlinked account', async () => {
    await expect(
      buildTarsToolsContext({ tarsUserId: USER_ID, tools: ['web_search'] }),
    ).resolves.toBeUndefined();
    await expect(buildTarsToolsContext({ tools: ['tars_knowledge_search'] })).resolves.toContain(
      'not linked to pwc_tars',
    );
  });
});
