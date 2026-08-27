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
import { invalidateTarsSqlDatabasesCache } from './client';
import { rememberTarsChatContext, clearTarsChatContexts } from '~/tars/chat';
import { createTarsSqlServer } from './server';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const mockBackend = (sql: { status: number; body: unknown }) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/knowledge_base/prepare_data')) {
      return buildResponse(200, {
        knowledge_bases: [
          { id: 'kb-sql', name: '通用知識庫', description: '', has_sql_database: true },
          { id: 'kb-other', name: '人資知識庫', description: '', has_sql_database: true },
          { id: 'kb-plain', name: '文件庫', description: '', has_sql_database: false },
        ],
      });
    }
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, {
        sys_domains: [{ id: 100, name: '通用腦', knowledge_base_ids: 'kb-sql,kb-plain' }],
      });
    }
    if (url.includes('/api/langflow-service/sql')) {
      return buildResponse(sql.status, sql.body);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const answerBody = {
  success: true,
  data: { answer: '共有 9 個模型', model_name: 'gpt-5.4-mini', tokens: { total: 8983 } },
};

async function connectClient(tarsUserId: string | null, librechatUserId?: string): Promise<Client> {
  const server = createTarsSqlServer(tarsUserId, librechatUserId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'spec-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

const textOf = (result: CallToolResult): string =>
  result.content.map((part) => (part.type === 'text' ? part.text : '')).join('');

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  process.env.TARS_SQL_SERVICE_KEY = 'service-key';
  invalidateTarsSqlDatabasesCache();
  clearTarsChatContexts();
});

afterEach(() => {
  delete process.env.TARS_SQL_SERVICE_KEY;
  jest.restoreAllMocks();
});

describe('createTarsSqlServer', () => {
  it('advertises both tools without touching pwc_tars', async () => {
    const fetchMock = mockBackend({ status: 200, body: answerBody });
    const client = await connectClient(USER_ID);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['list_databases', 'query_database']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides the tools from an account not linked to pwc_tars', async () => {
    const client = await connectClient(null);
    await expect(client.listTools()).resolves.toEqual({ tools: [] });

    const result = (await client.callTool({
      name: 'query_database',
      arguments: { question: 'q', knowledge_base_id: 'kb-sql' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not linked to pwc_tars');
  });

  it('lists only the databases the user may reach', async () => {
    mockBackend({ status: 200, body: answerBody });
    const client = await connectClient(USER_ID);

    const result = (await client.callTool({
      name: 'list_databases',
      arguments: {},
    })) as CallToolResult;
    expect(textOf(result)).toContain('kb-sql');
    expect(textOf(result)).not.toContain('kb-plain');
  });

  it('lists only the databases the active brain binds', async () => {
    mockBackend({ status: 200, body: answerBody });
    rememberTarsChatContext('lc-1', { domainId: 100 });
    const client = await connectClient(USER_ID, 'lc-1');

    const result = (await client.callTool({
      name: 'list_databases',
      arguments: {},
    })) as CallToolResult;
    expect(textOf(result)).toContain('kb-sql');
    expect(textOf(result)).not.toContain('kb-other');
  });

  it('refuses a database outside the active brain', async () => {
    mockBackend({ status: 200, body: answerBody });
    rememberTarsChatContext('lc-1', { domainId: 100 });
    const client = await connectClient(USER_ID, 'lc-1');

    const result = (await client.callTool({
      name: 'query_database',
      arguments: { question: 'q', knowledge_base_id: 'kb-other' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not one of the databases bound');
  });

  it('returns the pwc_tars answer for a question', async () => {
    mockBackend({ status: 200, body: answerBody });
    const client = await connectClient(USER_ID);

    const result = (await client.callTool({
      name: 'query_database',
      arguments: { question: '有什麼模型？', knowledge_base_id: 'kb-sql' },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe('共有 9 個模型');
  });

  it('reports a pwc_tars failure as a tool error instead of throwing', async () => {
    mockBackend({ status: 400, body: { message: '資料庫 schema 資訊尚未生成' } });
    const client = await connectClient(USER_ID);

    const result = (await client.callTool({
      name: 'query_database',
      arguments: { question: 'q', knowledge_base_id: 'kb-sql' },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('資料庫 schema 資訊尚未生成');
  });
});
