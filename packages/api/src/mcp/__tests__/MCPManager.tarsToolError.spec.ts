/**
 * TARS seam guard for `MCPManager.callTool`: an MCP result the server marked
 * `isError` must leave the manager noted as such (`noteTarsMcpToolError`,
 * packages/api/src/tars/failure.ts). LibreChat formats the result and drops the
 * flag, so a rebase that loses the call only shows up as a failed third-party
 * MCP call recorded as a success in the pwc_tars audit trace.
 */
import type { IUser } from '@librechat/data-schemas';
import type * as t from '~/mcp/types';
import { noteTarsMcpToolCall, takeTarsFailedToolCalls } from '~/tars/failure';
import { MCPConnection } from '~/mcp/connection';
import { MCPManager } from '~/mcp/MCPManager';
import * as graphUtils from '~/utils/graph';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('~/utils/graph', () => ({
  ...jest.requireActual('~/utils/graph'),
  preProcessGraphTokens: jest.fn(),
}));

jest.mock('~/utils/env', () => ({
  ...jest.requireActual('~/utils/env'),
  processMCPEnv: jest.fn((params) => params.options),
}));

jest.mock('~/auth/domain', () => ({
  isMCPDomainAllowed: jest.fn().mockResolvedValue(true),
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

const user = { id: 'tars-seam-user' } as IUser;
const serverConfig: t.SSEOptions = { type: 'sse', url: 'https://api.example.com' };

const connectionReturning = (response: t.MCPToolCallResponse): MCPConnection =>
  ({
    isConnected: jest.fn().mockResolvedValue(true),
    setRequestHeaders: jest.fn(),
    timeout: 30000,
    client: { request: jest.fn().mockResolvedValue(response) },
  }) as unknown as MCPConnection;

const call = async (response: t.MCPToolCallResponse) => {
  const manager = new MCPManager();
  jest.spyOn(manager, 'getConnection').mockResolvedValue(connectionReturning(response));
  return manager.callTool({
    user,
    serverName: 'third_party',
    serverConfig,
    toolName: 'lookup',
    provider: 'openai',
    flowManager: {} as Parameters<MCPManager['callTool']>[0]['flowManager'],
  });
};

describe('TARS isError seam in MCPManager.callTool', () => {
  beforeEach(() => {
    (graphUtils.preProcessGraphTokens as jest.Mock).mockImplementation(async (options) => options);
  });

  it('notes a result the server marked as an error', async () => {
    const result = await call({ content: [{ type: 'text', text: 'rate limited' }], isError: true });
    noteTarsMcpToolCall('call-error', result, { user_id: 'u-1', thread_id: 'c-1' });
    expect(takeTarsFailedToolCalls('u-1', 'c-1').has('call-error')).toBe(true);
  });

  it('leaves a successful result unmarked', async () => {
    const result = await call({ content: [{ type: 'text', text: 'ok' }], isError: false });
    noteTarsMcpToolCall('call-ok', result, { user_id: 'u-1', thread_id: 'c-2' });
    expect(takeTarsFailedToolCalls('u-1', 'c-2').has('call-ok')).toBe(false);
  });
});
