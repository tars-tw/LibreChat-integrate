jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import {
  adminGetTarsMcpPermissions,
  adminSaveTarsMcpPermissions,
  adminDeleteTarsMcpPermissions,
  adminGetTarsMcpServerPermissions,
  adminSaveTarsMcpServerPermissions,
  adminListTarsMcpPermissionPrincipals,
} from './admin';
import { TarsRequestError } from '~/tars/client';

const BASE_URL = 'http://tars.test';
const SECRET = 'pwc-tars-test-secret';
const ADMIN = 'tars-admin-1';
const ENV_KEYS = ['TARS_AUTH_URL', 'TARS_JWT_SECRET'] as const;

const envelope = (data: unknown) => ({ success: true, message: '成功', data });

const jsonResponse = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

const requestOf = (fetchMock: jest.SpyInstance, call = 0) => {
  const [input, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  const url = new URL(String(input));
  const headers = init.headers as Record<string, string>;
  return {
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    method: init.method ?? 'GET',
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    actingUser: (
      jwt.verify(headers.Authorization.slice('Bearer '.length), SECRET, {
        algorithms: ['HS256'],
      }) as JwtPayload
    ).user_id,
  };
};

describe('pwc_tars MCP permission admin proxy', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
    process.env.TARS_AUTH_URL = BASE_URL;
    process.env.TARS_JWT_SECRET = SECRET;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('lists principals as the acting admin (reads are admin-only on pwc_tars too)', async () => {
    const principals = [
      {
        principal_type: 'group',
        principal_id: 'g1',
        name: 'BOSS專用',
        email: null,
        is_active: true,
        mcp_server_ids: ['s1'],
        server_count: 1,
      },
    ];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope(principals)));

    await expect(adminListTarsMcpPermissionPrincipals(ADMIN)).resolves.toEqual(principals);
    expect(requestOf(fetchMock)).toMatchObject({
      path: '/api/mcp/permission/principals',
      method: 'GET',
      actingUser: ADMIN,
    });
  });

  it('forwards only string principal ids from an Express query', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope([])));
    const expressQuery = { user_group_id: 'g1', user_id: ['u1', 'u2'] } as unknown as {
      user_group_id: string;
    };

    await expect(adminGetTarsMcpPermissions(expressQuery, ADMIN)).resolves.toEqual([]);
    expect(requestOf(fetchMock)).toMatchObject({
      path: '/api/mcp/permission',
      query: { user_group_id: 'g1' },
      actingUser: ADMIN,
    });
  });

  it('saves exactly the payload fields pwc_tars expects', async () => {
    const result = { user_ids: ['u1'], user_group_ids: ['g1'], server_count: 1 };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope(result)));
    const payload = {
      user_ids: ['u1'],
      user_group_ids: ['g1'],
      servers: [{ mcp_server_id: 's1', mcp_tool_ids: [] }],
      extra: 'dropped',
    };

    await expect(adminSaveTarsMcpPermissions(payload, ADMIN)).resolves.toEqual(result);
    expect(requestOf(fetchMock)).toEqual({
      path: '/api/mcp/permission/save',
      query: {},
      method: 'POST',
      body: {
        user_ids: ['u1'],
        user_group_ids: ['g1'],
        servers: [{ mcp_server_id: 's1', mcp_tool_ids: [] }],
      },
      actingUser: ADMIN,
    });
  });

  it('relays pwc_tars validation errors with their status and message', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(400, { success: false, message: '已停用的群組不可編輯：TARS_AIS' }),
      );

    const call = adminSaveTarsMcpPermissions(
      { user_ids: [], user_group_ids: ['g2'], servers: [] },
      ADMIN,
    );
    await expect(call).rejects.toBeInstanceOf(TarsRequestError);
    await expect(call).rejects.toMatchObject({
      status: 400,
      serverMessage: '已停用的群組不可編輯：TARS_AIS',
    });
  });

  it('deletes one principal and reports the removed row count', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, envelope({ deleted: 3 })));

    await expect(adminDeleteTarsMcpPermissions({ user_id: 'u1' }, ADMIN)).resolves.toBe(3);
    expect(requestOf(fetchMock)).toMatchObject({
      path: '/api/mcp/permission',
      query: { user_id: 'u1' },
      method: 'DELETE',
      actingUser: ADMIN,
    });
  });

  describe('server-centric assignment', () => {
    it("reads one server's assignees as the acting admin", async () => {
      const assignees = [
        {
          principal_type: 'user',
          principal_id: 'u1',
          name: 'Amy',
          email: 'amy@x',
          is_active: true,
          mcp_tool_ids: ['t1'],
          is_enabled: true,
        },
      ];
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(200, envelope(assignees)));

      await expect(
        adminGetTarsMcpServerPermissions({ mcp_server_id: 's1' }, ADMIN),
      ).resolves.toEqual(assignees);
      expect(requestOf(fetchMock)).toEqual({
        path: '/api/mcp/permission/server',
        query: { mcp_server_id: 's1' },
        method: 'GET',
        body: undefined,
        actingUser: ADMIN,
      });
    });

    it.each([
      ['an array', ['s1', 's2']],
      ['an empty string', ''],
      ['nothing', undefined],
    ])('forwards no server id when the Express query holds %s', async (_label, value) => {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(200, envelope(null)));

      await expect(
        adminGetTarsMcpServerPermissions({ mcp_server_id: value }, ADMIN),
      ).resolves.toEqual([]);
      expect(requestOf(fetchMock).query).toEqual({});
    });

    it('saves exactly the server id and principals pwc_tars expects', async () => {
      const result = { mcp_server_id: 's1', user_count: 1, group_count: 1 };
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(200, envelope(result)));
      const principals = [
        { principal_type: 'user' as const, principal_id: 'u1', mcp_tool_ids: ['t1'] },
        { principal_type: 'group' as const, principal_id: 'g1', mcp_tool_ids: [] },
      ];
      const payload = { mcp_server_id: 's1', principals, user_ids: ['u9'] };

      await expect(adminSaveTarsMcpServerPermissions(payload, ADMIN)).resolves.toEqual(result);
      expect(requestOf(fetchMock)).toEqual({
        path: '/api/mcp/permission/server/save',
        query: {},
        method: 'POST',
        body: { mcp_server_id: 's1', principals },
        actingUser: ADMIN,
      });
    });

    it('relays a refused disabled principal with its status and message', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          jsonResponse(400, { success: false, message: '已停用的對象不可新增：TARS_AIS' }),
        );

      const call = adminSaveTarsMcpServerPermissions(
        {
          mcp_server_id: 's1',
          principals: [{ principal_type: 'group', principal_id: 'g2', mcp_tool_ids: [] }],
        },
        ADMIN,
      );
      await expect(call).rejects.toBeInstanceOf(TarsRequestError);
      await expect(call).rejects.toMatchObject({
        status: 400,
        serverMessage: '已停用的對象不可新增：TARS_AIS',
      });
    });
  });
});
