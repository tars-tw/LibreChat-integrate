jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import http from 'http';
import { MCPOptionsSchema } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { IncomingHttpHeaders } from 'http';
import type { MCPOAuthTokens } from '~/mcp/oauth/types';
import type { AddressInfo } from 'net';
import { deriveTarsMcpGatewayKey, withTarsMcpConfig } from './config';
import { invalidateTarsMcpToolsCache } from './client';
import { clearTarsMcpEntryNames } from './names';
import { MCPConnection } from '~/mcp/connection';
import { handleTarsMcpRequest } from './server';
import { processMCPEnv } from '~/utils/env';

/**
 * An OIDC OpenAPI / custom API server works only because upstream's MCP client sends the entry's
 * static headers and the user's OAuth bearer together, and treats the gateway's 401 as a sign-in.
 * Neither is fork code, so a rebase can change them without a conflict; this drives upstream's
 * real `MCPConnection` against the gateway handler to catch that.
 */

const TARS_URL = 'http://tars.test';
const SERVER_ID = 'srv-orders';
const ENTRY = 'tars_orders';
const MONGO_USER = 'mongo-7';
const TARS_USER = 'tars-7';
const TOKENS = { access_token: 'user-token', token_type: 'Bearer' } as MCPOAuthTokens;

const apiServer = {
  id: SERVER_ID,
  name: 'Orders',
  code: 'orders',
  type: 'openapi',
  is_enabled: true,
  connection_config: {
    openapi_url: 'https://orders.example.com/openapi.json',
    base_url: 'https://orders.example.com',
    auth: {
      type: 'oidc',
      issuer: 'https://idp.example.com',
      authorization_url: 'https://idp.example.com/authorize',
      token_url: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/jwks',
      client_id: 'librechat',
    },
  },
};

const listOrdersRow = {
  server_id: SERVER_ID,
  server_name: 'Orders',
  server_code: 'orders',
  server_type: 'openapi',
  tool_id: 'tool-list',
  tool_name: 'listOrders',
  description: 'List orders',
  input_schema: { type: 'object', properties: {} },
};

const respond = (data: unknown): Response =>
  ({ status: 200, ok: true, json: async () => ({ success: true, data }) }) as Response;

/** pwc_tars: the server list for injection, the user's tools, and the execute call. */
function stubPwcTars(executed: Record<string, unknown>[]): void {
  const realFetch = global.fetch;
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith(TARS_URL)) {
      return realFetch(input, init);
    }
    if (url.includes('/api/mcp/servers')) {
      return respond([apiServer]);
    }
    if (url.includes('/api/mcp/available-tools')) {
      return respond([listOrdersRow]);
    }
    if (url.includes('/api/mcp/execute')) {
      executed.push(JSON.parse(String(init?.body)));
      return respond({ result: { orders: [] }, duration_ms: 1 });
    }
    throw new Error(`Unexpected pwc_tars call: ${url}`);
  });
}

interface Gateway {
  url: string;
  seen: IncomingHttpHeaders[];
  close: () => Promise<void>;
}

/** Mirrors `POST /api/tars/mcp/:serverId`: gateway key, then the user header, then the handler. */
async function startGateway(): Promise<Gateway> {
  const seen: IncomingHttpHeaders[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    seen.push(req.headers);
    if (req.headers['x-tars-gateway-key'] !== deriveTarsMcpGatewayKey()) {
      res.writeHead(403).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    await handleTarsMcpRequest({
      req,
      res,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      tarsUserId: req.headers['x-tars-user-id'] === MONGO_USER ? TARS_USER : null,
      serverId: decodeURIComponent(req.url?.split('/').pop() ?? ''),
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/tars/mcp`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('an OIDC API entry through the gateway, on the real MCP client', () => {
  let gateway: Gateway;
  let config: AppConfig;
  let connection: MCPConnection | null = null;
  const executed: Record<string, unknown>[] = [];

  const signInRequests: string[] = [];

  /** Ends upstream's wait for a sign-in at once, so a rejected bearer fails here, not on timeout. */
  const connect = (oauthTokens?: MCPOAuthTokens): MCPConnection => {
    const entry = config.mcpConfig?.[ENTRY];
    if (!entry) {
      throw new Error(`${ENTRY} was not injected`);
    }
    const conn = new MCPConnection({
      serverName: ENTRY,
      serverConfig: processMCPEnv({
        options: MCPOptionsSchema.parse(entry),
        user: { id: MONGO_USER },
      }),
      userId: MONGO_USER,
      oauthTokens,
      allowedAddresses: config.mcpSettings?.allowedAddresses,
    });
    conn.on('oauthRequired', (event: { serverName: string }) => {
      signInRequests.push(event.serverName);
      conn.emit('oauthFailed', new Error('no sign-in in this test'));
    });
    connection = conn;
    return conn;
  };

  beforeEach(async () => {
    process.env.TARS_AUTH_URL = TARS_URL;
    process.env.JWT_SECRET = 'jwt-secret';
    gateway = await startGateway();
    process.env.TARS_MCP_SELF_URL = gateway.url;
    executed.length = 0;
    signInRequests.length = 0;
    stubPwcTars(executed);
    config = await withTarsMcpConfig({ mcpConfig: {} } as AppConfig);
  });

  afterEach(async () => {
    if (connection) {
      (connection as unknown as { shouldStopReconnecting: boolean }).shouldStopReconnecting = true;
      connection.removeAllListeners();
      await connection.disconnect();
      connection = null;
    }
    MCPConnection.clearCooldown(ENTRY);
    jest.restoreAllMocks();
    invalidateTarsMcpToolsCache();
    clearTarsMcpEntryNames();
    await gateway.close();
    delete process.env.TARS_AUTH_URL;
    delete process.env.JWT_SECRET;
    delete process.env.TARS_MCP_SELF_URL;
  });

  it('sends the gateway headers and the bearer together, and pwc_tars gets the token', async () => {
    const conn = connect(TOKENS);
    await conn.connect();
    const { tools } = await conn.client.listTools();
    await conn.client.callTool({ name: tools[0].name, arguments: {} });

    expect(signInRequests).toEqual([]);
    expect(tools).toHaveLength(1);
    expect(gateway.seen.length).toBeGreaterThan(0);
    for (const headers of gateway.seen) {
      expect(headers).toMatchObject({
        authorization: 'Bearer user-token',
        'x-tars-gateway-key': deriveTarsMcpGatewayKey(),
        'x-tars-user-id': MONGO_USER,
      });
    }
    expect(executed).toEqual([
      expect.objectContaining({
        server_id: SERVER_ID,
        user_id: TARS_USER,
        user_access_token: 'user-token',
      }),
    ]);
  });

  it("takes the gateway's 401 as a sign-in request", async () => {
    await expect(connect().connect()).rejects.toThrow();

    expect(signInRequests).toEqual([ENTRY]);
    expect(gateway.seen.every((headers) => headers.authorization == null)).toBe(true);
    expect(executed).toEqual([]);
  });
});
