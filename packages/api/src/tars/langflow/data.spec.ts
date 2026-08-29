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
import { createTarsDataTool } from './data';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const doc = (id: string, filename: string): TarsMemoryDocument => ({
  id,
  conversation_id: 'conv-1',
  filename,
  extension: 'xlsx',
  mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size: 1024,
  status: 1,
  word_count: 10,
  tokens: 100,
  summary: null,
  created_by: USER_ID,
  created_at: null,
  structured: true,
});

const documents = [doc('doc-1', 'orders.xlsx'), doc('doc-2', 'sales.xlsx')];

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const mockBackend = (data: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/langflow-service/data')) {
      return buildResponse(data.status, data.body);
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

const dataBodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> => {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes('/api/langflow-service/data'),
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

describe('createTarsDataTool', () => {
  it('queries every attached spreadsheet by default', async () => {
    const fetchMock = mockBackend({
      status: 200,
      body: { success: true, data: { answer: '共 42 列', data_files: ['orders.xlsx'] } },
    });
    const dataTool = createTarsDataTool({ tarsUserId: USER_ID, documents, model: 'gpt-5.4-mini' });

    await expect(dataTool.invoke({ question: '有幾列？' })).resolves.toBe('共 42 列');
    expect(dataBodyOf(fetchMock)).toEqual({
      query: '有幾列？',
      document_ids: 'doc-1,doc-2',
      model_name: 'gpt-5.4-mini',
    });
  });

  it('drops requested ids outside the conversation attachments', async () => {
    const fetchMock = mockBackend({
      status: 200,
      body: { success: true, data: { answer: 'ok' } },
    });
    const dataTool = createTarsDataTool({ tarsUserId: USER_ID, documents });

    await dataTool.invoke({ question: 'q', document_ids: ['doc-2', 'foreign-doc'] });
    expect(dataBodyOf(fetchMock)).toMatchObject({ document_ids: 'doc-2' });
  });

  it('advertises the attached files in its description', () => {
    const dataTool = createTarsDataTool({ tarsUserId: USER_ID, documents });
    expect(dataTool.description).toContain('orders.xlsx');
    expect(dataTool.description).toContain('doc-2');
  });

  it('fails closed for an unlinked account', async () => {
    const fetchMock = mockBackend({ status: 200, body: {} });
    const dataTool = createTarsDataTool({ documents });
    await expect(dataTool.invoke({ question: 'q' })).resolves.toMatch(/not linked to pwc_tars/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers cleanly when no spreadsheet is attached', async () => {
    const fetchMock = mockBackend({ status: 200, body: {} });
    const dataTool = createTarsDataTool({ tarsUserId: USER_ID, documents: [] });
    await expect(dataTool.invoke({ question: 'q' })).resolves.toMatch(/No spreadsheet file/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports pwc_tars data errors as tool output', async () => {
    mockBackend({ status: 410, body: { message: '資料檔已不存在' } });
    const dataTool = createTarsDataTool({ tarsUserId: USER_ID, documents });
    await expect(dataTool.invoke({ question: 'q' })).resolves.toBe(
      'The data query failed: 資料檔已不存在',
    );
  });
});
