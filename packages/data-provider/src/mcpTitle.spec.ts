import { MCPOptionsSchema, MCP_TITLE_PATTERN, sanitizeMCPTitle } from './mcp';

const parseTitle = (title: string) =>
  MCPOptionsSchema.safeParse({ type: 'streamable-http', url: 'http://localhost:3080/mcp', title });

describe('MCP_TITLE_PATTERN', () => {
  it('accepts Unicode letters, digits, spaces, and the . _ - separators', () => {
    const accepted = [
      'GitHub MCP Tool',
      'github-official',
      'CUSTOM_API_REDMINE_GINA',
      'v1.2 Gateway',
      '天氣查詢',
      '日本語サーバー',
      'Café Español',
      '고객센터',
    ];
    for (const title of accepted) {
      expect(MCP_TITLE_PATTERN.test(title)).toBe(true);
      expect(parseTitle(title).success).toBe(true);
    }
  });

  it('rejects punctuation, symbols, and empty titles', () => {
    for (const title of ['', 'Platform API (Demo)', 'a/b', 'x@y', '<script>']) {
      expect(MCP_TITLE_PATTERN.test(title)).toBe(false);
      expect(parseTitle(title).success).toBe(false);
    }
  });
});

describe('sanitizeMCPTitle', () => {
  it('collapses disallowed runs into single spaces and trims', () => {
    expect(sanitizeMCPTitle('Platform API (Demo)')).toBe('Platform API Demo');
    expect(sanitizeMCPTitle('客服中心（測試）')).toBe('客服中心 測試');
    expect(sanitizeMCPTitle('  spaced   out  ')).toBe('spaced out');
  });

  /** The pattern itself accepts a whitespace-only title (upstream behavior, unchanged); sanitizing rejects it. */
  it('rejects a whitespace-only candidate the raw pattern would accept', () => {
    expect(MCP_TITLE_PATTERN.test('  ')).toBe(true);
    expect(sanitizeMCPTitle('  ', 'code')).toBe('code');
  });

  it('leaves already-valid titles untouched', () => {
    expect(sanitizeMCPTitle('github-official')).toBe('github-official');
    expect(sanitizeMCPTitle('天氣查詢 Weather')).toBe('天氣查詢 Weather');
  });

  it('falls through to the next candidate when one is unrepresentable', () => {
    expect(sanitizeMCPTitle(null, '', '(@#$%)', 'fallback')).toBe('fallback');
    expect(sanitizeMCPTitle(undefined)).toBeUndefined();
    expect(sanitizeMCPTitle('***', '///')).toBeUndefined();
  });

  it('always returns a title MCPOptionsSchema accepts', () => {
    for (const raw of ['Platform API (Demo)', '客服中心（測試）', 'a/b', 'x@y']) {
      const sanitized = sanitizeMCPTitle(raw);
      expect(sanitized).toBeDefined();
      expect(parseTitle(sanitized as string).success).toBe(true);
    }
  });
});
