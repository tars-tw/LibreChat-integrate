jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsKnowledgeBaseDatasets,
  fetchTarsDatabaseTables,
  fetchTarsFileSystemSources,
  importTarsWebsiteDataset,
  batchDeleteTarsDatasets,
  unbindTarsDatabase,
  fetchTarsWebsiteChunks,
} from './datasets';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const bodyOf = (fetchMock: jest.SpyInstance, call = 0): Record<string, unknown> =>
  JSON.parse(String(fetchMock.mock.calls[call][1]?.body));

describe('fetchTarsKnowledgeBaseDatasets', () => {
  afterEach(() => jest.restoreAllMocks());

  it('strips credentials off every database row', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        knowledge_base: { id: 'kb-1', name: 'HR' },
        dataset_sqls: [
          {
            id: 'db-1',
            name: 'warehouse',
            host: 'db.internal',
            port: 5432,
            database_name: 'hr',
            username: 'svc_hr',
            password: 'hunter2',
            connection_string: 'postgresql://svc_hr:hunter2@db.internal/hr',
            extra_params: 'sslmode=require',
            db_type: 'POSTGRESQL',
          },
        ],
        all_dataset_sqls: [
          { id: 'db-2', name: 'sales', password: 'also-secret', db_type: 'MYSQL' },
        ],
      }),
    );

    const result = await fetchTarsKnowledgeBaseDatasets('user-1', 'kb-1', BASE_URL);

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('also-secret');
    expect(serialised).not.toContain('svc_hr');
    expect(result.databases[0]).not.toHaveProperty('password');
    expect(result.databases[0]).not.toHaveProperty('connection_string');
    expect(result.available_databases[0]).not.toHaveProperty('password');
    /** The identifying fields still have to survive the copy. */
    expect(result.databases[0].host).toBe('db.internal');
    expect(result.databases[0].db_type).toBe('POSTGRESQL');
  });

  /** Without these the upload forms would validate against invented numbers. */
  it('falls back to pwc_tars defaults when the limits are absent', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    const result = await fetchTarsKnowledgeBaseDatasets('user-1', 'kb-1', BASE_URL);

    expect(result.limits).toEqual({
      max_upload_counts: 5,
      max_chunk_size: 30000,
      max_overlap: 300,
    });
  });

  /** API datasets have no tab, so the count is the only thing keeping them visible. */
  it('reports how many API datasets are bound', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { dataset_apis: [{ id: 'a' }, { id: 'b' }] }));

    const result = await fetchTarsKnowledgeBaseDatasets('user-1', 'kb-1', BASE_URL);

    expect(result.stats.api_count).toBe(2);
  });
});

describe('fetchTarsDatabaseTables', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the stored credentials server-side and never returns them', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        buildResponse(200, {
          all_dataset_sqls: [
            {
              id: 'db-1',
              name: 'warehouse',
              host: 'db.internal',
              port: 5432,
              username: 'svc_hr',
              password: 'hunter2',
              database_name: 'hr',
              db_type: 'POSTGRESQL',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        buildResponse(200, { data: { tables: ['employee'], views: ['v_headcount'] } }),
      );

    const result = await fetchTarsDatabaseTables('user-1', 'kb-1', 'db-1', BASE_URL);

    expect(bodyOf(fetchMock, 1)).toMatchObject({ username: 'svc_hr', password: 'hunter2' });
    expect(result).toEqual({ tables: ['employee'], views: ['v_headcount'] });
  });

  it('refuses to guess when the connection is not one the caller may use', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { all_dataset_sqls: [] }));

    await expect(fetchTarsDatabaseTables('user-1', 'kb-1', 'db-9', BASE_URL)).rejects.toThrow(
      'db-9',
    );
  });
});

describe('fetchTarsFileSystemSources', () => {
  afterEach(() => jest.restoreAllMocks());

  it('strips the file-server password', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        dataset_file_systems: [
          {
            id: 'fs-1',
            name: 'reports',
            mount_type: 'SFTP',
            host: 'files.internal',
            account: 'svc',
            password: 'sftp-secret',
          },
        ],
      }),
    );

    const sources = await fetchTarsFileSystemSources('user-1', 'kb-1', BASE_URL);

    expect(JSON.stringify(sources)).not.toContain('sftp-secret');
    expect(sources[0]).not.toHaveProperty('account');
    expect(sources[0].mount_type).toBe('SFTP');
  });
});

describe('importTarsWebsiteDataset', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps the enabled flag onto the numeric status pwc_tars stores', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { dataset_websites: { id: 'w-1', name: 'Docs' } }));

    await importTarsWebsiteDataset(
      'user-1',
      { knowledgeBaseId: 'kb-1', name: 'Docs', url: 'https://x.test', enabled: false },
      BASE_URL,
    );

    expect(bodyOf(fetchMock).status).toBe(0);
  });

  /** Omitting it lets pwc_tars apply its own WEBSITE_MAX_TOKENS default. */
  it('leaves chunk_size out when the caller did not choose one', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { dataset_websites: { id: 'w-1' } }));

    await importTarsWebsiteDataset(
      'user-1',
      { knowledgeBaseId: 'kb-1', name: 'Docs', url: 'https://x.test' },
      BASE_URL,
    );

    expect(bodyOf(fetchMock)).not.toHaveProperty('chunk_size');
  });
});

describe('batchDeleteTarsDatasets', () => {
  afterEach(() => jest.restoreAllMocks());

  /** pwc_tars rejects the call outright unless every list is present. */
  it('always sends all four id lists', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(202, { message: 'started' }));

    await batchDeleteTarsDatasets('user-1', 'kb-1', { documentIds: ['d-1'] }, BASE_URL);

    expect(bodyOf(fetchMock)).toEqual({
      user_id: 'user-1',
      knowledge_base_id: 'kb-1',
      document_ids: ['d-1'],
      dataset_website_ids: [],
      dataset_sql_ids: [],
      dataset_api_ids: [],
    });
  });
});

describe('unbindTarsDatabase', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts the ids pwc_tars needs to find the association', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'ok' }));

    await unbindTarsDatabase('user-1', 'kb-1', 'db-1', BASE_URL);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/knowledge_detail/disconnect_sql_km');
    expect(bodyOf(fetchMock)).toEqual({
      user_id: 'user-1',
      knowledge_base_id: 'kb-1',
      dataset_sql_id: 'db-1',
    });
  });
});

describe('fetchTarsWebsiteChunks', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks pwc_tars for one website by id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        website: { id: 'w-1', name: 'Docs' },
        chunks: [{ id: 'c-1', website_id: 'w-1', position: 0, content: 'hello' }],
        totalChunks: 1,
      }),
    );

    const page = await fetchTarsWebsiteChunks('user-1', 'w-1', BASE_URL);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/knowledge_detail/get_website_chunk');
    expect(url.searchParams.get('website_id')).toBe('w-1');
    expect(page.chunks).toHaveLength(1);
  });

  /** pwc_tars omits the count on some paths; the list length is the fallback. */
  it('derives the total from the chunks when pwc_tars omits it', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { chunks: [{ id: 'c-1' }, { id: 'c-2' }] }));

    const page = await fetchTarsWebsiteChunks('user-1', 'w-1', BASE_URL);

    expect(page.totalChunks).toBe(2);
    expect(page.website).toBeNull();
  });
});
