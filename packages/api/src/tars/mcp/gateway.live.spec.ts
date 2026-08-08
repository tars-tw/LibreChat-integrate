/**
 * Live end-to-end check of the gateway over REAL HTTP with a REAL MCP client
 * (StreamableHTTPClientTransport) — the same transport LibreChat's MCPManager
 * uses for the injected `tars_<code>` entries. Mirrors the express route in
 * `api/server/routes/tars/mcp.js` (gateway-key check + `:serverId` scoping).
 * Skipped unless TARS_LIVE_URL is set.
 */
jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import { timingSafeEqual } from 'crypto';
import type { Server as HttpServer } from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleTarsMcpRequest } from './server';
import { deriveTarsMcpGatewayKey } from './config';
import { invalidateTarsMcpToolsCache } from './client';

const LIVE_URL = process.env.TARS_LIVE_URL;
const LIVE_USER = process.env.TARS_LIVE_USER_ID || '';
const LIVE_SERVER_ID = process.env.TARS_LIVE_SERVER_ID || '';
const d = LIVE_URL ? describe : describe.skip;

let httpServer: HttpServer;
let port: number;

/** Mirrors the express route's key check verbatim. */
function gatewayKeyMatches(provided: unknown): boolean {
  const expected = deriveTarsMcpGatewayKey();
  if (!expected || typeof provided !== 'string' || provided.length === 0) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

beforeAll(async () => {
  process.env.TARS_AUTH_URL = LIVE_URL;
  process.env.JWT_SECRET = 'live-test-secret';
  invalidateTarsMcpToolsCache();

  const app = express();
  app.use(express.json());
  const handler =
    (serverIdFrom?: (req: express.Request) => string) =>
    async (req: express.Request, res: express.Response) => {
      if (!gatewayKeyMatches(req.headers['x-tars-gateway-key'])) {
        res
          .status(403)
          .json({ jsonrpc: '2.0', error: { code: -32002, message: 'Forbidden' }, id: null });
        return;
      }
      /** The route maps the Mongo user id header → User.tarsId; here it is passed straight through. */
      const tarsUserId = (req.headers['x-tars-user-id'] as string) || null;
      await handleTarsMcpRequest({
        req,
        res,
        body: req.body,
        tarsUserId,
        serverId: serverIdFrom?.(req),
      });
    };
  app.post('/api/tars/mcp', handler());
  app.post(
    '/api/tars/mcp/:serverId',
    handler((req) => req.params.serverId),
  );

  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => {
      port = (httpServer.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function connect(path: string, headers: Record<string, string>): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${path}`), {
    requestInit: { headers },
  });
  const client = new Client({ name: 'gateway-live-spec', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

d('gateway over real HTTP', () => {
  const key = () => deriveTarsMcpGatewayKey() as string;

  it('serves scoped tools/list to a real streamable-http MCP client', async () => {
    expect(LIVE_SERVER_ID).toBeTruthy();
    const client = await connect(`/api/tars/mcp/${LIVE_SERVER_ID}`, {
      'X-Tars-Gateway-Key': key(),
      'X-Tars-User-Id': LIVE_USER,
    });

    const { tools } = await client.listTools();

    console.log(
      `[gateway] ${tools.length} tools over HTTP:`,
      tools.slice(0, 3).map((t) => t.name),
    );
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => !t.name.includes('__'))).toBe(true);
    await client.close();
  });

  it('rejects a wrong gateway key', async () => {
    await expect(
      connect(`/api/tars/mcp/${LIVE_SERVER_ID}`, {
        'X-Tars-Gateway-Key': 'wrong-key',
        'X-Tars-User-Id': LIVE_USER,
      }),
    ).rejects.toThrow();
  });

  it('isolates servers: a tool of server A is unknown on server B', async () => {
    const other = process.env.TARS_LIVE_OTHER_SERVER_ID;
    if (!other) {
      return;
    }
    const clientA = await connect(`/api/tars/mcp/${LIVE_SERVER_ID}`, {
      'X-Tars-Gateway-Key': key(),
      'X-Tars-User-Id': LIVE_USER,
    });
    const { tools } = await clientA.listTools();
    const toolFromA = tools[0].name;
    await clientA.close();

    const clientB = await connect(`/api/tars/mcp/${other}`, {
      'X-Tars-Gateway-Key': key(),
      'X-Tars-User-Id': LIVE_USER,
    });
    const { tools: toolsB } = await clientB.listTools();

    console.log(
      `[gateway] server B has ${toolsB.length} tools; A's "${toolFromA}" present:`,
      toolsB.some((t) => t.name === toolFromA),
    );
    const result = (await clientB.callTool({ name: toolFromA, arguments: {} })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown TARS MCP tool');
    await clientB.close();
  });
});
