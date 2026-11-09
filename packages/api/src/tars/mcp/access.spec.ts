jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import {
  configureTarsMcpAccess,
  isTarsDirectMcpConfig,
  TarsMcpAccessDeniedError,
  assertTarsDirectMcpAccess,
  canUseTarsDirectMcpServer,
  dropDisabledTarsDirectTools,
  resolveTarsDirectToolFilter,
} from './access';
import { invalidateTarsMcpToolsCache } from './client';
import { clearTarsMcpEntryNames, recordTarsMcpDirectEntry } from './names';

const NAME = 'tars_issues';
const DIRECT = { oauth: { client_id: 'librechat' } } as never;

const settings = (overrides: Record<string, unknown> = {}) => [
  {
    id: 's1',
    name: 'Issues',
    code: 'issues',
    type: 'external',
    user_enabled: true,
    tools: [],
    ...overrides,
  },
];

const respondWith = (data: unknown, status = 200) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    status,
    ok: status < 400,
    json: async () => ({ success: true, data }),
  } as Response);

beforeEach(() => {
  process.env.TARS_AUTH_URL = 'http://tars.test';
  invalidateTarsMcpToolsCache();
  clearTarsMcpEntryNames();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.TARS_AUTH_URL;
});

describe('isTarsDirectMcpConfig', () => {
  it('only matches tars_ entries with an oauth block', () => {
    expect(isTarsDirectMcpConfig(NAME, DIRECT)).toBe(true);
    expect(isTarsDirectMcpConfig(NAME, { oauth: undefined })).toBe(false);
    expect(isTarsDirectMcpConfig('workflow', DIRECT)).toBe(false);
  });
});

describe('canUseTarsDirectMcpServer', () => {
  it('costs gateway entries and other servers no pwc_tars call', async () => {
    const fetchSpy = respondWith([]);
    await expect(canUseTarsDirectMcpServer(NAME, { oauth: undefined }, {})).resolves.toBe(true);
    await expect(canUseTarsDirectMcpServer('github', DIRECT, {})).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows an assigned, opted-in user', async () => {
    respondWith(settings());
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' })).resolves.toBe(true);
  });

  it('denies a server the user has not opted into or is not assigned', async () => {
    respondWith(settings({ user_enabled: false }));
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' })).resolves.toBe(false);
    invalidateTarsMcpToolsCache();
    respondWith([]);
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' })).resolves.toBe(false);
  });

  it('fails closed for an unlinked account and when pwc_tars is down', async () => {
    const fetchSpy = respondWith([]);
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { id: 'mongo-1' })).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' })).resolves.toBe(false);
  });

  it('does not remember an outage as a denial', async () => {
    const fetchSpy = respondWith(settings());
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' })).resolves.toBe(false);
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' })).resolves.toBe(true);
  });

  it('caches per user, and a mutation invalidation sees a revocation at once', async () => {
    const fetchSpy = respondWith(settings());
    await canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' });
    await canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u2' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    respondWith([]);
    invalidateTarsMcpToolsCache();
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' })).resolves.toBe(false);
  });

  it('does not cache a read that an invalidation overtook', async () => {
    let finishRead: (response: Response) => void = () => undefined;
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishRead = resolve;
        }),
    );
    const staleCheck = canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' });
    await new Promise((resolve) => setImmediate(resolve));

    invalidateTarsMcpToolsCache();
    finishRead({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: settings() }),
    } as Response);
    await staleCheck;

    fetchSpy.mockRestore();
    respondWith([]);
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { tarsId: 'u1' })).resolves.toBe(false);
  });

  it('resolves the link for a caller holding only the user id', async () => {
    respondWith(settings());
    configureTarsMcpAccess({ resolveTarsId: async () => 'u1' });
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { id: 'mongo-1' })).resolves.toBe(true);
    configureTarsMcpAccess({
      resolveTarsId: async () => {
        throw new Error('db down');
      },
    });
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, { id: 'mongo-1' })).resolves.toBe(false);
  });
});

describe('assertTarsDirectMcpAccess', () => {
  it('throws the denial without naming why', async () => {
    respondWith([]);
    await expect(assertTarsDirectMcpAccess(NAME, DIRECT, { tarsId: 'u1' })).rejects.toBeInstanceOf(
      TarsMcpAccessDeniedError,
    );
  });
});

