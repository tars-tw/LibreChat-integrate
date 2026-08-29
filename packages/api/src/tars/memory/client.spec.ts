jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  listTarsMemoryDocuments,
  uploadTarsMemoryFiles,
  updateTarsMemoryDocumentStatus,
  deleteTarsMemoryDocument,
} from './client';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const row = (overrides: Record<string, unknown>) => ({
  id: 'doc-1',
  conversation_id: 'conv-1',
  filename: 'report.pdf',
  extension: 'pdf',
  mime_type: 'application/pdf',
  size: 2048,
  status: 1,
  word_count: 100,
  tokens: 500,
  summary: '報告內容',
  created_by: USER_ID,
  created_at: '2026-08-28T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('listTarsMemoryDocuments', () => {
  it('drops rows other users own and derives the structured flag', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          documents: [
            row({}),
            row({ id: 'doc-2', filename: 'orders.XLSX', extension: 'XLSX' }),
            row({ id: 'doc-3', created_by: 'someone-else' }),
          ],
          token_used: 600,
          token_limit: 192000,
        },
      }),
    );

    const list = await listTarsMemoryDocuments(USER_ID, 'conv-1');
    expect(list.tokenUsed).toBe(600);
    expect(list.tokenLimit).toBe(192000);
    expect(list.documents.map((doc) => doc.id)).toEqual(['doc-1', 'doc-2']);
    expect(list.documents[0].structured).toBe(false);
    expect(list.documents[1].structured).toBe(true);
  });
});

describe('uploadTarsMemoryFiles', () => {
  it('sends the multipart fields pwc_tars expects and returns the created conversation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          conversation_id: 'tars-conv-9',
          processed_files: [{ filename: 'a.pdf', size: 1, extension: 'pdf', document_id: 'doc-9' }],
          rejected_files: [],
          token_used: 10,
          token_limit: 192000,
        },
      }),
    );

    const result = await uploadTarsMemoryFiles(USER_ID, {
      files: [{ buffer: Buffer.from('x'), mimetype: 'application/pdf', filename: 'a.pdf' }],
      domainId: 100,
      modelName: undefined,
    });

    expect(result.tarsConversationId).toBe('tars-conv-9');
    expect(result.processedFiles).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE_URL}/api/conversation/upload_memory_data`);
    const form = (init as RequestInit).body as FormData;
    expect(form.get('user_id')).toBe(USER_ID);
    expect(form.get('domain_id')).toBe('100');
    expect(form.get('conversation_id')).toBeNull();
    expect(form.getAll('conversation_files')).toHaveLength(1);
  });

  it('surfaces the pwc_tars error message on failure', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { success: false, message: '缺少必要參數' }));

    await expect(
      uploadTarsMemoryFiles(USER_ID, {
        files: [{ buffer: Buffer.from('x'), mimetype: 'text/plain', filename: 'a.txt' }],
        domainId: 100,
      }),
    ).rejects.toMatchObject({ status: 400, serverMessage: '缺少必要參數' });
  });
});

describe('document mutations', () => {
  it('sends the status flip with the user id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await updateTarsMemoryDocumentStatus(USER_ID, 'doc-1', 0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/conversation/update_memory_document_status/doc-1');
    expect(String(url)).toContain(`user_id=${USER_ID}`);
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ status: 0 });
  });

  it('deletes with the user id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await deleteTarsMemoryDocument(USER_ID, 'doc-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/conversation/delete_memory_document/doc-1');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});
