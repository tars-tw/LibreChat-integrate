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
import {
  runTarsRagAgent,
  listTarsRagKnowledgeBases,
  invalidateTarsRagKnowledgeBasesCache,
} from './client';

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
  { id: 'kb-hr', name: '人資知識庫', description: '別的腦的', has_sql_database: false },
  { id: 'kb-docs', name: '文件庫', description: null, has_sql_database: false },
];

/** Domain 100 (通用腦) binds `kb-general` and `kb-docs`; `kb-hr` belongs elsewhere. */
const domainResponse = {
  sys_domains: [{ id: 100, name: '通用腦', knowledge_base_ids: 'kb-general,kb-docs' }],
};

const mockBackend = (rag?: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/knowledge_base/prepare_data')) {
      return buildResponse(200, { knowledge_bases: knowledgeBases });
    }
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, domainResponse);
    }
    if (url.includes('/api/langflow-service/rag')) {
      return buildResponse(rag?.status ?? 200, rag?.body ?? {});
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
  data: { answer: '請假依《考勤辦法》辦理', model_name: 'gpt-5.4-mini', tokens: { total: 1234 } },
};

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
  invalidateTarsModelProfilesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('listTarsRagKnowledgeBases', () => {
  it('lists every knowledge base the active brain binds, database-backed or not', async () => {
    mockBackend();
    const bases = await listTarsRagKnowledgeBases(USER_ID, 100);
    expect(bases.map((base) => base.knowledge_base_id)).toEqual(['kb-general', 'kb-docs']);
    expect(bases[1].description).toBe('');
  });

  it('falls back to everything the user may access without a brain', async () => {
    mockBackend();
    const bases = await listTarsRagKnowledgeBases(USER_ID);
    expect(bases.map((base) => base.knowledge_base_id)).toEqual(['kb-general', 'kb-hr', 'kb-docs']);
  });

  it('returns nothing for an unlinked user without calling pwc_tars', async () => {
    const fetchMock = mockBackend();
    await expect(listTarsRagKnowledgeBases('', 100)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('runTarsRagAgent', () => {
  it('searches every knowledge base of the brain when none is named', async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });

    const result = await runTarsRagAgent(USER_ID, {
      question: '請假規定？',
      domainId: 100,
      model: 'gpt-5.4-mini',
    });
    expect(result).toEqual({
      answer: '請假依《考勤辦法》辦理',
      modelName: 'gpt-5.4-mini',
      totalTokens: 1234,
      knowledgeBaseIds: ['kb-general', 'kb-docs'],
    });
    expect(ragBodyOf(fetchMock)).toEqual({
      query: '請假規定？',
      knowledge_base_ids: 'kb-general,kb-docs',
      model_name: 'gpt-5.4-mini',
    });
    const init = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/langflow-service/rag'),
    )?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-TARS-Service-Key']).toBe('from-sysconfig');
    expect((init.headers as Record<string, string>)['X-Use-Librechat-Gateway']).toBe('true');
  });

  it('narrows to the named subset', async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });
    await runTarsRagAgent(USER_ID, {
      question: 'q',
      domainId: 100,
      knowledgeBaseIds: ['kb-docs', 'kb-docs', ' '],
    });
    expect(ragBodyOf(fetchMock)).toMatchObject({ knowledge_base_ids: 'kb-docs' });
  });

  it('refuses a knowledge base outside the brain instead of narrowing silently', async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });
    await expect(
      runTarsRagAgent(USER_ID, { question: 'q', domainId: 100, knowledgeBaseIds: ['kb-hr'] }),
    ).rejects.toThrow('kb-hr');
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/langflow-service/rag')),
    ).toBe(false);
  });

  it('refuses a brain that binds nothing', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/knowledge_base/prepare_data')) {
        return buildResponse(200, { knowledge_bases: knowledgeBases });
      }
      if (url.includes('/api/domain_settings/get_domain_by_user')) {
        return buildResponse(200, {
          sys_domains: [{ id: 7, name: '空腦', knowledge_base_ids: '' }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    await expect(runTarsRagAgent(USER_ID, { question: 'q', domainId: 7 })).rejects.toThrow(
      'binds no knowledge base',
    );
  });

  it('carries the run trace back for the chat', async () => {
    const trace = [{ type: 'tool_call', id: 'c1', name: 'knowledge_search', input: {} }];
    mockBackend({ status: 200, body: { success: true, data: { ...answerBody.data, trace } } });
    const result = await runTarsRagAgent(USER_ID, { question: 'q', domainId: 100 });
    expect(result.trace?.trace).toEqual(trace);
  });

  it('surfaces the pwc_tars failure message', async () => {
    mockBackend({ status: 404, body: { message: '部分知識庫不存在' } });
    await expect(runTarsRagAgent(USER_ID, { question: 'q', domainId: 100 })).rejects.toMatchObject({
      status: 404,
      serverMessage: '部分知識庫不存在',
    });
  });
});
