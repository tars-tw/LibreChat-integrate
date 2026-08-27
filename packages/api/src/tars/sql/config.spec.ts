jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { TARS_SQL_MCP_SERVER_NAME } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { withTarsSqlAgentConfig } from './config';

const baseConfig = (): AppConfig => ({}) as AppConfig;

beforeEach(() => {
  process.env.TARS_AUTH_URL = 'http://tars.test';
  process.env.JWT_SECRET = 'secret';
  process.env.PORT = '3080';
  delete process.env.TARS_SQL_AGENT_ENABLED;
  delete process.env.TARS_SQL_AGENT_SELF_URL;
  delete process.env.TARS_SQL_AGENT_TITLE;
});

describe('withTarsSqlAgentConfig', () => {
  it('injects a loopback entry and allows its address', () => {
    const config = withTarsSqlAgentConfig(baseConfig());
    const entry = config.mcpConfig?.[TARS_SQL_MCP_SERVER_NAME];

    expect(entry).toMatchObject({
      type: 'streamable-http',
      url: 'http://localhost:3080/api/tars/sql-agent',
      startup: false,
      chatMenu: true,
      title: '資料庫查詢',
    });
    expect(config.mcpSettings?.allowedAddresses).toContain('localhost:3080');
  });

  it('does nothing when pwc_tars is unconfigured', () => {
    delete process.env.TARS_AUTH_URL;
    expect(withTarsSqlAgentConfig(baseConfig()).mcpConfig).toBeUndefined();
  });

  it('does nothing when explicitly disabled', () => {
    process.env.TARS_SQL_AGENT_ENABLED = 'false';
    expect(withTarsSqlAgentConfig(baseConfig()).mcpConfig).toBeUndefined();
  });

  it('leaves an admin-managed entry of the same name alone', () => {
    const config = {
      mcpConfig: { [TARS_SQL_MCP_SERVER_NAME]: { type: 'sse', url: 'http://yaml' } },
    };
    expect(withTarsSqlAgentConfig(config as unknown as AppConfig).mcpConfig).toEqual(
      config.mcpConfig,
    );
  });
});
