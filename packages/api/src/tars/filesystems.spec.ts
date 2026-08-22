jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsFileSystems,
  createTarsFileSystem,
  updateTarsFileSystem,
  deleteTarsFileSystem,
  testTarsFileSystemConnection,
} from './filesystems';

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
  id: 'fs-1',
  name: 'reports',
  description: 'SMB 文檔群組',
  mount_type: 'SMB',
  host: 'files.internal',
  port: 445,
  path: 'public/reports',
  host_name: 'FILESRV',
  account: 'svc_files',
  password: 'smb-secret',
  status: 1,
  allowed_km_ids: ['kb-1'],
};

const smbInput = {
  name: 'reports',
  protocol: 'SMB' as const,
  host: 'files.internal',
  port: 445,
  path: 'public/reports',
  hostName: 'FILESRV',
  allowedKmIds: ['kb-1', 'kb-2'],
};

afterEach(() => jest.restoreAllMocks());

describe('fetchTarsFileSystems', () => {
  it('never lets a credential reach the caller', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { dataset_file_systems: [storedRow] }));

    const fileSystems = await fetchTarsFileSystems(BASE_URL);

    const serialised = JSON.stringify(fileSystems);
    expect(serialised).not.toContain('smb-secret');
    expect(serialised).not.toContain('svc_files');
    expect(fileSystems[0].host_name).toBe('FILESRV');
    expect(fileSystems[0].allowed_km_ids).toEqual(['kb-1']);
  });
});

describe('createTarsFileSystem', () => {
  it('sends the operator as created_by and defaults the path to the share root', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(201, { dataset_file_system: storedRow }));

    await createTarsFileSystem(
      'user-1',
      { ...smbInput, path: '', account: 'svc_files', password: 'smb-secret' },
      BASE_URL,
    );

    const body = bodyOf(fetchMock);
    expect(body.created_by).toBe('user-1');
    expect(body.mount_type).toBe('SMB');
    expect(body.path).toBe('/');
    expect(body.hostname).toBe('FILESRV');
    expect(body.account).toBe('svc_files');
    expect(body.allowed_km_ids).toEqual(['kb-1', 'kb-2']);
  });

  it('fills in the protocol default port when the form left it blank', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(201, { dataset_file_system: storedRow }));

    await createTarsFileSystem(
      'user-1',
      { name: 'drop', protocol: 'FTP', host: 'ftp.internal' },
      BASE_URL,
    );

    expect(bodyOf(fetchMock).port).toBe(21);
  });
});

describe('updateTarsFileSystem', () => {
  it('leaves the credentials blank so pwc_tars keeps the stored ones', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { dataset_file_system: storedRow }));

    await updateTarsFileSystem('user-1', 'fs-1', smbInput, BASE_URL);

    const body = bodyOf(fetchMock);
    expect(body.account).toBe('');
    expect(body.password).toBe('');
    expect(body.updated_by).toBe('user-1');
    /** A 0 would be dropped by the same merge, so enablement is never sent. */
    expect(body).not.toHaveProperty('status');
  });

  it('clears the SMB server name and credentials when the protocol changes', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { dataset_file_system: storedRow }));

    await updateTarsFileSystem(
      'user-1',
      'fs-1',
      { ...smbInput, protocol: 'NFS', account: 'stale', password: 'stale' },
      BASE_URL,
    );

    const body = bodyOf(fetchMock);
    expect(body.mount_type).toBe('NFS');
    expect(body.hostname).toBe('');
    expect(body.account).toBe('');
  });
});

describe('testTarsFileSystemConnection', () => {
  it('asks pwc_tars to walk the tree, which it skips without is_sync_all', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { files: ['public/reports/q1.pdf'] }));

    const result = await testTarsFileSystemConnection(
      { ...smbInput, account: 'svc_files', password: 'smb-secret' },
      BASE_URL,
    );

    expect(bodyOf(fetchMock).is_sync_all).toBe(true);
    expect(result.files).toEqual(['public/reports/q1.pdf']);
  });

  it('fetches the stored credentials when testing an existing group', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(200, { dataset_file_systems: [storedRow] }))
      .mockResolvedValueOnce(buildResponse(200, { files: [] }));

    await testTarsFileSystemConnection({ ...smbInput, fileSystemId: 'fs-1' }, BASE_URL);

    const body = bodyOf(fetchMock, 1);
    expect(body.account).toBe('svc_files');
    expect(body.password).toBe('smb-secret');
  });

  it('does not look up credentials for a protocol that takes none', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { files: [] }));

    await testTarsFileSystemConnection(
      { name: 'exports', protocol: 'NFS', host: 'nfs.internal', fileSystemId: 'fs-1' },
      BASE_URL,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock).account).toBeNull();
  });
});

describe('deleteTarsFileSystem', () => {
  it('identifies the operator for the pwc_tars audit log', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'deleted' }));

    await deleteTarsFileSystem('user-1', 'fs-1', BASE_URL);

    expect(urlOf(fetchMock)).toContain(
      '/api/dataset_file_system/delete_dataset_file_system/fs-1?operator_id=user-1',
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
