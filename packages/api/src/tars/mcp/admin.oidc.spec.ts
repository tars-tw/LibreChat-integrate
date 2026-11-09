jest.mock('@librechat/data-schemas', () => {
  process.env.CREDS_KEY = process.env.CREDS_KEY || 'a'.repeat(64);
  return jest.requireActual('@librechat/data-schemas');
});

import http from 'http';
import { decryptV3, encryptV3 } from '@librechat/data-schemas';
import type { AddressInfo } from 'net';
import {
  adminGetTarsMcpServer,
  adminListTarsMcpServers,
  adminTestTarsMcpServer,
  adminSyncTarsMcpServer,
  adminCreateTarsMcpServer,
  adminUpdateTarsMcpServer,
  adminListTarsDirectTools,
  adminSetTarsDirectEnabledTools,
} from './admin';
import { sealTarsOidcInput } from './oidc';

const BASE_URL = 'http://tars.test';
const ADMIN = 'tars-admin-1';
const SECRET = 'plain-client-secret';
const ENV_KEYS = ['TARS_AUTH_URL', 'TARS_JWT_SECRET'] as const;

interface PwcCall {
  path: string;
  method: string;
  body?: { connection_config: { auth: Record<string, unknown> } };
}

/** pwc_tars is the only thing faked: discovery runs against a real local provider. */
function stubPwcTars(reply: (call: PwcCall) => unknown): PwcCall[] {
  const calls: PwcCall[] = [];
  const realFetch = global.fetch;
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith(BASE_URL)) {
      return realFetch(input, init);
    }
    const call: PwcCall = {
      path: new URL(url).pathname,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return new Response(JSON.stringify({ success: true, message: '成功', data: reply(call) }), {
      status: 200,
    });
  });
  return calls;
}

