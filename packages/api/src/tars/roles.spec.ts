jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { createTarsRole, deleteTarsRole, fetchTarsRolePrepareData, updateTarsRole } from './roles';
import type { TarsRoleDetail } from './roles';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const role: TarsRoleDetail = {
  id: 1,
  name: 'Admin',
  description: 'Full access',
  domain_ids: '1,2',
  menu_ids: '10,11',
  librechat_menu_keys: 'admin.users,admin.groups',
  status: 1,
  is_default_role: false,
};

const parseBody = (fetchMock: jest.SpyInstance, call = 0): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

describe('fetchTarsRolePrepareData', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns roles and domains, ignoring the legacy pwc_tars menu tree', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        sys_roles: [role],
        sys_domains: [{ id: 1, name: 'Finance' }],
        sys_menus: [{ id: 10, title: 'legacy' }],
      }),
    );

    await expect(fetchTarsRolePrepareData(BASE_URL)).resolves.toEqual({
      roles: [role],
      domains: [{ id: 1, name: 'Finance' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/role_settings/prepare_data`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('defaults to empty lists when the response is bare', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await expect(fetchTarsRolePrepareData(BASE_URL)).resolves.toEqual({ roles: [], domains: [] });
  });
});

describe('role mutations', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps the input onto pwc_tars field names and stamps the operator', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { role }));

    await createTarsRole(
      'admin',
      {
        name: 'Admin',
        description: 'Full access',
        domainIds: '1,2',
        librechatMenuKeys: 'admin.users',
        isEnabled: true,
        isDefaultRole: true,
      },
      BASE_URL,
    );

    expect(parseBody(fetchMock, 0)).toEqual({
      name: 'Admin',
      description: 'Full access',
      domain_ids: '1,2',
      librechat_menu_keys: 'admin.users',
      is_enabled: true,
      is_default_role: true,
      created_by: 'admin',
    });
  });

  /** pwc_tars skips absent keys, so clearing the selection must send '' explicitly. */
  it('sends an empty menu key string rather than omitting the field', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { role }));

    await updateTarsRole('admin', 1, { name: 'Admin' }, BASE_URL);

    expect(parseBody(fetchMock, 0)).toMatchObject({
      librechat_menu_keys: '',
      domain_ids: '',
      updated_by: 'admin',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/role_settings/update_role/1`,
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('passes the operator as a query param when deleting', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'ok' }));

    await deleteTarsRole('admin', 1, BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/role_settings/delete_role/1?operator_id=admin`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
