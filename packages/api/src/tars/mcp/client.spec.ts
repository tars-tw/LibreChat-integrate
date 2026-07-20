jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import type { TarsAvailableToolRow } from './client';
import { TarsRequestError } from '~/tars/client';
import {
  listTarsMcpTools,
  resolveTarsMcpTool,
  executeTarsMcpTool,
  invalidateTarsMcpToolsCache,
} from './client';

const BASE_URL = 'http://tars.test';
const USER_ID = '42';

const envelope = (data: unknown) => ({ success: true, message: '成功', data });

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const toolRow = (overrides: Partial<TarsAvailableToolRow> = {}): TarsAvailableToolRow => ({
  server_id: 'srv-custom-1',
  server_name: 'Issue Tracker',
  server_code: 'issues',
  server_type: 'custom_api',
  tool_id: 'tool-create',
  tool_name: 'create_issue',
  description: 'Create an issue',
  input_schema: null,
  ...overrides,
});

interface RouteMap {
  [pathPrefix: string]: { status: number; body: unknown };
}

const mockFetchRoutes = (routes: RouteMap) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    for (const [prefix, response] of Object.entries(routes)) {
      if (url.startsWith(`${BASE_URL}${prefix}`)) {
        return buildResponse(response.status, response.body);
      }
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsMcpToolsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.TARS_AUTH_URL;
  delete process.env.TARS_MCP_EXECUTE_TIMEOUT_MS;
});

