jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  importTarsAdData,
  fetchTarsLdapTree,
  saveTarsSsoConfig,
  fetchTarsSsoConfigs,
  updateTarsSsoConfig,
  deleteTarsSsoConfig,
  saveTarsSyncSchedule,
  testTarsLdapConnection,
} from './sso';
import type { TarsSsoConfig } from './sso';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const config: TarsSsoConfig = {
  id: 'cfg-1',
  sso_type_id: '1',
  sso_type_name: 'LDAP',
  status: 1,
  ldap_name: 'Corp AD',
  ldap_server_address: 'ldap.example.com',
  ldap_server_port: '389',
};

const parseBody = (fetchMock: jest.SpyInstance, call = 0): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

describe('fetchTarsSsoConfigs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('unwraps the envelope and returns every configuration', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: [config] }));
    await expect(fetchTarsSsoConfigs('7', BASE_URL)).resolves.toEqual([config]);
  });

  /** pwc_tars answers with a bare object when only one row matches. */
  it('wraps a single configuration into an array', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: config }));
    await expect(fetchTarsSsoConfigs('7', BASE_URL)).resolves.toEqual([config]);
  });

  it('returns [] when nothing is configured', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: [] }));
    await expect(fetchTarsSsoConfigs('7', BASE_URL)).resolves.toEqual([]);
  });

  /** pwc_tars 500s on a blank `user_id`, so the operator id must reach the query. */
  it('sends the operator id and the LDAP type as query parameters', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: [] }));
    await fetchTarsSsoConfigs('7', BASE_URL);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('user_id=7');
    expect(url).toContain('sso_type_id=1');
  });
});

describe('SSO configuration mutations', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stamps the operator and the LDAP type on a create', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await saveTarsSsoConfig(
      'admin',
      { ldap_server_address: 'ldap.example.com' },
      undefined,
      BASE_URL,
    );

    expect(parseBody(fetchMock)).toMatchObject({
      user_id: 'admin',
      sso_type_id: '1',
      status: 1,
      ldap_server_address: 'ldap.example.com',
    });
    expect(parseBody(fetchMock)).not.toHaveProperty('config_id');
  });

  it('includes config_id when replacing an existing configuration', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await saveTarsSsoConfig('admin', { ldap_name: 'Corp' }, 'cfg-1', BASE_URL);

    expect(parseBody(fetchMock)).toMatchObject({ config_id: 'cfg-1', ldap_name: 'Corp' });
  });

  it('sends the id and operator on a partial update', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await updateTarsSsoConfig('admin', 'cfg-1', { ldap_whitelist_users: 'alice;bob' }, BASE_URL);

    expect(parseBody(fetchMock)).toEqual({
      config_id: 'cfg-1',
      user_id: 'admin',
      ldap_whitelist_users: 'alice;bob',
    });
  });

  it('sends the id in the body when deleting', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await deleteTarsSsoConfig('cfg-1', BASE_URL);

    expect(parseBody(fetchMock)).toEqual({ config_id: 'cfg-1' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });
});

describe('directory operations', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the pwc_tars message from a successful bind test', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: { connection_status: 'success', message: 'LDAP connection successful' },
      }),
    );
    await expect(testTarsLdapConnection({ config_id: 'cfg-1' }, BASE_URL)).resolves.toBe(
      'LDAP connection successful',
    );
  });

  /** The tree arrives either bare or wrapped in a `tree` key. */
  it('accepts both tree response shapes', async () => {
    const nodes = [{ key: 'ou=people', label: 'people' }];

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: nodes }));
    await expect(fetchTarsLdapTree({ config_id: 'cfg-1' }, BASE_URL)).resolves.toEqual(nodes);

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { tree: nodes } }));
    await expect(fetchTarsLdapTree({ config_id: 'cfg-1' }, BASE_URL)).resolves.toEqual(nodes);
  });

  it('forwards the enable-users flag on an AD import', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { message: 'synced 3' } }));

    await expect(importTarsAdData('cfg-1', false, BASE_URL)).resolves.toBe('synced 3');
    expect(parseBody(fetchMock)).toEqual({ config_id: 'cfg-1', enable_users: false });
  });
});

describe('saveTarsSyncSchedule', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes the interval and window through untouched', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await saveTarsSyncSchedule(
      'cfg-1',
      { frequency: 6, frequency_unit: 'hour', start_time: '2026-03-01T02:00' },
      BASE_URL,
    );

    expect(parseBody(fetchMock)).toEqual({
      config_id: 'cfg-1',
      frequency: 6,
      frequency_unit: 'hour',
      start_time: '2026-03-01T02:00',
    });
  });
});
