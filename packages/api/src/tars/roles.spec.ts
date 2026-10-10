jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  createTarsRole,
  deleteTarsRole,
  updateTarsRole,
  recordTarsRoleExport,
  fetchTarsRolePrepareData,
} from './roles';
import { TarsGuardError } from './client';
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
    const editor = { ...role, id: 5, name: 'Editor' };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        sys_roles: [role, editor],
        sys_domains: [{ id: 1, name: 'Finance' }],
        sys_menus: [{ id: 10, title: 'legacy' }],
      }),
    );

    await expect(fetchTarsRolePrepareData(BASE_URL)).resolves.toEqual({
      roles: [
        { ...role, is_admin_role: true },
        { ...editor, is_admin_role: false },
      ],
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
      is_enabled: 1,
      is_default_role: true,
      created_by: 'admin',
    });
  });

  it('converts isEnabled: false to is_enabled: 0', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { role }));

    await createTarsRole(
      'admin',
      {
        name: 'Admin',
        isEnabled: false,
      },
      BASE_URL,
    );

    expect(parseBody(fetchMock, 0)).toMatchObject({
      is_enabled: 0,
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

    await deleteTarsRole('admin', 5, BASE_URL);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/role_settings/delete_role/5?operator_id=admin`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('refuses an admin role without calling pwc_tars', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(deleteTarsRole('admin', 1, BASE_URL)).rejects.toBeInstanceOf(TarsGuardError);
    await expect(deleteTarsRole('admin', '1', BASE_URL)).rejects.toThrow('不可刪除管理員權限');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('recordTarsRoleExport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes an EXPORT row under the role module, stamped with the operator', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true }));

    await recordTarsRoleExport('admin', 4, 'http://localhost/admin/permissions', BASE_URL);

    expect(parseBody(fetchMock)).toEqual({
      action_type: 'EXPORT',
      module: 'role-settings',
      target_type: 'csv',
      target_name: '權限清單',
      description: '匯出 4 筆權限資料',
      page_url: 'http://localhost/admin/permissions',
      user_id: 'admin',
    });
  });
});
