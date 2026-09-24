jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { Tools } from 'librechat-data-provider';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { invalidateTarsRagKnowledgeBasesCache } from './client';
import { createTarsRagTool, buildTarsRagContext } from './tool';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const knowledgeBases = [
  { id: 'kb-general', name: '通用知識庫', description: '公司規章', has_sql_database: true },
  { id: 'kb-hr', name: '人資知識庫', description: '', has_sql_database: false },
  { id: 'kb-docs', name: '文件庫', description: '', has_sql_database: false },
];

const answerBody = {
  success: true,
  data: {
    answer: '請假依《考勤辦法》辦理',
    model_name: 'gemini-3.6-flash',
    tokens: { total: 900 },
  },
};

/** Domain 100 binds `kb-general` + `kb-docs`; domain 7 binds nothing. */
const mockBackend = (rag: { status: number; body: unknown } = { status: 200, body: answerBody }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/knowledge_base/prepare_data')) {
      return buildResponse(200, { knowledge_bases: knowledgeBases });
    }
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, {
        sys_domains: [
          { id: 100, name: '通用腦', knowledge_base_ids: 'kb-general,kb-docs' },
          { id: 7, name: '空腦', knowledge_base_ids: '' },
        ],
      });
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gemini-3.6-flash' }]);
    }
    if (url.includes('/api/sys_config/prepare_data')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'from-sysconfig', status: 'active' },
      ]);
    }
    if (url.includes('/api/langflow-service/rag')) {
      return buildResponse(rag.status, rag.body);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const ragBodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> => {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes('/api/langflow-service/rag'),
  );
  return JSON.parse(String((call?.[1] as RequestInit).body));
};

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsRagKnowledgeBasesCache();
  invalidateTarsSysConfigCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createTarsRagTool', () => {
  it("is named for the native tool and advertises the brain's knowledge bases", async () => {
    mockBackend();
    const ragTool = await createTarsRagTool({ tarsUserId: USER_ID, domainId: 100 });

    expect(ragTool.name).toBe('rag_agent');
    expect(ragTool.responseFormat).toBe('content_and_artifact');
    expect(ragTool.description).toContain('通用知識庫');
    expect(ragTool.description).toContain('文件庫');
    expect(ragTool.description).not.toContain('人資知識庫');
  });

  it('searches the whole brain when the model names nothing', async () => {
    const fetchMock = mockBackend();
    const ragTool = await createTarsRagTool({
      tarsUserId: USER_ID,
      domainId: 100,
      model: 'gemini-3.6-flash',
    });

    await expect(ragTool.invoke({ question: '請假規定？' })).resolves.toBe(
      '請假依《考勤辦法》辦理',
    );
    expect(ragBodyOf(fetchMock)).toEqual({
      query: '請假規定？',
      knowledge_base_ids: 'kb-general,kb-docs',
      model_name: 'gemini-3.6-flash',
    });
  });

  it('attaches the pwc_tars run trace, keeping only the answer for the model', async () => {
    const trace = [
      { type: 'turn', turn: 1 },
      { type: 'tool_call', id: 'c1', name: 'knowledge_search', input: { query: '請假' } },
      { type: 'tool_result', id: 'c1', name: 'knowledge_search', ok: true, output: '…' },
    ];
    mockBackend({ status: 200, body: { success: true, data: { ...answerBody.data, trace } } });
    const ragTool = await createTarsRagTool({ tarsUserId: USER_ID, domainId: 100 });

    const message = await ragTool.invoke({
      id: 'call-1',
      name: 'rag_agent',
      type: 'tool_call',
      args: { question: '請假規定？' },
    });
    expect(message.content).toBe('請假依《考勤辦法》辦理');
    expect(message.artifact?.[Tools.tars_trace]?.trace).toEqual(trace);
  });

  it('refuses a knowledge base outside the active brain as tool output', async () => {
    mockBackend();
    const ragTool = await createTarsRagTool({ tarsUserId: USER_ID, domainId: 100 });

    await expect(
      ragTool.invoke({ question: 'q', knowledge_base_ids: ['kb-hr'] }),
    ).resolves.toContain('kb-hr');
  });

  it('says so when the brain binds no knowledge base', async () => {
    const fetchMock = mockBackend();
    const ragTool = await createTarsRagTool({ tarsUserId: USER_ID, domainId: 7 });

    expect(ragTool.description).toContain('binds no knowledge base');
    await expect(ragTool.invoke({ question: 'q' })).resolves.toContain('binds no knowledge base');
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/langflow-service/rag')),
    ).toBe(false);
  });

  it('returns the pwc_tars failure as tool output rather than throwing', async () => {
    mockBackend({ status: 404, body: { message: '部分知識庫不存在' } });
    const ragTool = await createTarsRagTool({ tarsUserId: USER_ID, domainId: 100 });

    await expect(ragTool.invoke({ question: 'q' })).resolves.toContain('部分知識庫不存在');
  });
});

describe('createTarsRagTool without a pwc_tars identity', () => {
  it('reaches nothing and never calls pwc_tars', async () => {
    const fetchMock = mockBackend();
    const ragTool = await createTarsRagTool({ tarsUserId: undefined, domainId: 100 });

    expect(ragTool.description).toContain('not linked to pwc_tars');
    await expect(ragTool.invoke({ question: 'q' })).resolves.toContain('not linked to pwc_tars');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buildTarsRagContext', () => {
  it('names the searchable knowledge bases for the definition-only load path', async () => {
    mockBackend();
    const context = await buildTarsRagContext(USER_ID, 100);
    expect(context).toContain('`rag_agent` Runtime Context');
    expect(context).toContain('kb-general');
    expect(context).toContain('kb-docs');
  });

  it('fails closed for an unlinked account', async () => {
    await expect(buildTarsRagContext(undefined, 100)).resolves.toContain('not linked to pwc_tars');
  });
});
