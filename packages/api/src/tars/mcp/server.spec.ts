jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { invalidateTarsMcpToolsCache } from './client';
import { createTarsMcpServer } from './server';

const BASE_URL = 'http://tars.test';
const USER_ID = '42';

const envelope = (data: unknown) => ({ success: true, message: '成功', data });

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const createIssueRow = {
  server_id: 'srv-custom-1',
  server_name: 'Issue Tracker',
  server_code: 'issues',
  server_type: 'custom_api',
  tool_id: 'tool-create',
  tool_name: 'create_issue',
  description: 'Create an issue',
  input_schema: {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  },
};

const mockTarsBackend = (execute: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/mcp/available-tools')) {
      return buildResponse(200, envelope([createIssueRow]));
    }
    if (url.includes('/api/mcp/execute')) {
      return buildResponse(execute.status, execute.body);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

async function connectClient(tarsUserId: string | null): Promise<Client> {
  const server = createTarsMcpServer(tarsUserId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'spec-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsMcpToolsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.TARS_AUTH_URL;
});

describe('createTarsMcpServer', () => {
  it('lists the pwc_tars tools with their JSON Schema over a real MCP session', async () => {
    mockTarsBackend({ status: 200, body: envelope({ result: null, duration_ms: 1 }) });
    const client = await connectClient(USER_ID);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'issues__create_issue',
      description: 'Create an issue',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
    });
    await client.close();
  });

  it('executes a tool via pwc_tars and returns the JSON result as text', async () => {
    const fetchMock = mockTarsBackend({
      status: 200,
      body: envelope({ result: { id: 7, title: 'bug' }, duration_ms: 12 }),
    });
    const client = await connectClient(USER_ID);

    const result = (await client.callTool({
      name: 'issues__create_issue',
      arguments: { title: 'bug' },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ id: 7, title: 'bug' }) },
    ]);

    const executeCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('/api/mcp/execute'),
    );
    expect(JSON.parse(executeCall?.[1]?.body as string)).toEqual({
      server_id: 'srv-custom-1',
      tool_name: 'create_issue',
      arguments: { title: 'bug' },
      user_id: USER_ID,
    });
    await client.close();
  });

  it('surfaces pwc_tars execution failures as isError content with the backend message', async () => {
    mockTarsBackend({ status: 500, body: { success: false, message: '外部 API 逾時' } });
    const client = await connectClient(USER_ID);

    const result = (await client.callTool({
      name: 'issues__create_issue',
      arguments: { title: 'bug' },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'TARS tool call failed: 外部 API 逾時' },
    ]);
    await client.close();
  });

  it('fails closed for accounts not linked to pwc_tars', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const client = await connectClient(null);

    const { tools } = await client.listTools();
    expect(tools).toEqual([]);

    const result = (await client.callTool({
      name: 'issues__create_issue',
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    await client.close();
  });
});
