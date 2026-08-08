import {
  normalizeServerName,
  tarsMcpServerName,
  isTarsMcpServerName,
  TARS_MCP_SERVER_PREFIX,
} from '../src/config';

describe('tarsMcpServerName', () => {
  it('prefixes the sanitized server code', () => {
    expect(tarsMcpServerName('weather-api')).toBe('tars_weather-api');
    expect(tarsMcpServerName('issues')).toBe('tars_issues');
    expect(tarsMcpServerName('a.b_c-d')).toBe('tars_a.b_c-d');
  });

  it('sanitizes characters outside the tool-key alphabet', () => {
    expect(tarsMcpServerName('my api')).toBe('tars_my_api');
    expect(tarsMcpServerName('日本語code')).toBe('tars____code');
    expect(tarsMcpServerName('a/b\\c')).toBe('tars_a_b_c');
  });

  it('always yields a normalizeServerName fixed point (no alias/shadowing)', () => {
    const adversarial = ['weather-api', 'my api', '日本語code', 'a/b\\c', '  spaced  ', 'x.y-z_0'];
    for (const code of adversarial) {
      const name = tarsMcpServerName(code);
      expect(normalizeServerName(name)).toBe(name);
      expect(name.startsWith(TARS_MCP_SERVER_PREFIX)).toBe(true);
    }
  });
});

describe('isTarsMcpServerName', () => {
  it('matches the legacy aggregate entry and per-server entries', () => {
    expect(isTarsMcpServerName('tars')).toBe(true);
    expect(isTarsMcpServerName('tars_weather')).toBe(true);
    expect(isTarsMcpServerName(tarsMcpServerName('anything'))).toBe(true);
  });

  it('rejects unrelated server names', () => {
    expect(isTarsMcpServerName('langflow')).toBe(false);
    expect(isTarsMcpServerName('tarsish')).toBe(false);
    expect(isTarsMcpServerName('my_tars_server')).toBe(false);
  });
});