describe('listTarsMcpTools', () => {
  it('builds prefixed tool names and skips non-proxied server types', async () => {
    mockFetchRoutes({
      '/api/mcp/available-tools': {
        status: 200,
        body: envelope([
          toolRow({
            server_id: 'srv-openapi-1',
            server_name: 'Petstore',
            server_code: 'petstore',
            server_type: 'openapi',
            tool_id: 'tool-pet',
            tool_name: 'get_pet',
            description: 'Get a pet',
            input_schema: { type: 'object', properties: { id: {} } },
          }),
          toolRow(),
          toolRow({ server_type: 'external', tool_name: 'real_mcp_tool' }),
          toolRow({ server_type: 'builtin', tool_name: 'web_search' }),
        ]),
      },
    });

    const tools = await listTarsMcpTools(USER_ID);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'issues__create_issue',
      'petstore__get_pet',
    ]);

    const petTool = tools.find((tool) => tool.name === 'petstore__get_pet');
    expect(petTool).toMatchObject({
      serverId: 'srv-openapi-1',
      serverName: 'Petstore',
      toolName: 'get_pet',
      description: 'Get a pet',
      inputSchema: { type: 'object', properties: { id: {} } },
    });

    const issueTool = tools.find((tool) => tool.name === 'issues__create_issue');
    expect(issueTool?.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('passes the pwc_tars user id so filtering happens server-side', async () => {
    const fetchMock = mockFetchRoutes({
      '/api/mcp/available-tools': { status: 200, body: envelope([]) },
    });

    await listTarsMcpTools(USER_ID);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/mcp/available-tools?');
    expect(url).toContain(`user_id=${USER_ID}`);
  });

  it('caches per user and refetches after invalidation', async () => {
    const fetchMock = mockFetchRoutes({
      '/api/mcp/available-tools': { status: 200, body: envelope([]) },
    });

    await listTarsMcpTools(USER_ID);
    await listTarsMcpTools(USER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await listTarsMcpTools('other-user');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    invalidateTarsMcpToolsCache();
    await listTarsMcpTools(USER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('suffixes colliding tool names with the server id', async () => {
    mockFetchRoutes({
      '/api/mcp/available-tools': {
        status: 200,
        body: envelope([
          toolRow(),
          toolRow({ server_id: 'srv-custom-2', server_name: 'Issue Tracker 2' }),
        ]),
      },
    });

    const tools = await listTarsMcpTools(USER_ID);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'issues__create_issue',
      'issues__create_issue_srv-cust',
    ]);
  });

  it('truncates the tool list to TARS_MCP_MAX_TOOLS keeping backend order', async () => {
    process.env.TARS_MCP_MAX_TOOLS = '2';
    mockFetchRoutes({
      '/api/mcp/available-tools': {
        status: 200,
        body: envelope([
          toolRow({ tool_id: 't1', tool_name: 'alpha' }),
          toolRow({ tool_id: 't2', tool_name: 'beta' }),
          toolRow({ tool_id: 't3', tool_name: 'gamma' }),
        ]),
      },
    });

    const tools = await listTarsMcpTools(USER_ID);
    expect(tools.map((tool) => tool.name)).toEqual(['issues__alpha', 'issues__beta']);

    const missing = await resolveTarsMcpTool(USER_ID, 'issues__gamma');
    expect(missing).toBeNull();
    delete process.env.TARS_MCP_MAX_TOOLS;
  });

  it('propagates pwc_tars listing failures as TarsRequestError', async () => {
    mockFetchRoutes({
      '/api/mcp/available-tools': { status: 503, body: { success: false, message: 'down' } },
    });

    await expect(listTarsMcpTools(USER_ID)).rejects.toMatchObject({
      name: 'TarsRequestError',
      status: 503,
      serverMessage: 'down',
    });
  });
});

describe('resolveTarsMcpTool', () => {
  it('force-refreshes the cache when the tool name is unknown', async () => {
    let listCalls = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/mcp/available-tools')) {
        listCalls += 1;
        const rows =
          listCalls > 1
            ? [toolRow(), toolRow({ tool_id: 'tool-close', tool_name: 'close_issue' })]
            : [];
        return buildResponse(200, envelope(rows));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await listTarsMcpTools(USER_ID);
    const entry = await resolveTarsMcpTool(USER_ID, 'issues__close_issue');
    expect(entry?.toolName).toBe('close_issue');
    expect(listCalls).toBe(2);
  });
});

describe('executeTarsMcpTool', () => {
  const routesWithExecute = (execute: { status: number; body: unknown }) => ({
    '/api/mcp/available-tools': { status: 200, body: envelope([toolRow()]) },
    '/api/mcp/execute': execute,
  });

  it('posts the pwc_tars coordinates including the executing user id', async () => {
    const fetchMock = mockFetchRoutes(
      routesWithExecute({
        status: 200,
        body: envelope({ result: { id: 7 }, duration_ms: 123 }),
      }),
    );

    const outcome = await executeTarsMcpTool(USER_ID, 'issues__create_issue', { title: 'bug' });
    expect(outcome).toEqual({ result: { id: 7 }, durationMs: 123 });

    const executeCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/api/mcp/execute'),
    );
    expect(executeCall).toBeDefined();
    expect(JSON.parse(executeCall?.[1]?.body as string)).toEqual({
      server_id: 'srv-custom-1',
      tool_name: 'create_issue',
      arguments: { title: 'bug' },
      user_id: USER_ID,
    });
  });

  it('throws TarsRequestError carrying the pwc_tars failure message on HTTP 500', async () => {
    mockFetchRoutes(
      routesWithExecute({
        status: 500,
        body: { success: false, message: 'API 呼叫失敗: timeout' },
      }),
    );

    await expect(executeTarsMcpTool(USER_ID, 'issues__create_issue', {})).rejects.toMatchObject({
      name: 'TarsRequestError',
      status: 500,
      serverMessage: 'API 呼叫失敗: timeout',
    });
  });

  it('rejects unknown tool names', async () => {
    mockFetchRoutes({
      '/api/mcp/available-tools': { status: 200, body: envelope([]) },
    });

    await expect(executeTarsMcpTool(USER_ID, 'nope__missing', {})).rejects.toThrow(
      'Unknown TARS MCP tool: nope__missing',
    );
  });
});

describe('TarsRequestError', () => {
  it('keeps the generic status message for callers matching on it', () => {
    const error = new TarsRequestError(503, '/api/mcp/servers', 'down');
    expect(error.message).toBe('pwc_tars request to /api/mcp/servers returned status 503');
    expect(error.serverMessage).toBe('down');
  });
});
