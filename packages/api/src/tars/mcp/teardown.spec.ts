jest.mock('@librechat/data-schemas', () => {
  process.env.CREDS_KEY = process.env.CREDS_KEY || 'a'.repeat(64);
  const actual = jest.requireActual('@librechat/data-schemas');
  return { ...actual, logger: { ...actual.logger, error: jest.fn(), warn: jest.fn() } };
});

import { logger, encryptV3 } from '@librechat/data-schemas';
import type { TarsMcpServerDetail } from './admin';
import type { TarsOidcTeardownDeps } from './teardown';
import {
  movedTarsOidcTargets,
  deletedTarsOidcTargets,
  createTarsOidcTeardown,
  readTarsOidcTeardownTargets,
} from './teardown';
import { clearTarsMcpEntryNames, recordTarsMcpEntryName } from './names';

const oidcServer = (overrides: Partial<TarsMcpServerDetail> = {}): TarsMcpServerDetail => ({
  id: 's1',
  name: 'Demo',
  code: 'demo',
  type: 'external',
  is_enabled: true,
  connection_config: {
    transport: 'streamable_http',
    url: 'https://mcp.example.com/mcp',
    auth: {
      type: 'oidc',
      issuer: 'https://idp.example.com',
      client_id: 'client-1',
      client_secret_enc: encryptV3('secret'),
      scope: 'openid',
      authorization_url: 'https://idp.example.com/authorize',
      token_url: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/jwks',
    },
  },
  ...overrides,
});

const withConnection = (
  connection: Record<string, unknown>,
  auth: Record<string, unknown> = {},
): TarsMcpServerDetail => {
  const server = oidcServer();
  const stored = server.connection_config as Record<string, unknown>;
  return {
    ...server,
    connection_config: {
      ...stored,
      ...connection,
      auth: { ...(stored.auth as Record<string, unknown>), ...auth },
    },
  };
};

const stubServerList = (servers: unknown) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({ success: true, data: servers }),
  } as Response);