describe('tool access on a direct entry', () => {
  const USER = { id: 'u1', tarsId: 'tars-1' };
  const definition = (name: string) => ({ name }) as never;
  const opened = (...names: string[]) => [{ id: 's1', tool_config: { enabled_tools: names } }];

  const respondByPath = (servers: unknown, overrides: Record<string, unknown> = {}) =>
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      const data = path.endsWith('/user-settings')
        ? settings({ auth_type: 'oidc', ...overrides })
        : servers;
      return { status: 200, ok: true, json: async () => ({ success: true, data }) } as Response;
    });

  beforeEach(() => {
    recordTarsMcpDirectEntry(NAME, 's1');
  });

  it('refuses every tool until an admin opens it, including ones added later', async () => {
    respondByPath([{ id: 's1' }]);

    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'whoami')).resolves.toBe(false);
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER)).resolves.toBe(true);
  });

  it('allows an opened tool and refuses the others', async () => {
    respondByPath(opened('health'));

    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'health')).resolves.toBe(true);
    await expect(assertTarsDirectMcpAccess(NAME, DIRECT, USER, 'whoami')).rejects.toThrow(
      'Tool "whoami"',
    );
  });

  it('lets a user switch off an opened tool, but not switch on a closed one', async () => {
    respondByPath(opened('health'), { tool_config: { health: false, whoami: true } });

    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'health')).resolves.toBe(false);
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'whoami')).resolves.toBe(false);
  });

  it('applies neither list to a server that is not OIDC, which pwc_tars filters itself', async () => {
    respondByPath([], { auth_type: 'bearer', tool_config: { whoami: false } });

    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'whoami')).resolves.toBe(true);
  });

  it('applies a new choice at once after the cache is invalidated', async () => {
    respondByPath(opened());
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'whoami')).resolves.toBe(false);

    jest.restoreAllMocks();
    respondByPath(opened('whoami'));
    invalidateTarsMcpToolsCache();
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'whoami')).resolves.toBe(true);
  });

  it('treats a malformed allow-list as nothing opened', async () => {
    respondByPath([{ id: 's1', tool_config: { enabled_tools: 'whoami' } }]);

    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'whoami')).resolves.toBe(false);
  });

  it('fails closed when the server list cannot be read', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      if (!new URL(String(input)).pathname.endsWith('/user-settings')) {
        throw new Error('down');
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ success: true, data: settings({ auth_type: 'oidc' }) }),
      } as Response;
    });

    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER)).resolves.toBe(false);
  });

  it('drops an unusable tool from both the definitions and the registry', async () => {
    respondByPath(opened('health'));
    const off = `whoami_mcp_${NAME}`;
    const on = `health_mcp_${NAME}`;
    const toolRegistry = new Map([
      [off, definition(off)],
      [on, definition(on)],
    ]);

    const result = await dropDisabledTarsDirectTools(
      {
        toolDefinitions: [definition(off), definition(on), definition('calculator')],
        toolRegistry,
      },
      USER,
    );

    expect(result.toolDefinitions.map((tool) => tool.name)).toEqual([on, 'calculator']);
    expect([...(result.toolRegistry?.keys() ?? [])]).toEqual([on]);
    expect(toolRegistry.has(off)).toBe(true);
  });

  it('matches a stripped key by its upstream name', async () => {
    respondByPath(opened('demo_whoami'));
    const stripped = { name: `whoami_mcp_${NAME}`, serverToolName: 'demo_whoami' } as never;
    const selection = { toolDefinitions: [stripped] };

    await expect(dropDisabledTarsDirectTools(selection, USER)).resolves.toBe(selection);
  });

  it('reads nothing from pwc_tars for a turn with no direct tool', async () => {
    const fetchSpy = respondByPath(opened());
    const selection = { toolDefinitions: [definition('whoami_mcp_tars_other')] };

    await expect(dropDisabledTarsDirectTools(selection, USER)).resolves.toBe(selection);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the definitions when pwc_tars is down, leaving the refusal to the call', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    const selection = { toolDefinitions: [definition(`whoami_mcp_${NAME}`)] };

    await expect(dropDisabledTarsDirectTools(selection, USER)).resolves.toBe(selection);
    await expect(canUseTarsDirectMcpServer(NAME, DIRECT, USER, 'whoami')).resolves.toBe(false);
  });

  describe('resolveTarsDirectToolFilter', () => {
    it('filters a direct entry and passes the others', async () => {
      respondByPath(opened('health'));

      const isUsable = await resolveTarsDirectToolFilter(USER);

      expect(isUsable(NAME, 'health')).toBe(true);
      expect(isUsable(NAME, 'whoami')).toBe(false);
      expect(isUsable('workflow', 'anything')).toBe(true);
    });

    it('reads nothing from pwc_tars without a direct entry', async () => {
      clearTarsMcpEntryNames();
      const fetchSpy = respondByPath(opened());

      const isUsable = await resolveTarsDirectToolFilter(USER);

      expect(isUsable(NAME, 'whoami')).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
