jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { Tools, AgentCapabilities } from 'librechat-data-provider';
import type { TarsDataFile } from '~/tars/files/sign';
import { invalidateTarsPluginManifestsCache } from '~/tars/plugins/client';
import { invalidateTarsScopedKnowledgeBasesCache } from '~/tars/scope';
import { invalidateTarsSourceDocumentsCache } from '~/tars/sources';
import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { tarsToolStreamResponse } from './mocks';
import { getTarsToolAuditTrace } from './auditTrace';
import { getTarsToolUsage } from './usage';
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

const dataFiles: TarsDataFile[] = [
  { id: 'file-1', filename: 'orders.xlsx' },
  { id: 'file-2', filename: 'stock.csv' },
];

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
        { name: 'data_file_refs', required: false },
        { name: 'knowledge_base_id', required: false },
        { name: 'model_name', required: false },
      ]),
      { name: 'summarize_text', kind: 'plugin', description: 'plugin', input_schema: {} },
    ],
  },
};

const sourceContent = ['IT200 06:35 11:00 台北 成田', 'IT202 14:15 18:35'].join('\n\n---\n\n');

/** What `get_files_by_id` lists for each knowledge base the brain binds. */
const kbDocuments: Record<string, object[]> = {
  'kb-general': [
    {
      id: 'doc-tiger',
      filename: 'TigerairTaiwan.pdf',
      knowledge_base_ids: 'kb-general',
      file_path: 'apps/static/uploads/kb-general/manual/TigerairTaiwan.pdf',
      status: 2,
    },
  ],
  'kb-docs': [],
};

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
    if (url.includes('/api/km_permission/chat_knowledge_bases')) {
      return buildResponse(200, { success: true, data: knowledgeBases });
    }
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, domains);
    }
    if (url.includes('/api/knowledge_detail/get_files_by_id')) {
      const kbId = new URL(url).searchParams.get('knowledge_base_id') ?? '';
      return buildResponse(200, { documents: kbDocuments[kbId] ?? [] });
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gemini-3.6-flash' }]);
    }
    if (url.includes('/api/settings/list_sys_configs')) {
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
  invalidateTarsSourceDocumentsCache();
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

  describe('參考資料下載', () => {
    const citing = ok({
      content: '[1] source: TigerairTaiwan.pdf ...',
      summary: '2 chunks',
      sources: [
        { filename: 'TigerairTaiwan.pdf', content: sourceContent, type: 'knowledge' },
        { filename: 'https://www.tigerairtw.com/zh-tw', content: 'page', type: 'knowledge' },
      ],
    });
    const searchAs = (options: { sourceDownload?: boolean; agentId?: string }) =>
      createTarsBuiltinTool({
        toolName: 'tars_knowledge_search',
        tarsUserId: USER_ID,
        domainId: 100,
        agentTools: ['tars_knowledge_search'],
        ...options,
      });

    it('links each cited stored file and asks the model for the names verbatim', async () => {
      mockBackend(citing);
      const builtin = await searchAs({ agentId: 'agent_hr', sourceDownload: true });

      const message = await invoke(builtin, 'tars_knowledge_search', { query: '班機' });
      const sources = message.artifact?.[Tools.tars_trace]?.step?.sources;
      expect(sources?.[0].url).toMatch(
        /^\/api\/tars\/kb-files\/agent_hr\/kb-general\/doc-tiger\?sig=[\w-]{22}$/,
      );
      expect(sources?.[1].url).toBeUndefined();
      expect(message.content).toContain('資料來源');
      expect(message.content).toContain('- TigerairTaiwan.pdf');
      expect(message.content).not.toContain('/api/tars/kb-files');
    });

    it('leaves the search untouched while the switch is off or the chat has no saved agent', async () => {
      const fetchMock = mockBackend(citing);
      for (const options of [{ agentId: 'agent_hr' }, { sourceDownload: true }]) {
        const builtin = await searchAs(options);
        const message = await invoke(builtin, 'tars_knowledge_search', { query: '班機' });
        expect(message.content).toBe('[1] source: TigerairTaiwan.pdf ...');
        expect(message.artifact?.[Tools.tars_trace]?.step?.sources?.[0].url).toBeUndefined();
      }
      const listed = fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/api/knowledge_detail/get_files_by_id'),
      );
      expect(listed).toBe(false);
    });
  });

  it('names the brain and the response message so pwc_tars files the search tokens under them', async () => {
    const fetchMock = mockBackend();
    const builtin = await createTarsBuiltinTool({
      toolName: 'tars_knowledge_search',
      tarsUserId: USER_ID,
      domainId: 100,
    });

    await builtin!.invoke(
      { id: 'call-1', name: 'tars_knowledge_search', type: 'tool_call', args: { query: 'q' } },
      { configurable: { requestBody: { messageId: 'response-1' } } },
    );
    const headers = (toolCallOf(fetchMock)?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-TARS-User-Id']).toBe(USER_ID);
    expect(headers['X-TARS-Domain-Id']).toBe('100');
    expect(headers['X-TARS-Message-Id']).toBe('response-1');
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
    expect(refused.content).toContain('Several databases are available');
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
      dataFiles,
      model: 'Gemini-3.6-Flash',
      librechatUserId: 'lc-user',
    });
    const message = await invoke(withoutDatabase, 'tars_create_chart', { instruction: 'bar' });
    const { data_file_refs: refs, ...context } = bodyOf(fetchMock).context as Record<
      string,
      string
    >;
    expect(context).toEqual({ model_name: 'gemini-3.6-flash' });
    expect(JSON.parse(refs)).toEqual([
      {
        id: 'file-1',
        filename: 'orders.xlsx',
        path: expect.stringMatching(/^\/api\/tars\/files\/file-1\?u=lc-user&exp=\d+&sig=[\w-]+$/),
      },
      {
        id: 'file-2',
        filename: 'stock.csv',
        path: expect.stringMatching(/^\/api\/tars\/files\/file-2\?u=lc-user&exp=\d+&sig=[\w-]+$/),
      },
    ]);
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

  /** Kept on the request for the mirror's trace; never in the message or the stream. */
  it('asks for the retrieval detail and keeps it by call id when the request will be mirrored', async () => {
    const retrieval = { type: 'rag_retrieval', query: 'q', parent_id: '', documents: [{ pk: 1 }] };
    const fetchMock = mockBackend(
      ok({
        content: '[1] source: a.pdf',
        audit_trace: [retrieval],
        tokens: { total: 34, prompt: 30, completion: 4 },
      }),
    );
    const req = {};
    const builtin = await createTarsBuiltinTool({
      toolName: 'tars_knowledge_search',
      tarsUserId: USER_ID,
      domainId: 100,
      auditTraceOwner: req,
    });

    const message = await invoke(builtin, 'tars_knowledge_search', { query: 'q' });
    expect(bodyOf(fetchMock)).toMatchObject({ audit_trace: true });
    expect(getTarsToolAuditTrace(req).get('call-1')).toEqual([retrieval]);
    expect(getTarsToolUsage(req).get('call-1')).toEqual({ input_tokens: 30, output_tokens: 4 });
    expect(JSON.stringify(message)).not.toContain('"pk"');
  });

  it('does not ask for the retrieval detail without a request to keep it on', async () => {
    const fetchMock = mockBackend(ok({ content: 'done' }));
    const builtin = await createTarsBuiltinTool({
      toolName: 'tars_knowledge_search',
      tarsUserId: USER_ID,
      domainId: 100,
    });

    await invoke(builtin, 'tars_knowledge_search', { query: 'q' });
    expect(bodyOf(fetchMock)).not.toHaveProperty('audit_trace');
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

describe('on a saved agent, each tool reaches its own picks', () => {
  const domainUrls = (fetchMock: jest.SpyInstance) =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('get_domain_by_user'));

  it('searches the picked knowledge bases on the chat list, never the brain', async () => {
    const fetchMock = mockBackend(ok({ content: 'found' }));
    const search = await createTarsBuiltinTool({
      toolName: 'tars_knowledge_search',
      tarsUserId: USER_ID,
      domainId: 100,
      agentKnowledgeBases: { rag_agent: ['kb-hr', 'kb-gone'], sql_agent: ['kb-general'] },
    });

    await invoke(search, 'tars_knowledge_search', { query: 'q' });
    expect(bodyOf(fetchMock).context).toEqual({ knowledge_base_ids: 'kb-hr' });
    expect(domainUrls(fetchMock)).toHaveLength(0);

    fetchMock.mockClear();
    const refused = await invoke(search, 'tars_knowledge_search', {
      query: 'q',
      knowledge_base_ids: ['kb-general'],
    });
    expect(refused.content).toContain('kb-general');
    expect(toolCallOf(fetchMock)).toBeUndefined();
  });

  it('refuses a search when nothing usable is picked', async () => {
    const fetchMock = mockBackend();
    const search = await createTarsBuiltinTool({
      toolName: 'tars_knowledge_search',
      tarsUserId: USER_ID,
      domainId: 100,
      agentKnowledgeBases: {},
    });

    const refused = await invoke(search, 'tars_knowledge_search', { query: 'q' });
    expect(refused.content).toContain('picked no knowledge base for this tool');
    expect(toolCallOf(fetchMock)).toBeUndefined();
  });

  it('queries the one database picked for 資料庫查詢', async () => {
    const fetchMock = mockBackend(ok({ content: 'rows' }));
    const query = await createTarsBuiltinTool({
      toolName: 'tars_sql_query',
      tarsUserId: USER_ID,
      domainId: 100,
      agentKnowledgeBases: { sql_agent: ['kb-erp'], chart_agent: ['kb-general'] },
    });

    await invoke(query, 'tars_sql_query', { purpose: 'p', sql: 'SELECT 1' });
    expect(bodyOf(fetchMock).context).toEqual({ knowledge_base_id: 'kb-erp' });

    const none = await createTarsBuiltinTool({
      toolName: 'tars_sql_query',
      tarsUserId: USER_ID,
      domainId: 100,
      agentKnowledgeBases: { sql_agent: ['kb-docs'] },
    });
    fetchMock.mockClear();
    const refused = await invoke(none, 'tars_sql_query', { purpose: 'p', sql: 'SELECT 1' });
    expect(refused.content).toContain('picked no database for this tool');
    expect(toolCallOf(fetchMock)).toBeUndefined();
  });

  it("charts from the chart's own picks, without 資料庫查詢 switched on", async () => {
    const fetchMock = mockBackend(ok({ content: 'chart ready' }));
    const create = (picks: string[]) =>
      createTarsBuiltinTool({
        toolName: 'tars_create_chart',
        tarsUserId: USER_ID,
        domainId: 100,
        agentTools: ['tars_create_chart'],
        agentKnowledgeBases: { chart_agent: picks, sql_agent: ['kb-hr'] },
      });

    await invoke(await create(['kb-erp']), 'tars_create_chart', { instruction: 'bar' });
    expect(bodyOf(fetchMock).context).toEqual({ knowledge_base_id: 'kb-erp' });

    const several = await create(['kb-general', 'kb-erp']);
    fetchMock.mockClear();
    await invoke(several, 'tars_create_chart', { instruction: 'bar' });
    expect(bodyOf(fetchMock).context).toEqual({});
    fetchMock.mockClear();
    await invoke(several, 'tars_create_chart', {
      instruction: 'bar',
      database_knowledge_base_id: 'kb-general',
    });
    expect(bodyOf(fetchMock).context).toEqual({ knowledge_base_id: 'kb-general' });

    fetchMock.mockClear();
    const outside = await invoke(several, 'tars_create_chart', {
      instruction: 'bar',
      database_knowledge_base_id: 'kb-hr',
    });
    expect(outside.content).toContain('not a database this tool may use');
    expect(toolCallOf(fetchMock)).toBeUndefined();

    const unpicked = await create([]);
    await invoke(unpicked, 'tars_create_chart', { instruction: 'bar' });
    expect(bodyOf(fetchMock).context).toEqual({});
    fetchMock.mockClear();
    const refused = await invoke(unpicked, 'tars_create_chart', {
      instruction: 'bar',
      database_knowledge_base_id: 'kb-erp',
    });
    expect(refused.content).toContain('picked no database for this tool');
    expect(toolCallOf(fetchMock)).toBeUndefined();
  });

  it('lists what each mounted tool reaches in the context', async () => {
    mockBackend();
    const tools = [
      'tars_knowledge_search',
      'tars_sql_schema',
      'tars_sql_query',
      'tars_create_chart',
    ];
    await resolveTarsBuiltinTools(tools);
    const context = await buildTarsToolsContext({
      tarsUserId: USER_ID,
      domainId: 100,
      agentKnowledgeBases: {
        rag_agent: ['kb-hr'],
        sql_agent: ['kb-erp'],
        chart_agent: ['kb-general', 'kb-erp'],
      },
      tools,
    });

    expect(context).toContain('- 人資知識庫（knowledge_base_id: kb-hr）— 別的腦的');
    expect(context).not.toContain('文件庫');
    expect(context).toContain(
      'tars_sql_schema / tars_sql_query 的資料庫：ERP（自動使用，不必指定）。',
    );
    expect(context).toContain('tars_create_chart 可用的資料庫');
    expect(context).toContain('- 通用知識庫（knowledge_base_id: kb-general）');
  });

  it('says so in the context when a tool has nothing picked', async () => {
    mockBackend();
    const tools = ['tars_knowledge_search', 'tars_create_chart'];
    await resolveTarsBuiltinTools(tools);
    const context = await buildTarsToolsContext({
      tarsUserId: USER_ID,
      domainId: 100,
      agentKnowledgeBases: {},
      tools,
    });

    expect(context).toContain('Agent 沒有選擇這位使用者可在聊天使用的知識庫。');
    expect(context).toContain('tars_create_chart：Agent 沒有選擇這位使用者可在聊天使用的資料庫。');
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