describe('pwc_tars OIDC token teardown', () => {
  beforeEach(() => {
    process.env.TARS_AUTH_URL = 'http://tars.test';
    clearTarsMcpEntryNames();
    (logger.error as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TARS_AUTH_URL;
  });

  describe('readTarsOidcTeardownTargets', () => {
    it('keeps only the named OIDC servers', async () => {
      stubServerList([
        oidcServer(),
        oidcServer({ id: 'other', code: 'other' }),
        {
          ...oidcServer({ id: 's2', code: 'plain' }),
          connection_config: { auth: { type: 'none' } },
        },
      ]);

      const targets = await readTarsOidcTeardownTargets(['s1', 's2']);

      expect(targets.map((target) => target.serverId)).toEqual(['s1']);
    });

    it('finds a disabled server, which has no entry but still has tokens', async () => {
      stubServerList([oidcServer({ is_enabled: false })]);

      const [target] = await readTarsOidcTeardownTargets(['s1']);

      expect(target.entryName).toBe('tars_demo');
      expect(target.serverConfig?.oauth?.client_id).toBe('client-1');
    });

    it('prefers the name injection chose, which a collision may have changed', async () => {
      recordTarsMcpEntryName('s1', 'tars_demo_2');
      stubServerList([oidcServer()]);

      const [target] = await readTarsOidcTeardownTargets(['s1']);

      expect(target.entryName).toBe('tars_demo_2');
    });

    it('still clears tokens of a row that can no longer be turned into a config', async () => {
      stubServerList([withConnection({ url: 'http://not-allowlisted.example.com' })]);

      const [target] = await readTarsOidcTeardownTargets(['s1']);

      expect(target.entryName).toBe('tars_demo');
      expect(target.serverConfig).toBeUndefined();
    });

    it('rejects when pwc_tars cannot answer, so the change does not go ahead blind', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

      await expect(readTarsOidcTeardownTargets(['s1'])).rejects.toThrow();
    });
  });

  describe('movedTarsOidcTargets', () => {
    const targetsFor = async () => {
      stubServerList([oidcServer()]);
      return readTarsOidcTeardownTargets(['s1']);
    };

    it.each<[string, TarsMcpServerDetail]>([
      ['the URL', withConnection({ url: 'https://elsewhere.example.com/mcp' })],
      ['the issuer', withConnection({}, { issuer: 'https://other-idp.example.com' })],
      ['the client', withConnection({}, { client_id: 'client-2' })],
      ['the code', oidcServer({ code: 'renamed' })],
    ])('flags a change of %s', async (_label, updated) => {
      expect(movedTarsOidcTargets(await targetsFor(), updated)).toHaveLength(1);
    });

    it('flags a server moved off OIDC', async () => {
      const updated = { ...oidcServer(), connection_config: { auth: { type: 'bearer' } } };

      expect(movedTarsOidcTargets(await targetsFor(), updated)).toHaveLength(1);
    });

    it.each<[string, TarsMcpServerDetail]>([
      ['the name', oidcServer({ name: 'New name' })],
      ['the enabled state', oidcServer({ is_enabled: false })],
      ['the scope', withConnection({}, { scope: 'openid profile' })],
      ['the tool allow-list', oidcServer({ tool_config: { enabled_tools: ['a'] } })],
    ])('leaves the tokens alone when only %s changes', async (_label, updated) => {
      expect(movedTarsOidcTargets(await targetsFor(), updated)).toEqual([]);
    });

    it('does nothing when pwc_tars returned no row', async () => {
      expect(movedTarsOidcTargets(await targetsFor(), undefined)).toEqual([]);
    });
  });

  describe('deletedTarsOidcTargets', () => {
    const targets = [
      { serverId: 's1', entryName: 'tars_a', identity: 'a' },
      { serverId: 's2', entryName: 'tars_b', identity: 'b' },
    ];

    it('matches the rows pwc_tars reports as deleted', () => {
      const result = { deleted: [{ id: 's1', name: 'A' }] };

      expect(deletedTarsOidcTargets(targets, result).map((t) => t.serverId)).toEqual(['s1']);
    });

    it('clears nothing when pwc_tars returned no result', () => {
      expect(deletedTarsOidcTargets(targets, undefined)).toEqual([]);
    });
  });

  describe('createTarsOidcTeardown', () => {
    const TARGET = {
      serverId: 's1',
      entryName: 'tars_demo',
      identity: 'x',
      serverConfig: { type: 'streamable-http', url: 'https://mcp.example.com' },
    } as Parameters<ReturnType<typeof createTarsOidcTeardown>>[0][number];

    const deps = (overrides: Partial<TarsOidcTeardownDeps> = {}) => ({
      findTokenUserIds: jest.fn(async () => ['u1', 'u2']),
      resolveAllowlists: jest.fn(async () => ({ allowedDomains: null, allowedAddresses: null })),
      invalidateUserTools: jest.fn(async () => undefined),
      disconnectUser: jest.fn(async () => undefined),
      uninstallOAuthMCP: jest.fn(async () => undefined),
      ...overrides,
    });

    it('looks for every token kind stored under the entry', async () => {
      const wired = deps();
      await createTarsOidcTeardown(wired)([TARGET], 'admin');

      expect(wired.findTokenUserIds).toHaveBeenCalledWith([
        'mcp:tars_demo',
        'mcp:tars_demo:client',
        'mcp:tars_demo:refresh',
      ]);
    });

    it('disconnects and clears every holder, with the config that can revoke', async () => {
      const wired = deps();
      await createTarsOidcTeardown(wired)([TARGET], 'admin');

      for (const userId of ['u1', 'u2']) {
        expect(wired.invalidateUserTools).toHaveBeenCalledWith(userId, 'tars_demo');
        expect(wired.disconnectUser).toHaveBeenCalledWith(userId, 'tars_demo');
        expect(wired.uninstallOAuthMCP).toHaveBeenCalledWith(
          userId,
          'mcp_tars_demo',
          expect.anything(),
          TARGET.serverConfig,
          expect.anything(),
        );
      }
    });

    it('clears nothing when nobody signed in', async () => {
      const wired = deps({ findTokenUserIds: jest.fn(async () => []) });
      await createTarsOidcTeardown(wired)([TARGET], 'admin');

      expect(wired.uninstallOAuthMCP).not.toHaveBeenCalled();
      expect(wired.disconnectUser).not.toHaveBeenCalled();
    });

    it('still clears a user whose disconnect failed, and reports without throwing', async () => {
      const wired = deps({
        disconnectUser: jest.fn(async () => {
          throw new Error('no connection');
        }),
      });

      await expect(createTarsOidcTeardown(wired)([TARGET], 'admin')).resolves.toBeUndefined();

      expect(wired.uninstallOAuthMCP).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalled();
    });

    it('does not let one server stop the others', async () => {
      const wired = deps({
        findTokenUserIds: jest
          .fn()
          .mockRejectedValueOnce(new Error('db'))
          .mockResolvedValue(['u1']),
      });
      const second = { ...TARGET, serverId: 's2', entryName: 'tars_other' };

      await createTarsOidcTeardown(wired)([TARGET, second], 'admin');

      expect(wired.uninstallOAuthMCP).toHaveBeenCalledWith(
        'u1',
        'mcp_tars_other',
        expect.anything(),
        second.serverConfig,
        expect.anything(),
      );
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
