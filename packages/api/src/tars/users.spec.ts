jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsUsers,
  createTarsUser,
  deleteTarsUser,
  bulkUpdateTarsUsers,
  bulkDeleteTarsUsers,
  fetchTarsAdWhitelist,
  fetchTarsUserPrepareData,
} from './users';
import type { TarsAccount } from './users';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const account = (id: string, username: string): TarsAccount => ({
  id,
  username,
  email: `${username}@example.com`,
  role_id: 1,
  user_group_id: 'g1',
  display_name: username,
  status: 'active',
});

const parseBody = (fetchMock: jest.SpyInstance, call = 0): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

describe('fetchTarsUsers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the users array from get_users', async () => {
    const users = [account('u1', 'alice'), account('u2', 'bob')];
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { users }));

    await expect(fetchTarsUsers(BASE_URL)).resolves.toEqual(users);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/user_settings/get_users`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('defaults to [] when the response omits users', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await expect(fetchTarsUsers(BASE_URL)).resolves.toEqual([]);
  });
});

describe('fetchTarsUserPrepareData', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('combines roles, groups and SSO status', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.includes('get_roles')) {
        return Promise.resolve(buildResponse(200, { roles: [{ id: 1, name: 'Admin' }] }));
      }
      if (url.includes('get_user_group_by_filter')) {
        return Promise.resolve(buildResponse(200, { data: [{ id: 'g1', name: 'Finance' }] }));
      }
      return Promise.resolve(buildResponse(200, { enabled: true, type: '1' }));
    });

    await expect(fetchTarsUserPrepareData('u1', BASE_URL)).resolves.toEqual({
      roles: [{ id: 1, name: 'Admin' }],
      userGroups: [{ id: 'g1', name: 'Finance' }],
      sso: { enabled: true, type: '1' },
    });
  });

  it('degrades each source independently when pwc_tars fails', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      if (String(input).includes('get_roles')) {
        return Promise.resolve(buildResponse(200, { roles: [{ id: 1, name: 'Admin' }] }));
      }
      return Promise.resolve(buildResponse(500, {}));
    });

    await expect(fetchTarsUserPrepareData('u1', BASE_URL)).resolves.toEqual({
      roles: [{ id: 1, name: 'Admin' }],
      userGroups: [],
      sso: { enabled: false, type: null },
    });
  });
});

describe('user mutations', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stamps the operator on create, delete and bulk calls', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { user: account('u1', 'alice'), deleted_count: 2 }));

    await createTarsUser('admin', { username: 'alice' }, BASE_URL);
    expect(parseBody(fetchMock, 0)).toMatchObject({ username: 'alice', created_by: 'admin' });

    await deleteTarsUser('admin', 'u1', BASE_URL);
    expect(parseBody(fetchMock, 1)).toEqual({ deleted_by: 'admin' });

    await bulkUpdateTarsUsers('admin', ['u1', 'u2'], { status: 'inactive' }, BASE_URL);
    expect(parseBody(fetchMock, 2)).toEqual({
      ids: ['u1', 'u2'],
      updates: { status: 'inactive' },
      updated_by: 'admin',
    });

    await expect(bulkDeleteTarsUsers('admin', ['u1', 'u2'], BASE_URL)).resolves.toBe(2);
    expect(parseBody(fetchMock, 3)).toEqual({ ids: ['u1', 'u2'], deleted_by: 'admin' });
  });
});

describe('fetchTarsAdWhitelist', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('splits the LDAP whitelist and drops names already provisioned as SSO users', async () => {
    const provisioned: TarsAccount = {
      ...account('u9', 'Bob'),
      is_sso_user: true,
      email: 'Carol@corp.example',
    };
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      if (String(input).includes('get_users')) {
        return Promise.resolve(
          buildResponse(200, { users: [provisioned, account('u1', 'alice')] }),
        );
      }
      return Promise.resolve(
        buildResponse(200, {
          data: [
            { sso_type_id: 2, ldap_whitelist_users: 'ignored' },
            { sso_type_id: '1', ldap_whitelist_users: ' alice; bob ;; carol ; dave ' },
          ],
        }),
      );
    });

    await expect(fetchTarsAdWhitelist('u1', BASE_URL)).resolves.toEqual(['alice', 'dave']);
  });

  it('returns [] when no LDAP config is present', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { data: [] }));
    await expect(fetchTarsAdWhitelist('u1', BASE_URL)).resolves.toEqual([]);
  });
});
