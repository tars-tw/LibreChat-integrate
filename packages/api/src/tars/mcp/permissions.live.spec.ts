/**
 * Live check of the MCP grant views against a REAL pwc_tars at TARS_LIVE_URL, signed as
 * the pwc_tars admin TARS_LIVE_ADMIN_ID (needs TARS_JWT_SECRET). Read-only: the save
 * calls below are all refused by pwc_tars's validation before anything is written.
 * Skipped unless both variables are set. Not part of normal CI.
 */
jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import type { TTarsMcpServerPermission } from 'librechat-data-provider';
import {
  adminGetTarsMcpServer,
  adminListTarsMcpServers,
  adminGetTarsMcpPermissions,
  adminGetTarsMcpServerPermissions,
  adminSaveTarsMcpServerPermissions,
  adminListTarsMcpPermissionPrincipals,
} from './admin';
import { TarsRequestError } from '~/tars/client';

const LIVE_URL = process.env.TARS_LIVE_URL;
const ADMIN = process.env.TARS_LIVE_ADMIN_ID ?? '';
const d = LIVE_URL && ADMIN ? describe : describe.skip;
const MANAGED_TYPES = new Set(['openapi', 'custom_api', 'external']);

beforeAll(() => {
  process.env.TARS_AUTH_URL = LIVE_URL;
});

const keyOf = (principal: { principal_type: string; principal_id: string }) =>
  `${principal.principal_type}:${principal.principal_id}`;

d('live pwc_tars MCP grant views', () => {
  it('shows the same grants from the server side and the principal side', async () => {
    const [servers, principals] = await Promise.all([
      adminListTarsMcpServers(),
      adminListTarsMcpPermissionPrincipals(ADMIN),
    ]);
    const managed = servers.filter((server) => MANAGED_TYPES.has(server.type));
    const byServer = new Map<string, TTarsMcpServerPermission[]>();
    for (const server of managed) {
      byServer.set(
        server.id,
        await adminGetTarsMcpServerPermissions({ mcp_server_id: server.id }, ADMIN),
      );
    }

    for (const server of managed) {
      const fromServer = (byServer.get(server.id) ?? []).map(keyOf).sort();
      const fromPrincipals = principals
        .filter((principal) => principal.mcp_server_ids.includes(server.id))
        .map(keyOf)
        .sort();
      expect({ server: server.name, assignees: fromServer }).toEqual({
        server: server.name,
        assignees: fromPrincipals,
      });
    }

    for (const principal of principals) {
      const rows = await adminGetTarsMcpPermissions(
        principal.principal_type === 'group'
          ? { user_group_id: principal.principal_id }
          : { user_id: principal.principal_id },
        ADMIN,
      );
      expect(rows.map((row) => row.mcp_server_id).sort()).toEqual(
        [...principal.mcp_server_ids].sort(),
      );
      for (const row of rows) {
        const assignee = byServer
          .get(row.mcp_server_id)
          ?.find((entry) => keyOf(entry) === keyOf(principal));
        if (assignee == null) {
          continue;
        }
        expect(assignee.mcp_tool_ids.slice().sort()).toEqual(row.mcp_tool_ids.slice().sort());
        expect(assignee.is_active).toBe(principal.is_active);
      }
    }
    console.log(
      `[live] ${managed.length} servers, ${principals.length} principals agree on both sides`,
    );
  }, 120_000);

  it('only lists tools that still exist on the server', async () => {
    const servers = (await adminListTarsMcpServers()).filter((server) =>
      MANAGED_TYPES.has(server.type),
    );
    for (const server of servers) {
      const assignees = await adminGetTarsMcpServerPermissions({ mcp_server_id: server.id }, ADMIN);
      const partial = assignees.filter((entry) => entry.mcp_tool_ids.length > 0);
      if (partial.length === 0) {
        continue;
      }
      const detail = await adminGetTarsMcpServer(server.id);
      const live = new Set((detail?.tools ?? []).map((tool) => tool.id));
      for (const entry of partial) {
        expect(entry.mcp_tool_ids.filter((id) => !live.has(id))).toEqual([]);
      }
    }
  }, 120_000);

  it('refuses an unknown server', async () => {
    const read = adminGetTarsMcpServerPermissions({ mcp_server_id: 'no-such-server' }, ADMIN);
    await expect(read).rejects.toBeInstanceOf(TarsRequestError);
    await expect(read).rejects.toMatchObject({ status: 400 });

    const save = adminSaveTarsMcpServerPermissions(
      { mcp_server_id: 'no-such-server', principals: [] },
      ADMIN,
    );
    await expect(save).rejects.toMatchObject({ status: 400 });
  });

  it('refuses malformed assignments before writing anything', async () => {
    const [server] = (await adminListTarsMcpServers()).filter((entry) =>
      MANAGED_TYPES.has(entry.type),
    );
    expect(server).toBeDefined();
    const before = await adminGetTarsMcpServerPermissions({ mcp_server_id: server.id }, ADMIN);

    await expect(
      adminSaveTarsMcpServerPermissions(
        {
          mcp_server_id: server.id,
          principals: [
            { principal_type: 'user', principal_id: ADMIN, mcp_tool_ids: ['no-such-tool'] },
          ],
        },
        ADMIN,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      adminSaveTarsMcpServerPermissions(
        {
          mcp_server_id: server.id,
          principals: [
            {
              principal_type: 'role' as 'user',
              principal_id: ADMIN,
              mcp_tool_ids: [],
            },
          ],
        },
        ADMIN,
      ),
    ).rejects.toMatchObject({ status: 400 });

    const after = await adminGetTarsMcpServerPermissions({ mcp_server_id: server.id }, ADMIN);
    expect(after).toEqual(before);
  });
});
