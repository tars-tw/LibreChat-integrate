/**
 * TARS seam guard: an OIDC `tars_*` entry talks to its server directly, so nothing but
 * `assertTarsDirectMcpAccess` enforces the pwc_tars assignment. A rebase that loses the call
 * in `MCPManager.callTool` or `getUserConnectionForTarget` still lists tools and still signs
 * users in; it just lets an unassigned account reach the server with no visible failure.
 */
import type { IUser } from '@librechat/data-schemas';
import type * as t from '~/mcp/types';
import { invalidateTarsMcpToolsCache } from '~/tars/mcp/client';
import { TarsMcpAccessDeniedError } from '~/tars/mcp/access';
import { MCPConnection } from '~/mcp/connection';
import { MCPManager } from '~/mcp/MCPManager';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('~/mcp/registry/MCPServersRegistry', () => ({
  MCPServersRegistry: {
    getInstance: () => ({
      getServerConfig: jest.fn(),
      isAppServerConfig: jest.fn(),
      getAllServerConfigs: jest.fn(),
      getOAuthServers: jest.fn(),
      isHiddenFromPrincipal: jest.fn().mockResolvedValue(false),
      shouldEnableSSRFProtection: jest.fn().mockReturnValue(false),
      getAllowedDomains: jest.fn().mockReturnValue(null),
      getAllowedAddresses: jest.fn().mockReturnValue(null),
      resolveAllowlists: jest.fn(async () => ({
        allowedDomains: null,
        allowedAddresses: null,
        useSSRFProtection: false,
      })),
    }),
  },
}));

const SERVER = 'tars_secure';
const user = { id: 'mongo-1', tarsId: 'u-unassigned' } as IUser;
const serverConfig = {
  type: 'streamable-http',
  url: 'https://mcp.example.com/mcp',
  oauth: { client_id: 'librechat' },
} as t.MCPOptions;

const connection = () =>
  ({
    isConnected: jest.fn().mockResolvedValue(true),
    setRequestHeaders: jest.fn(),
    timeout: 30000,
    client: { request: jest.fn().mockResolvedValue({ content: [] }) },
  }) as unknown as MCPConnection;

describe('direct TARS MCP entries', () => {
  beforeEach(() => {
    process.env.TARS_AUTH_URL = 'http://tars.test';
    invalidateTarsMcpToolsCache();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TARS_AUTH_URL;
  });

  it('callTool refuses an unassigned user before touching the server', async () => {
    const manager = new MCPManager();
    const held = connection();
    jest.spyOn(manager, 'getConnection').mockResolvedValue(held);
    await expect(
      manager.callTool({
        user,
        serverName: SERVER,
        serverConfig,
        toolName: 'whoami',
        provider: 'openai',
        flowManager: {} as Parameters<MCPManager['callTool']>[0]['flowManager'],
      }),
    ).rejects.toBeInstanceOf(TarsMcpAccessDeniedError);
    expect(held.client.request).not.toHaveBeenCalled();
  });

  it('callTool refuses a tool the user switched off before touching the server', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 's1',
            code: SERVER.replace('tars_', ''),
            type: 'external',
            auth_type: 'oidc',
            user_enabled: true,
            tool_config: { whoami: false },
            tools: [],
          },
        ],
      }),
    } as Response);
    const manager = new MCPManager();
    const held = connection();
    jest.spyOn(manager, 'getConnection').mockResolvedValue(held);
    await expect(
      manager.callTool({
        user,
        serverName: SERVER,
        serverConfig,
        toolName: 'whoami',
        provider: 'openai',
        flowManager: {} as Parameters<MCPManager['callTool']>[0]['flowManager'],
      }),
    ).rejects.toThrow('Tool "whoami"');
    expect(held.client.request).not.toHaveBeenCalled();
  });

  it('getUserConnection refuses an unassigned user before opening a connection', async () => {
    const manager = new MCPManager();
    await expect(
      manager.getUserConnection({
        user,
        serverName: SERVER,
        serverConfig: serverConfig as t.ParsedServerConfig,
        flowManager: {},
      } as unknown as t.UserMCPConnectionOptions),
    ).rejects.toBeInstanceOf(TarsMcpAccessDeniedError);
  });

  it('discoverServerTools refuses an unassigned user before opening a connection', async () => {
    const manager = new MCPManager();
    jest
      .spyOn(
        manager as unknown as { getPrincipalServerConfig: () => Promise<t.ParsedServerConfig> },
        'getPrincipalServerConfig',
      )
      .mockResolvedValue(serverConfig as t.ParsedServerConfig);

    await expect(
      manager.discoverServerTools({ user, serverName: SERVER } as t.ToolDiscoveryOptions),
    ).rejects.toBeInstanceOf(TarsMcpAccessDeniedError);
  });
});
