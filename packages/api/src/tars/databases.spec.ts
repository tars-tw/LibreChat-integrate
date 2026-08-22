jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsDatabases,
  createTarsDatabase,
  updateTarsDatabase,
  deleteTarsDatabase,
  testTarsDatabaseConnection,
} from './databases';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const bodyOf = (fetchMock: jest.SpyInstance, call = 0): Record<string, unknown> =>
  JSON.parse(String(fetchMock.mock.calls[call][1]?.body));

const urlOf = (fetchMock: jest.SpyInstance, call = 0): string =>
  String(fetchMock.mock.calls[call][0]);

const storedRow = {
  id: 'db-1',
  name: 'warehouse',
  db_type: 'PostgreSQL',
  host: 'db.internal',
  port: 5432,
  database_name: 'hr',
  username: 'svc_hr',
  password: 'hunter2',
  connection_string: 'postgresql://svc_hr:hunter2@db.internal/hr',
  allowed_km_ids: ['kb-1'],
};

const connectionInput = {
  name: 'warehouse',
  dbType: 'PostgreSQL' as const,
  host: 'db.internal',
  port: 5432,
  databaseName: 'hr',
  allowedKmIds: ['kb-1', 'kb-2'],
};

afterEach(() => jest.restoreAllMocks());

describe('fetchTarsDatabases', () => {
  it('never lets a credential reach the caller', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { dataset_sqls: [storedRow] }));

    const databases = await fetchTarsDatabases(BASE_URL);

    const serialised = JSON.stringify(databases);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('svc_hr');
    expect(databases[0].host).toBe('db.internal');
    expect(databases[0].allowed_km_ids).toEqual(['kb-1']);
  });
});

describe('createTarsDatabase', () => {
  it('sends the operator as created_by and the grants as a list', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(201, { dataset: storedRow }));

    await createTarsDatabase(
      'user-1',
      { ...connectionInput, username: 'svc_hr', password: 'hunter2', enabled: false },
      BASE_URL,
    );

    const body = bodyOf(fetchMock);
    expect(body.created_by).toBe('user-1');
    expect(body.username).toBe('svc_hr');
    expect(body.password).toBe('hunter2');
    expect(body.status).toBe(0);
    expect(body.allowed_km_ids).toEqual(['kb-1', 'kb-2']);
  });
});

describe('updateTarsDatabase', () => {
  it('reuses the stored credentials when the form left them blank', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, { dataset_sqls: [storedRow] }))
      .mockResolvedValueOnce(buildResponse(200, { dataset: storedRow }));

    await updateTarsDatabase('user-1', 'db-1', connectionInput, BASE_URL);

    const body = bodyOf(fetchMock, 1);
    expect(body.username).toBe('svc_hr');
    expect(body.password).toBe('hunter2');
    expect(body.updated_by).toBe('user-1');
    /** pwc_tars overwrites every column it reads, so the grants must ride along. */
    expect(body.allowed_km_ids).toEqual(['kb-1', 'kb-2']);
  });

  it('takes a new password over the stored one', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, { dataset_sqls: [storedRow] }))
      .mockResolvedValueOnce(buildResponse(200, { dataset: storedRow }));

    await updateTarsDatabase(
      'user-1',
      'db-1',
      { ...connectionInput, password: 'rotated' },
      BASE_URL,
    );

    expect(bodyOf(fetchMock, 1).password).toBe('rotated');
  });

  it('keeps a SQLite row pointed at its uploaded file', async () => {
    const sqliteRow = {
      ...storedRow,
      db_type: 'SQLite',
      host: '',
      port: 1,
      database_name: 'hr.sqlite',
      username: '',
      password: '',
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, { dataset_sqls: [sqliteRow] }))
      .mockResolvedValueOnce(buildResponse(200, { dataset: sqliteRow }));

    await updateTarsDatabase(
      'user-1',
      'db-1',
      { name: 'renamed', dbType: 'SQLite', allowedKmIds: [] },
      BASE_URL,
    );

    const body = bodyOf(fetchMock, 1);
    expect(body.name).toBe('renamed');
    expect(body.database_name).toBe('hr.sqlite');
    expect(body.db_type).toBe('SQLite');
    expect(body.port).toBe(1);
  });
});

describe('testTarsDatabaseConnection', () => {
  it('sends Oracle the service name pwc_tars asks for', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { data: { tables: ['EMP'], views: [] } }));

    const result = await testTarsDatabaseConnection(
      {
        name: 'erp',
        dbType: 'Oracle',
        host: 'ora.internal',
        port: 1521,
        databaseName: 'XEPDB1',
        username: 'app',
        password: 'secret',
      },
      BASE_URL,
    );

    const body = bodyOf(fetchMock);
    expect(body.service_name).toBe('XEPDB1');
    expect(body.database_name).toBe('XEPDB1');
    expect(result.tables).toEqual(['EMP']);
  });

  it('fetches the stored credentials when testing an existing row', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, { dataset_sqls: [storedRow] }))
      .mockResolvedValueOnce(buildResponse(200, { data: { tables: [], views: [] } }));

    await testTarsDatabaseConnection({ ...connectionInput, databaseId: 'db-1' }, BASE_URL);

    const body = bodyOf(fetchMock, 1);
    expect(body.username).toBe('svc_hr');
    expect(body.password).toBe('hunter2');
  });
});

describe('deleteTarsDatabase', () => {
  it('identifies the operator for the pwc_tars audit log', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'deleted' }));

    await deleteTarsDatabase('user-1', 'db-1', BASE_URL);

    expect(urlOf(fetchMock)).toContain('/api/dataset_sql/delete_dataset/db-1?operator_id=user-1');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
