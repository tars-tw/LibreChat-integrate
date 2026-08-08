/**
 * Live integration check against a REAL pwc_tars at TARS_LIVE_URL.
 * Skipped unless TARS_LIVE_URL is set. Not part of normal CI.
 */
jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import type { AppConfig } from '@librechat/data-schemas';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { withTarsMcpConfig } from './config';
import { listTarsMcpTools, invalidateTarsMcpToolsCache } from './client';
import { createTarsMcpServer } from './server';

const LIVE_URL = process.env.TARS_LIVE_URL;
const LIVE_USER = process.env.TARS_LIVE_USER_ID || '';
const d = LIVE_URL ? describe : describe.skip;

beforeAll(() => {
  process.env.TARS_AUTH_URL = LIVE_URL;
  process.env.JWT_SECRET = 'live-test-secret';
  invalidateTarsMcpToolsCache();
});

d('live pwc_tars integration', () => {
  it('injects one tars_<code> entry per enabled proxied server', async () => {
    const appConfig = { mcpConfig: null, mcpSettings: null } as unknown as AppConfig;
    const result = await withTarsMcpConfig(appConfig);
    const names = Object.keys(result.mcpConfig ?? {});
    const tarsNames = names.filter((n) => n.startsWith('tars_'));

    console.log(`[live] injected ${tarsNames.length} entries; sample:`, tarsNames.slice(0, 8));
    expect(tarsNames.length).toBeGreaterThan(0);

    const sample = result.mcpConfig?.[tarsNames[0]] as {
      type: string;
      url: string;
      headers: Record<string, string>;
      startup: boolean;
    };
    expect(sample.type).toBe('streamable-http');
    expect(sample.url).toMatch(/\/api\/tars\/mcp\/.+/);
    expect(sample.headers['X-Tars-User-Id']).toBe('{{LIBRECHAT_USER_ID}}');
    expect(sample.startup).toBe(false);
    expect(result.mcpSettings?.allowedAddresses).toContain('localhost:3080');
  });

  it('scopes tools per server for a real user, over a real MCP session', async () => {
    expect(LIVE_USER).toBeTruthy();

    /**
     * Discover the user's visible servers from pwc_tars directly, NOT from the
     * aggregate list — the aggregate cap can drop whole servers, and per-server
     * scoping must stay unaffected by that.
     */
    const rowsResponse = await fetch(
      `${LIVE_URL}/api/mcp/available-tools?user_id=${encodeURIComponent(LIVE_USER)}`,
    );
    const rowsBody = (await rowsResponse.json()) as {
      data: Array<{ server_id: string; server_type: string }>;
    };
    const byServer = new Map<string, number>();
    for (const row of rowsBody.data) {
      byServer.set(row.server_id, (byServer.get(row.server_id) ?? 0) + 1);
    }

    console.log(`[live] pwc_tars reports for user ${LIVE_USER}:`, [...byServer.entries()]);
    expect(byServer.size).toBeGreaterThan(0);

    const all = await listTarsMcpTools(LIVE_USER);

    console.log(`[live] aggregate view: ${all.length} tools`);
    /** Aggregate names keep the `<code>__` prefix. */
    expect(all.every((tool) => tool.name.includes('__'))).toBe(true);

    let checked = 0;
    for (const serverId of byServer.keys()) {
      const server = createTarsMcpServer(LIVE_USER, serverId);
      const [clientT, serverT] = InMemoryTransport.createLinkedPair();
      await server.connect(serverT);
      const client = new Client({ name: 'live-spec', version: '1.0.0' });
      await client.connect(clientT);

      const { tools } = await client.listTools();

      console.log(
        `[live] server ${serverId.slice(0, 8)} → ${tools.length} scoped tools:`,
        tools.slice(0, 3).map((t) => t.name),
      );
      expect(tools.length).toBeGreaterThan(0);
      /** Scoped names carry no `<code>__` prefix and have usable schemas. */
      for (const tool of tools) {
        expect(tool.name).not.toContain('__');
        expect(tool.inputSchema).toMatchObject({ type: 'object' });
      }
      await client.close();
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('fails closed for a user id pwc_tars does not know', async () => {
    const server = createTarsMcpServer('definitely-not-a-user-999999');
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 'live-spec-unlinked', version: '1.0.0' });
    await client.connect(clientT);

    const { tools } = await client.listTools();

    console.log(`[live] unknown user → ${tools.length} tools`);
    expect(tools).toEqual([]);
    await client.close();
  });
});
