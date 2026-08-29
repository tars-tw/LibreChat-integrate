jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import type { TarsMemoryDocument } from '~/tars/memory/client';
import { invalidateTarsModelProfilesCache } from '~/tars/models';
import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { createTarsTableTaskTool } from './table';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';
const FILE_URL = 'http://tars.test/static/generate_output/kb_1/table_task_ab.xlsx';

const documents: TarsMemoryDocument[] = [
  {
    id: 'doc-1',
    conversation_id: 'conv-1',
    filename: 'orders.xlsx',
    extension: 'xlsx',
    mime_type: null,
    size: 1024,
    status: 1,
    word_count: 10,
    tokens: 100,
    summary: null,
    created_by: USER_ID,
    created_at: null,
    structured: true,
  },
];

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

/** Domain 100 binds two knowledge bases; domain 200 binds none. */
const mockBackend = (tableTask: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, {
        sys_domains: [
          { id: 100, name: '通用腦', knowledge_base_ids: 'kb-1,kb-2' },
          { id: 200, name: '空腦', knowledge_base_ids: '' },
        ],
      });
    }
    if (url.includes('/api/knowledge_base/prepare_data')) {
      return buildResponse(200, {
        knowledge_bases: [
          { id: 'kb-1', name: '規格庫' },
          { id: 'kb-2', name: '文件庫' },
        ],
      });
    }
    if (url.includes('/api/langflow-service/table-task')) {
      return buildResponse(tableTask.status, tableTask.body);
    }
    if (url.includes('/api/sys_config/prepare_data')) {
      return buildResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'service-key', status: 'active' },
      ]);
    }
    if (url.includes('/api/model/get_model_list')) {
      return buildResponse(200, [{ model_name: 'gpt-5.4-mini' }, { model_name: 'gpt-5.5' }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const tableBodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> => {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes('/api/langflow-service/table-task'),
  );
  return JSON.parse(String((call?.[1] as RequestInit).body));
};

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsSysConfigCache();
  invalidateTarsModelProfilesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createTarsTableTaskTool', () => {
  it("runs the task against the active brain's knowledge bases", async () => {
    const fetchMock = mockBackend({
      status: 200,
      body: { success: true, data: { answer: '| 列 | 結果 |', file_url: FILE_URL } },
    });
    const tableTool = createTarsTableTaskTool({
      tarsUserId: USER_ID,
      domainId: 100,
      documents,
      model: 'gpt-5.4-mini',
    });

    await expect(tableTool.invoke({ task: '逐列比對規格' })).resolves.toBe(
      `| 列 | 結果 |\n\n[下載完整結果 (xlsx)](${FILE_URL})`,
    );
    expect(tableBodyOf(fetchMock)).toEqual({
      query: '逐列比對規格',
      knowledge_base_ids: 'kb-1,kb-2',
      document_ids: 'doc-1',
      model_name: 'gpt-5.4-mini',
    });
  });

  it('keeps the answer untouched when the download link is already embedded', async () => {
    const answer = `| 列 |\n[下載完整結果 (xlsx)](${FILE_URL})`;
    mockBackend({ status: 200, body: { success: true, data: { answer, file_url: FILE_URL } } });
    const tableTool = createTarsTableTaskTool({
      tarsUserId: USER_ID,
      domainId: 100,
      documents,
    });
    await expect(tableTool.invoke({ task: 't' })).resolves.toBe(answer);
  });

  it('refuses without an active brain', async () => {
    const fetchMock = mockBackend({ status: 200, body: {} });
    const tableTool = createTarsTableTaskTool({ tarsUserId: USER_ID, documents });
    await expect(tableTool.invoke({ task: 't' })).resolves.toMatch(/No active brain/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when the brain binds no knowledge base', async () => {
    const fetchMock = mockBackend({ status: 200, body: {} });
    const tableTool = createTarsTableTaskTool({
      tarsUserId: USER_ID,
      domainId: 200,
      documents,
    });
    await expect(tableTool.invoke({ task: 't' })).resolves.toMatch(/binds no knowledge base/);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/langflow-service/')),
    ).toBe(false);
  });

  it('fails closed for an unlinked account and with no attachments', async () => {
    const fetchMock = mockBackend({ status: 200, body: {} });
    const notLinked = createTarsTableTaskTool({ domainId: 100, documents });
    await expect(notLinked.invoke({ task: 't' })).resolves.toMatch(/not linked to pwc_tars/);

    const noFiles = createTarsTableTaskTool({ tarsUserId: USER_ID, domainId: 100, documents: [] });
    await expect(noFiles.invoke({ task: 't' })).resolves.toMatch(/No spreadsheet file/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
