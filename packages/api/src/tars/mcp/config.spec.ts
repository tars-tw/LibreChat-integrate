jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { MCPOptionsSchema } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import {
  deriveTarsMcpGatewayKey,
  tarsMcpInjectionFailed,
  withTarsMcpConfig,
  isTarsMcpEnabled,
  tarsMcpSelfUrl,
} from './config';

const BASE_URL = 'http://tars.test';

const envelope = (data: unknown) => ({ success: true, message: '成功', data });

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

interface ServerRow {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  type: string;
  is_enabled: boolean;
}

const serverRow = (overrides: Partial<ServerRow> = {}): ServerRow => ({
  id: 'srv-1',
  name: 'Issue Tracker',
  code: 'issues',
  description: 'Issue tools',
  type: 'custom_api',
  is_enabled: true,
  ...overrides,
});

const mockServerList = (rows: ServerRow[]) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith(`${BASE_URL}/api/mcp/servers`)) {
      return buildResponse(200, envelope(rows));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const ENV_KEYS = [
  'TARS_AUTH_URL',
  'TARS_MCP_ENABLED',
  'TARS_MCP_GATEWAY_KEY',
  'TARS_MCP_SELF_URL',
  'JWT_SECRET',
  'PORT',
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.TARS_AUTH_URL = BASE_URL;
  process.env.JWT_SECRET = 'test-secret';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe('isTarsMcpEnabled', () => {
  it('requires TARS_AUTH_URL and honors the TARS_MCP_ENABLED kill switch', () => {
    expect(isTarsMcpEnabled()).toBe(true);

    process.env.TARS_MCP_ENABLED = 'false';
    expect(isTarsMcpEnabled()).toBe(false);

    process.env.TARS_MCP_ENABLED = 'true';
    expect(isTarsMcpEnabled()).toBe(true);

    delete process.env.TARS_AUTH_URL;
    expect(isTarsMcpEnabled()).toBe(false);
  });
});

describe('deriveTarsMcpGatewayKey', () => {
  it('prefers the explicit override', () => {
    process.env.TARS_MCP_GATEWAY_KEY = ' my-key ';
    expect(deriveTarsMcpGatewayKey()).toBe('my-key');
  });

  it('derives a stable key from JWT_SECRET', () => {
    const first = deriveTarsMcpGatewayKey();
    const second = deriveTarsMcpGatewayKey();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);

    process.env.JWT_SECRET = 'another-secret';
    expect(deriveTarsMcpGatewayKey()).not.toBe(first);
  });

  it('returns null when neither source exists', () => {
    delete process.env.JWT_SECRET;
    expect(deriveTarsMcpGatewayKey()).toBeNull();
  });
});

describe('tarsMcpSelfUrl', () => {
  it('defaults to localhost with the configured port', () => {
    expect(tarsMcpSelfUrl()).toBe('http://localhost:3080/api/tars/mcp');
    process.env.PORT = '4000';
    expect(tarsMcpSelfUrl()).toBe('http://localhost:4000/api/tars/mcp');
  });

  it('honors the full-URL override and strips trailing slashes', () => {
    process.env.TARS_MCP_SELF_URL = 'https://chat.internal/api/tars/mcp/';
    expect(tarsMcpSelfUrl()).toBe('https://chat.internal/api/tars/mcp');
  });
});

describe('withTarsMcpConfig', () => {
  const baseConfig = () => ({ mcpConfig: null, mcpSettings: null }) as unknown as AppConfig;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('injects one per-server gateway entry and the loopback allowlist address', async () => {
    mockServerList([
      serverRow(),
      serverRow({ id: 'srv-2', name: 'Weather', code: 'weather', type: 'openapi' }),
      serverRow({ id: 'srv-3', name: 'Fetcher', code: 'fetcher', type: 'external' }),
      serverRow({ id: 'srv-4', name: 'Builtin', code: 'builtin_ws', type: 'builtin' }),
      serverRow({ id: 'srv-5', name: 'Disabled', code: 'off', is_enabled: false }),
    ]);

    const appConfig = await withTarsMcpConfig(baseConfig());

    expect(Object.keys(appConfig.mcpConfig ?? {}).sort()).toEqual([
      'tars_fetcher',
      'tars_issues',
      'tars_weather',
    ]);
    const entry = appConfig.mcpConfig?.tars_issues;
    expect(entry).toMatchObject({
      type: 'streamable-http',
      url: 'http://localhost:3080/api/tars/mcp/srv-1',
      startup: false,
      chatMenu: true,
      title: 'Issue Tracker',
      description: 'Issue tools',
    });
    const headers = (entry as { headers: Record<string, string> }).headers;
    expect(headers['X-Tars-User-Id']).toBe('{{LIBRECHAT_USER_ID}}');
    expect(headers['X-Tars-Gateway-Key']).toBe(deriveTarsMcpGatewayKey());

    expect(appConfig.mcpSettings?.allowedAddresses).toContain('localhost:3080');
    expect(tarsMcpInjectionFailed()).toBe(false);
  });

  it('keeps a same-named admin-managed entry untouched', async () => {
    mockServerList([serverRow()]);
    const adminEntry = { type: 'sse', url: 'http://elsewhere/sse' };
    const appConfig = {
      mcpConfig: { tars_issues: adminEntry },
      mcpSettings: null,
    } as unknown as AppConfig;

    expect((await withTarsMcpConfig(appConfig)).mcpConfig?.tars_issues).toBe(adminEntry);
  });

  it('suffixes the server id when sanitized codes collide', async () => {
    mockServerList([
      serverRow({ id: 'aaaa1111-x', code: 'my api' }),
      serverRow({ id: 'bbbb2222-x', code: 'my_api' }),
    ]);

    const appConfig = await withTarsMcpConfig(baseConfig());
    expect(Object.keys(appConfig.mcpConfig ?? {}).sort()).toEqual([
      'tars_my_api',
      'tars_my_api_bbbb2222',
    ]);
  });

  it('is a no-op when the gateway is disabled or the key cannot be derived', async () => {
    process.env.TARS_MCP_ENABLED = 'false';
    expect((await withTarsMcpConfig(baseConfig())).mcpConfig).toBeNull();

    delete process.env.TARS_MCP_ENABLED;
    delete process.env.JWT_SECRET;
    expect((await withTarsMcpConfig(baseConfig())).mcpConfig).toBeNull();
  });

  it('injects nothing and flags the failure when pwc_tars is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const appConfig = await withTarsMcpConfig(baseConfig());
    expect(appConfig.mcpConfig).toBeNull();
    expect(tarsMcpInjectionFailed()).toBe(true);

    jest.restoreAllMocks();
    mockServerList([serverRow()]);
    await withTarsMcpConfig(baseConfig());
    expect(tarsMcpInjectionFailed()).toBe(false);
  });

  it('emits titles MCPOptionsSchema accepts, falling back to the code then to none', async () => {
    mockServerList([
      serverRow({ id: 'srv-1', name: 'github-official', code: 'github-official' }),
      serverRow({ id: 'srv-2', name: 'CUSTOM_API_REDMINE_GINA', code: 'redmine_gina' }),
      serverRow({ id: 'srv-3', name: '天氣查詢 Weather', code: 'weather_check' }),
      serverRow({ id: 'srv-4', name: '客服中心（測試）', code: 'support' }),
      serverRow({ id: 'srv-5', name: '(@#$%)', code: '(!!)' }),
    ]);

    const mcpConfig = (await withTarsMcpConfig(baseConfig())).mcpConfig ?? {};
    const titleOf = (name: string) => (mcpConfig[name] as { title?: string }).title;

    expect(titleOf('tars_github-official')).toBe('github-official');
    expect(titleOf('tars_redmine_gina')).toBe('CUSTOM_API_REDMINE_GINA');
    expect(titleOf('tars_weather_check')).toBe('天氣查詢 Weather');
    expect(titleOf('tars_support')).toBe('客服中心 測試');
    expect(titleOf('tars_____')).toBeUndefined();

    for (const entry of Object.values(mcpConfig)) {
      expect(MCPOptionsSchema.safeParse(entry).success).toBe(true);
    }
  });

  it('preserves existing mcp servers and allowed addresses', async () => {
    mockServerList([serverRow()]);
    const appConfig = {
      mcpConfig: { other: { type: 'sse', url: 'http://other/sse' } },
      mcpSettings: { allowedAddresses: ['langflow:7860'] },
    } as unknown as AppConfig;

    const result = await withTarsMcpConfig(appConfig);
    expect(Object.keys(result.mcpConfig ?? {}).sort()).toEqual(['other', 'tars_issues']);
    expect(result.mcpSettings?.allowedAddresses).toEqual(['langflow:7860', 'localhost:3080']);
  });
});
