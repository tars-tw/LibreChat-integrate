jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import type { AppConfig } from '@librechat/data-schemas';
import {
  TARS_MCP_SERVER_NAME,
  deriveTarsMcpGatewayKey,
  withTarsMcpConfig,
  isTarsMcpEnabled,
  tarsMcpSelfUrl,
} from './config';

const BASE_URL = 'http://tars.test';

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

  it('injects the gateway server entry and the loopback allowlist address', () => {
    const appConfig = withTarsMcpConfig(baseConfig());

    const entry = appConfig.mcpConfig?.[TARS_MCP_SERVER_NAME];
    expect(entry).toMatchObject({
      type: 'streamable-http',
      url: 'http://localhost:3080/api/tars/mcp',
      startup: false,
      chatMenu: true,
    });
    const headers = (entry as { headers: Record<string, string> }).headers;
    expect(headers['X-Tars-User-Id']).toBe('{{LIBRECHAT_USER_ID}}');
    expect(headers['X-Tars-Gateway-Key']).toBe(deriveTarsMcpGatewayKey());

    expect(appConfig.mcpSettings?.allowedAddresses).toContain('localhost:3080');
  });

  it('keeps an admin-managed tars entry untouched', () => {
    const adminEntry = { type: 'sse', url: 'http://elsewhere/sse' };
    const appConfig = {
      mcpConfig: { [TARS_MCP_SERVER_NAME]: adminEntry },
      mcpSettings: null,
    } as unknown as AppConfig;

    expect(withTarsMcpConfig(appConfig).mcpConfig?.[TARS_MCP_SERVER_NAME]).toBe(adminEntry);
  });

  it('is a no-op when the gateway is disabled or the key cannot be derived', () => {
    process.env.TARS_MCP_ENABLED = 'false';
    expect(withTarsMcpConfig(baseConfig()).mcpConfig).toBeNull();

    delete process.env.TARS_MCP_ENABLED;
    delete process.env.JWT_SECRET;
    expect(withTarsMcpConfig(baseConfig()).mcpConfig).toBeNull();
  });

  it('preserves existing mcp servers and allowed addresses', () => {
    const appConfig = {
      mcpConfig: { other: { type: 'sse', url: 'http://other/sse' } },
      mcpSettings: { allowedAddresses: ['langflow:7860'] },
    } as unknown as AppConfig;

    const result = withTarsMcpConfig(appConfig);
    expect(Object.keys(result.mcpConfig ?? {}).sort()).toEqual(['other', TARS_MCP_SERVER_NAME]);
    expect(result.mcpSettings?.allowedAddresses).toEqual(['langflow:7860', 'localhost:3080']);
  });
});
