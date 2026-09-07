import { Constants } from 'librechat-data-provider';
import type { LCTool, LCToolRegistry } from '@librechat/agents';
import {
  selectRelevantTools,
  rankToolsByRelevance,
  isCappedMcpTool,
  mcpMaxTools,
  tokenize,
} from './relevance';

const mockWarn = jest.fn();
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: (...args: unknown[]) => mockWarn(...args), debug: jest.fn() },
}));

const mcpName = (tool: string, server = 'tars_jira'): string =>
  `${tool}${Constants.mcp_delimiter}${server}`;

const mcpTool = (tool: string, description: string, server?: string): LCTool => ({
  name: mcpName(tool, server),
  description,
  parameters: { type: 'object', properties: {} },
});

const registryOf = (definitions: LCTool[]): LCToolRegistry =>
  new Map(definitions.map((definition) => [definition.name, definition]));

describe('tokenize', () => {
  it('splits Latin words on punctuation, underscores and camelCase', () => {
    expect(tokenize('get_user_issues: List the getUserIssues v2!')).toEqual([
      'user',
      'issues',
      'list',
      'user',
      'issues',
      'v2',
    ]);
  });

  it('turns CJK runs into character bigrams and keeps a lone character', () => {
    expect(tokenize('查詢工單 和 B')).toEqual(['b', '查詢', '詢工', '工單', '和']);
  });
});

describe('mcpMaxTools', () => {
  afterEach(() => {
    delete process.env.MCP_MAX_TOOLS;
  });

  it('defaults to 120 and ignores invalid overrides', () => {
    expect(mcpMaxTools()).toBe(120);
    process.env.MCP_MAX_TOOLS = 'lots';
    expect(mcpMaxTools()).toBe(120);
    process.env.MCP_MAX_TOOLS = '0';
    expect(mcpMaxTools()).toBe(120);
  });

  it('honours a positive override', () => {
    process.env.MCP_MAX_TOOLS = '7.9';
    expect(mcpMaxTools()).toBe(7);
  });
});

describe('isCappedMcpTool', () => {
  it('counts only non-deferred MCP definitions', () => {
    expect(isCappedMcpTool(mcpTool('search', ''))).toBe(true);
    expect(isCappedMcpTool({ ...mcpTool('search', ''), defer_loading: true })).toBe(false);
    expect(isCappedMcpTool({ name: 'web_search', description: '' })).toBe(false);
  });
});

describe('rankToolsByRelevance', () => {
  it('puts the tools sharing rare query words first and keeps load order on ties', () => {
    const tools = [
      { name: 'list_projects', description: 'List every project' },
      { name: 'create_issue', description: 'Create an issue in a project' },
      { name: 'search_issues', description: 'Search issues by text' },
      { name: 'get_issue', description: 'Get one issue' },
    ];
    const ranked = rankToolsByRelevance('search the issues about login and create an issue', tools);
    expect(ranked.map((tool) => tool.name)).toEqual([
      'search_issues',
      'create_issue',
      'get_issue',
      'list_projects',
    ]);
  });

  it('matches a Chinese question against Chinese descriptions', () => {
    const tools = [
      { name: 'list_users', description: '列出所有使用者' },
      { name: 'query_tickets', description: '查詢工單狀態' },
    ];
    expect(rankToolsByRelevance('幫我查詢工單', tools)[0].name).toBe('query_tickets');
  });

  it('keeps load order when the query carries no tokens', () => {
    const tools = [{ name: 'b' }, { name: 'a' }];
    expect(rankToolsByRelevance('   ', tools)).toEqual(tools);
  });
});

describe('selectRelevantTools', () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it('returns the input untouched when the candidates fit the cap', () => {
    const toolDefinitions = [mcpTool('a', ''), mcpTool('b', '')];
    const toolRegistry = registryOf(toolDefinitions);
    const result = selectRelevantTools({ query: 'x', toolDefinitions, toolRegistry, maxTools: 2 });
    expect(result.toolDefinitions).toBe(toolDefinitions);
    expect(result.toolRegistry).toBe(toolRegistry);
    expect(result.dropped).toEqual([]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('drops the least relevant MCP tools, keeps native tools, and prunes the registry', () => {
    const native: LCTool = { name: 'web_search', description: 'Search the web' };
    const deferred: LCTool = { ...mcpTool('archive', 'Archive a project'), defer_loading: true };
    const toolDefinitions = [
      native,
      mcpTool('list_projects', 'List every project'),
      mcpTool('create_issue', 'Create an issue in a project'),
      deferred,
      mcpTool('search_issues', 'Search issues by text', 'tars_github'),
      mcpTool('get_issue', 'Get one issue'),
    ];
    const toolRegistry = registryOf(toolDefinitions);

    const result = selectRelevantTools({
      query: 'search the issues about login and create an issue',
      toolDefinitions,
      toolRegistry,
      maxTools: 2,
    });

    expect(result.toolDefinitions.map((tool) => tool.name)).toEqual([
      'web_search',
      mcpName('create_issue'),
      deferred.name,
      mcpName('search_issues', 'tars_github'),
    ]);
    expect(result.dropped).toEqual([mcpName('list_projects'), mcpName('get_issue')]);
    expect([...(result.toolRegistry?.keys() ?? [])]).toEqual(
      result.toolDefinitions.map((tool) => tool.name),
    );
    expect(toolRegistry.size).toBe(6);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('tool count 4 exceeds cap 2; kept 2, dropped 2 by relevance'),
    );
    expect(mockWarn.mock.calls[0][0]).toContain(mcpName('get_issue'));
  });

  it('falls back to load order without a user message', () => {
    const toolDefinitions = [mcpTool('a', ''), mcpTool('b', ''), mcpTool('c', '')];
    const result = selectRelevantTools({ query: null, toolDefinitions, maxTools: 2 });
    expect(result.toolDefinitions.map((tool) => tool.name)).toEqual([mcpName('a'), mcpName('b')]);
    expect(result.toolRegistry).toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('in load order'));
  });

  it('reads the cap from MCP_MAX_TOOLS when none is given', () => {
    process.env.MCP_MAX_TOOLS = '1';
    const result = selectRelevantTools({
      query: 'beta',
      toolDefinitions: [mcpTool('alpha', ''), mcpTool('beta', '')],
    });
    delete process.env.MCP_MAX_TOOLS;
    expect(result.toolDefinitions.map((tool) => tool.name)).toEqual([mcpName('beta')]);
  });
});
