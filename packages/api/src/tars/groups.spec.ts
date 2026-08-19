jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  createTarsUserGroup,
  updateTarsUserGroup,
  deleteTarsUserGroup,
  assignTarsUsersToGroup,
  removeTarsUserFromGroup,
  fetchTarsGroupPrepareData,
} from './groups';
import type { TarsUserGroupWithMembers } from './groups';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const group: TarsUserGroupWithMembers = {
  id: 'g1',
  name: 'Finance',
  description: 'Finance team',
  role_id: '1,2',
  status: 1,
  user_count: 2,
  user_list: [
    { id: 'u1', username: 'alice', email: 'alice@example.com', status: 'active' },
    { id: 'u2', username: 'bob', email: 'bob@example.com', status: 'inactive' },
  ],
};

const parseBody = (fetchMock: jest.SpyInstance, call = 0): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

describe('fetchTarsGroupPrepareData', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('unwraps the pwc_tars success envelope into roles and groups', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: { roles: [{ id: 1, name: 'Admin' }], user_groups: [group] },
      }),
    );

    await expect(fetchTarsGroupPrepareData(BASE_URL)).resolves.toEqual({
      roles: [{ id: 1, name: 'Admin' }],
      groups: [group],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/user_settings/user_group_prepare_data`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('defaults to empty lists when the envelope carries no data', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true }));
    await expect(fetchTarsGroupPrepareData(BASE_URL)).resolves.toEqual({ roles: [], groups: [] });
  });
});

describe('group mutations', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps the input onto the pwc_tars field names and stamps the operator', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: group }));

    await createTarsUserGroup(
      'admin',
      { name: 'Finance', description: 'Finance team', roleIds: '1,2', status: 1 },
      BASE_URL,
    );
    expect(parseBody(fetchMock, 0)).toEqual({
      user_id: 'admin',
      group_name: 'Finance',
      group_description: 'Finance team',
      role_id: '1,2',
      status: 1,
    });

    await updateTarsUserGroup('admin', 'g1', { name: 'Finance', status: 0 }, BASE_URL);
    expect(parseBody(fetchMock, 1)).toEqual({
      user_id: 'admin',
      group_id: 'g1',
      group_name: 'Finance',
      group_description: '',
      role_id: null,
      status: 0,
    });
  });

  it('passes the operator as a query param when deleting', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await deleteTarsUserGroup('admin', 'g1', BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/user_settings/delete_user_group/g1?user_id=admin`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('group membership', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the member ids for an assignment and one id for a removal', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: 'ok' }));

    await assignTarsUsersToGroup('admin', 'g1', ['u1', 'u2'], BASE_URL);
    expect(parseBody(fetchMock, 0)).toEqual({
      users_id: ['u1', 'u2'],
      group_id: 'g1',
      operator_id: 'admin',
    });

    await removeTarsUserFromGroup('admin', 'g1', 'u1', BASE_URL);
    expect(parseBody(fetchMock, 1)).toEqual({
      user_id: 'u1',
      group_id: 'g1',
      operator_id: 'admin',
    });
  });
});
