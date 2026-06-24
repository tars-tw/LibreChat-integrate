jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsKnowledgeBaseDocuments,
  uploadTarsKnowledgeBaseDocuments,
  renameTarsKnowledgeBaseDocument,
  deleteTarsKnowledgeBaseDocument,
  reprocessTarsKnowledgeBaseDocument,
  fetchTarsDocumentChunks,
  updateTarsChunk,
  deleteTarsChunk,
} from './knowledge';
import type { TarsDocument } from './knowledge';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const doc = (id: string, filename: string): TarsDocument => ({
  id,
  filename,
  status: 2,
});

describe('fetchTarsKnowledgeBaseDocuments', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns [] without calling pwc_tars when the kb id is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(fetchTarsKnowledgeBaseDocuments('', BASE_URL)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests get_files_by_id with the kb id and returns documents', async () => {
    const documents = [doc('d1', 'a.pdf'), doc('d2', 'b.docx')];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { documents }));

    const result = await fetchTarsKnowledgeBaseDocuments('kb1', BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/knowledge_detail/get_files_by_id?knowledge_base_id=kb1`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(documents);
  });

  it('defaults to [] when the response omits documents', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await expect(fetchTarsKnowledgeBaseDocuments('kb1', BASE_URL)).resolves.toEqual([]);
  });
});

describe('uploadTarsKnowledgeBaseDocuments', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts multipart form data with files, settings and the user id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(201, { message: 'ok' }));

    await uploadTarsKnowledgeBaseDocuments(
      'u1',
      {
        knowledgeBaseId: 'kb1',
        files: [{ buffer: Buffer.from('hello'), filename: 'a.txt', mimetype: 'text/plain' }],
        chunkSize: 500,
        overlap: 100,
        processImages: false,
        fileSettings: { 'a.txt': { chunkSize: 500, overlap: 100 } },
      },
      BASE_URL,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/knowledge_detail/upload_multiple_file`);
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('user_id')).toBe('u1');
    expect(form.get('knowledge_base_id')).toBe('kb1');
    expect(form.get('chunk_size')).toBe('500');
    expect(form.get('overlap')).toBe('100');
    expect(form.get('process_images')).toBe('false');
    expect(form.get('file_settings')).toBe(
      JSON.stringify({ 'a.txt': { chunkSize: 500, overlap: 100 } }),
    );
    expect(form.getAll('files')).toHaveLength(1);
  });

  it('throws on a non-2xx pwc_tars response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(500, {}));
    await expect(
      uploadTarsKnowledgeBaseDocuments(
        'u1',
        {
          knowledgeBaseId: 'kb1',
          files: [{ buffer: Buffer.from('x'), filename: 'a.txt', mimetype: 'text/plain' }],
        },
        BASE_URL,
      ),
    ).rejects.toThrow('status 500');
  });
});

describe('document mutations', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renames a document with the expected body', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { document: doc('d1', 'renamed.pdf') }));

    const result = await renameTarsKnowledgeBaseDocument(
      'u1',
      { knowledgeBaseId: 'kb1', documentId: 'd1', newFilename: 'renamed.pdf' },
      BASE_URL,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/knowledge_detail/rename_file`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          user_id: 'u1',
          knowledge_base_id: 'kb1',
          document_id: 'd1',
          new_filename: 'renamed.pdf',
        }),
      }),
    );
    expect(result.filename).toBe('renamed.pdf');
  });

  it('deletes a document with the expected body', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    await deleteTarsKnowledgeBaseDocument(
      'u1',
      { knowledgeBaseId: 'kb1', documentId: 'd1' },
      BASE_URL,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/knowledge_detail/delete_file`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ user_id: 'u1', document_id: 'd1', knowledge_base_id: 'kb1' }),
      }),
    );
  });

  it('reprocesses a document with default chunk settings', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    await reprocessTarsKnowledgeBaseDocument(
      'u1',
      { knowledgeBaseId: 'kb1', documentId: 'd1' },
      BASE_URL,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/knowledge_detail/reupload_files_to_filesystem`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          user_id: 'u1',
          knowledge_base_id: 'kb1',
          document_id: 'd1',
          chunk_size: 1000,
          overlap: 200,
        }),
      }),
    );
  });
});

describe('chunk operations', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fetches chunks for a document', async () => {
    const chunks = [{ id: 'c1', document_id: 'd1', position: 0, content: 'hi' }];
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { chunks }));

    const result = await fetchTarsDocumentChunks('d1', BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/knowledge_detail/get_chunks?document_id=d1`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(chunks);
  });

  it('updates a chunk with the editor as updated_by', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(200, { chunk: { id: 'c1', document_id: 'd1', position: 0, content: 'new' } }),
      );

    await updateTarsChunk('u1', { chunkId: 'c1', content: 'new' }, BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/knowledge_detail/update_chunk`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chunk_id: 'c1', content: 'new', updated_by: 'u1' }),
      }),
    );
  });

  it('deletes a chunk by id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    await deleteTarsChunk('c1', BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/knowledge_detail/delete_chunk/c1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
