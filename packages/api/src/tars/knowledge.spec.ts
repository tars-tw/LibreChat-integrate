jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsKnowledgeBaseOverview,
  fetchTarsKnowledgeBaseModelBindings,
  updateTarsKnowledgeBaseModel,
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

describe('fetchTarsKnowledgeBaseOverview', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns empty lists without calling pwc_tars when the caller has no tars id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(fetchTarsKnowledgeBaseOverview('', BASE_URL)).resolves.toEqual({
      knowledge_bases: [],
      users: [],
      user_groups: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries the users and groups the access pickers need', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        knowledge_bases: [{ id: 'kb-1', name: 'HR', description: null }],
        users: [{ id: 'u-1', username: 'amy', display_name: 'Amy' }],
        user_groups: [{ id: 'g-1', name: 'Legal' }],
      }),
    );

    const overview = await fetchTarsKnowledgeBaseOverview('user-1', BASE_URL);

    expect(overview.knowledge_bases).toHaveLength(1);
    expect(overview.users[0].display_name).toBe('Amy');
    expect(overview.user_groups[0].name).toBe('Legal');
  });

  /**
   * pwc_tars only started returning the picker lists alongside the bases; an
   * older deployment answers with `knowledge_bases` alone.
   */
  it('defaults the picker lists when pwc_tars omits them', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { knowledge_bases: [{ id: 'kb-1', name: 'HR' }] }));

    const overview = await fetchTarsKnowledgeBaseOverview('user-1', BASE_URL);

    expect(overview.users).toEqual([]);
    expect(overview.user_groups).toEqual([]);
  });
});

describe('fetchTarsKnowledgeBaseModelBindings', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks pwc_tars for the bindings of one knowledge base', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        embedding: { selected_id: 'e-1', options: [{ id: 'e-1', name: 'bge' }] },
        rerank: { selected_id: 'r-1', options: [{ id: 'r-1', name: 'bge-rerank' }] },
        llm: { selected_id: 'gpt', options: [{ id: 'gpt', name: 'GPT' }] },
      }),
    );

    const bindings = await fetchTarsKnowledgeBaseModelBindings('user-1', 'kb-1', BASE_URL);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/knowledge_detail/get_models_by_knowledge');
    expect(url.searchParams.get('knowledge_base_id')).toBe('kb-1');
    expect(bindings.llm.selected_id).toBe('gpt');
  });

  it('returns empty option lists when pwc_tars omits a model kind', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    const bindings = await fetchTarsKnowledgeBaseModelBindings('user-1', 'kb-1', BASE_URL);

    expect(bindings.rerank).toEqual({ selected_id: null, options: [] });
  });
});

describe('updateTarsKnowledgeBaseModel', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends only the models the caller asked to rebind', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { id: 'kb-1', name: 'HR' }));

    await updateTarsKnowledgeBaseModel('user-1', 'kb-1', { llm_model_id: 'gpt' }, BASE_URL);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({ user_id: 'user-1', knowledge_base_id: 'kb-1', llm_model_id: 'gpt' });
    expect(body).not.toHaveProperty('rerank_model_id');
  });
});