describe('pwc_tars MCP admin proxy with OIDC servers', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let provider: http.Server;
  let issuer: string;
  let policy: { allowedAddresses: string[] };

  const oidcInput = (auth: Record<string, unknown> = {}) => ({
    name: 'Issues',
    type: 'external' as const,
    connection_config: {
      transport: 'streamable_http',
      url: 'https://mcp.example.com/mcp',
      auth: { type: 'oidc', issuer, client_id: 'librechat', ...auth },
    },
  });

  const storedRow = async () => ({
    id: 's1',
    ...(await sealTarsOidcInput(oidcInput({ client_secret: SECRET }), { policy })),
  });

  const bearerRow = {
    id: 's2',
    name: 'Plain',
    type: 'external',
    connection_config: { transport: 'streamable_http', url: 'https://mcp.example.com/plain' },
  };

  const authOf = (server?: { connection_config?: Record<string, unknown> | null } | null) =>
    server?.connection_config?.auth as Record<string, unknown>;

  beforeAll(async () => {
    provider = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const { port } = provider.address() as AddressInfo;
    issuer = `http://127.0.0.1:${port}`;
    policy = { allowedAddresses: [`127.0.0.1:${port}`] };
  });

  afterAll(async () => {
    await new Promise((resolve) => provider.close(resolve));
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
    process.env.TARS_AUTH_URL = BASE_URL;
    process.env.TARS_JWT_SECRET = 'pwc-tars-test-secret';
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

  describe('create', () => {
    it('sends pwc_tars only the sealed secret and redacts its reply', async () => {
      const calls = stubPwcTars(({ body }) => ({ id: 's1', ...body }));
      const server = await adminCreateTarsMcpServer(
        oidcInput({ client_secret: SECRET, token_url: 'https://evil.example.com/token' }),
        ADMIN,
        policy,
      );

      expect(calls).toHaveLength(1);
      expect(JSON.stringify(calls[0].body)).not.toContain(SECRET);
      const sent = calls[0].body?.connection_config.auth as Record<string, string>;
      expect(decryptV3(sent.client_secret_enc)).toBe(SECRET);
      expect(sent.token_url).toBe(`${issuer}/token`);

      expect(authOf(server)).not.toHaveProperty('client_secret_enc');
      expect(authOf(server).has_client_secret).toBe(true);
    });

    it('sends nothing when the provider is refused', async () => {
      const calls = stubPwcTars(() => ({}));
      await expect(
        adminCreateTarsMcpServer(oidcInput({ client_secret: SECRET }), ADMIN, {
          allowedAddresses: [],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(calls).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('keeps the stored secret when left blank and redacts the reply', async () => {
      const stored = await storedRow();
      const calls = stubPwcTars(({ method, body }) =>
        method === 'GET' ? stored : { id: 's1', ...body },
      );
      const server = await adminUpdateTarsMcpServer('s1', oidcInput(), ADMIN, policy);

      expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT']);
      const sent = calls[1].body?.connection_config.auth as Record<string, string>;
      expect(decryptV3(sent.client_secret_enc)).toBe(SECRET);
      expect(authOf(server)).not.toHaveProperty('client_secret_enc');
    });

    it('sends nothing when the issuer moves without a new secret', async () => {
      const stored = {
        id: 's1',
        type: 'external',
        connection_config: {
          auth: {
            type: 'oidc',
            issuer: 'https://old.example.com',
            client_secret_enc: encryptV3(SECRET),
          },
        },
      };
      const calls = stubPwcTars(() => stored);
      await expect(
        adminUpdateTarsMcpServer('s1', oidcInput(), ADMIN, policy),
      ).rejects.toMatchObject({ status: 400 });
      expect(calls.map((call) => call.method)).toEqual(['GET']);
    });

    it('does not read the stored row for a non-OIDC update', async () => {
      const calls = stubPwcTars(() => bearerRow);
      const input = { is_enabled: false };
      await adminUpdateTarsMcpServer('s2', input, ADMIN, policy);
      expect(calls).toEqual([{ path: '/api/mcp/servers/s2', method: 'PUT', body: input }]);
    });
  });

  describe('read', () => {
    it('never returns the ciphertext from a listing or a single read', async () => {
      const stored = await storedRow();
      stubPwcTars(({ path }) => (path.endsWith('/servers') ? [stored, bearerRow] : stored));

      const [listed, plain] = await adminListTarsMcpServers();
      expect(authOf(listed)).not.toHaveProperty('client_secret_enc');
      expect(authOf(listed).has_client_secret).toBe(true);
      expect(plain).toEqual(bearerRow);

      const single = await adminGetTarsMcpServer('s1');
      expect(authOf(single)).not.toHaveProperty('client_secret_enc');
      expect(authOf(single).has_client_secret).toBe(true);
    });
  });

  describe('test', () => {
    it('re-runs discovery locally instead of asking pwc_tars to connect', async () => {
      const stored = await storedRow();
      const calls = stubPwcTars(() => stored);
      const result = await adminTestTarsMcpServer('s1', ADMIN, policy);
      expect(result).toMatchObject({ connected: true, requires_user_login: true });
      expect(calls.map((call) => call.method)).toEqual(['GET']);
    });

    it('still asks pwc_tars for other servers', async () => {
      const calls = stubPwcTars(({ method }) => (method === 'GET' ? bearerRow : { ok: true }));
      await expect(adminTestTarsMcpServer('s2', ADMIN, policy)).resolves.toEqual({ ok: true });
      expect(calls[1]).toMatchObject({ path: '/api/mcp/servers/s2/test', method: 'POST' });
    });
  });

  describe('server-wide tool switches', () => {
    const row = async (toolConfig?: Record<string, unknown>) => ({
      ...(await storedRow()),
      code: 'issues',
      tool_config: toolConfig,
    });
    const catalog = (tools: Record<string, unknown>) =>
      jest.fn().mockResolvedValue(new Map([['tars_issues', tools]]));

    it("lists the admin's catalog with every tool off by default", async () => {
      const stored = await row({ enabled_tools: ['whoami'] });
      stubPwcTars(() => stored);
      const load = catalog({
        whoami_mcp_tars_issues: { function: { description: 'Who' } },
        health_mcp_tars_issues: { function: {} },
      });

      await expect(adminListTarsDirectTools('s1', load)).resolves.toEqual({
        tools: [
          { name: 'whoami', description: 'Who', is_enabled: true },
          { name: 'health', description: null, is_enabled: false },
        ],
        tools_status: 'ok',
      });
    });

    it('keeps listing an opened tool the connection cannot show', async () => {
      const stored = await row({ enabled_tools: ['whoami'] });
      stubPwcTars(() => stored);

      await expect(
        adminListTarsDirectTools('s1', jest.fn().mockRejectedValue(new Error('not signed in'))),
      ).resolves.toEqual({
        tools: [{ name: 'whoami', is_enabled: true }],
        tools_status: 'error',
      });
    });

    it('gives up on a catalog that does not answer, within the limit', async () => {
      const stored = await row();
      stubPwcTars(() => stored);

      await expect(
        adminListTarsDirectTools('s1', () => new Promise(() => undefined), 20),
      ).resolves.toEqual({ tools: [], tools_status: 'timeout' });
    });

    it('reports a connection that lists nothing', async () => {
      const stored = await row();
      stubPwcTars(() => stored);

      await expect(adminListTarsDirectTools('s1', catalog({}))).resolves.toEqual({
        tools: [],
        tools_status: 'not_connected',
      });
    });

    it('saves the list without losing the rest of tool_config', async () => {
      const stored = await row({ naming: 'keep', enabled_tools: ['old'] });
      const calls = stubPwcTars(() => stored);

      await expect(
        adminSetTarsDirectEnabledTools('s1', ['whoami', 'whoami'], ADMIN),
      ).resolves.toEqual(['whoami']);
      expect(calls[1]).toMatchObject({
        path: '/api/mcp/servers/s1',
        method: 'PUT',
        body: { tool_config: { naming: 'keep', enabled_tools: ['whoami'] } },
      });
    });

    it.each([['whoami'], [[1]], [['']], [undefined]])('refuses %j as the list', async (value) => {
      const calls = stubPwcTars(() => ({}));

      await expect(adminSetTarsDirectEnabledTools('s1', value, ADMIN)).rejects.toThrow(
        'enabled_tools',
      );
      expect(calls).toEqual([]);
    });

    it('refuses a server that is not OIDC, whose tools have their own rows', async () => {
      const calls = stubPwcTars(() => bearerRow);

      await expect(adminSetTarsDirectEnabledTools('s2', ['x'], ADMIN)).rejects.toThrow('OIDC');
      await expect(adminListTarsDirectTools('s2', jest.fn())).rejects.toThrow('OIDC');
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  });

  describe('sync', () => {
    it('does nothing for an OIDC server, whose tools pwc_tars cannot list', async () => {
      const stored = await storedRow();
      const calls = stubPwcTars(() => stored);
      await expect(adminSyncTarsMcpServer('s1', ADMIN)).resolves.toEqual({
        synced_count: 0,
        created_count: 0,
        updated_count: 0,
        deleted_count: 0,
      });
      expect(calls.map((call) => call.method)).toEqual(['GET']);
    });

    it('still asks pwc_tars for other servers', async () => {
      const calls = stubPwcTars(({ method }) =>
        method === 'GET' ? bearerRow : { synced_count: 3 },
      );
      await expect(adminSyncTarsMcpServer('s2', ADMIN)).resolves.toEqual({ synced_count: 3 });
      expect(calls[1]).toMatchObject({ path: '/api/mcp/servers/s2/sync', method: 'POST' });
    });
  });
});
