jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import jwt from 'jsonwebtoken';
import { validateHeaderValue } from 'http';
import { Readable, Writable } from 'stream';
import { finished } from 'stream/promises';
import { FileSources, TARS_AUDIT_NO_AGENT } from 'librechat-data-provider';
import type { Response as ExpressResponse } from 'express';
import type { TTarsMessageTrace } from 'librechat-data-provider';
import type { JwtPayload } from 'jsonwebtoken';
import type { TarsAuditStoredFile } from './audit';
import {
  fetchTarsAuditReport,
  fetchTarsMessageTrace,
  fetchTarsAuditFilterOptions,
  tarsAuditErrorReply,
  tarsTraceNamesDocument,
  createTarsAuditDocumentHandler,
  downloadTarsAuditMemoryDocument,
} from './audit';
import { TarsRequestError } from './client';

const BASE_URL = 'http://tars.test';
const SECRET = 'pwc-tars-test-secret';
const ADMIN = 'tars-admin-1';

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.TARS_JWT_SECRET;
  process.env.TARS_JWT_SECRET = SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) {
    delete process.env.TARS_JWT_SECRET;
  } else {
    process.env.TARS_JWT_SECRET = savedSecret;
  }
});

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const bodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);

const actingUserOf = (fetchMock: jest.SpyInstance): string => {
  const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
  return (
    jwt.verify(headers.Authorization.slice('Bearer '.length), SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload
  ).user_id;
};

/** An in-memory agent store with a spy, standing in for LibreChat's `getAgents`. */
const directoryOf = (agents: { id: string; name?: string | null }[]) => ({
  findAgents: jest.fn(async (ids?: string[]) =>
    ids ? agents.filter((agent) => ids.includes(agent.id)) : agents,
  ),
});

const NO_AGENTS = directoryOf([]);

/** pwc_tars gates both audit routes behind `@admin_required`. */
describe('audit requests carry the acting admin', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('signs the filter-options request as the admin', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));
    await fetchTarsAuditFilterOptions(ADMIN, NO_AGENTS, BASE_URL);
    expect(actingUserOf(fetchMock)).toBe(ADMIN);
  });

  it('signs the report request as the admin', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { data: [] } }));
    await fetchTarsAuditReport(
      ADMIN,
      { start_date: '2026-08-01', end_date: '2026-08-08' },
      NO_AGENTS,
      BASE_URL,
    );
    expect(actingUserOf(fetchMock)).toBe(ADMIN);
  });
});

describe('fetchTarsAuditFilterOptions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** pwc_tars sends numeric ids; every picker in the filter bar compares strings. */
  it('stringifies the pwc_tars ids and lists LibreChat agents by name', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          users: [{ id: 3, username: 'ada' }],
          domains: [{ id: 8, name: 'Finance' }],
          knowledge_bases: [{ id: 21, name: 'Tax rules' }],
        },
      }),
    );
    const directory = directoryOf([
      { id: 'agent_b', name: 'Tax helper' },
      { id: 'agent_a', name: 'Invoice bot' },
    ]);
    await expect(fetchTarsAuditFilterOptions(ADMIN, directory, BASE_URL)).resolves.toEqual({
      users: [{ id: '3', username: 'ada' }],
      agents: [
        { id: 'agent_a', name: 'Invoice bot' },
        { id: 'agent_b', name: 'Tax helper' },
      ],
      knowledge_bases: [{ id: '21', name: 'Tax rules' }],
    });
    expect(directory.findAgents).toHaveBeenCalledWith();
  });

  it('returns empty pickers when nothing is there', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: {} }));
    await expect(fetchTarsAuditFilterOptions(ADMIN, NO_AGENTS, BASE_URL)).resolves.toEqual({
      users: [],
      agents: [],
      knowledge_bases: [],
    });
  });

  /** A row without an id cannot be selected, so it must not reach the dropdown. */
  it('drops rows with no id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: { knowledge_bases: [{ name: 'orphan' }, { id: 1, name: 'Finance' }] },
      }),
    );
    const options = await fetchTarsAuditFilterOptions(ADMIN, NO_AGENTS, BASE_URL);
    expect(options.knowledge_bases).toEqual([{ id: '1', name: 'Finance' }]);
  });

  it('names an unnamed agent by its id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: {} }));
    const options = await fetchTarsAuditFilterOptions(
      ADMIN,
      directoryOf([{ id: 'agent_x', name: ' ' }]),
      BASE_URL,
    );
    expect(options.agents).toEqual([{ id: 'agent_x', name: 'agent_x' }]);
  });
});

const row = (overrides: Record<string, unknown>) => ({
  message_id: 'm-1',
  user_id: '3',
  username: 'ada',
  domain_name: 'Finance',
  user_query: 'q',
  model_response: 'a',
  conversation_id: 'c-1',
  conversation_name: 'Invoices',
  knowledge_base_name: null,
  model_name: 'gemma',
  created_at: '2026-08-02T01:00:00Z',
  upload_files: null,
  memory_document: null,
  memory_website: null,
  is_web_search: false,
  is_sql_agent: false,
  ip_address: null,
  like_counts: 0,
  dislike_counts: 0,
  comments: '',
  is_deleted: false,
  conversation_is_deleted: false,
  agent_id: null,
  ...overrides,
});

describe('fetchTarsAuditReport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const query = { start_date: '2026-08-01', end_date: '2026-08-08' };

  const respondWith = (rows: Record<string, unknown>[], feedback: unknown[] = []) =>
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(200, { success: true, data: { data: rows, feedback_data: feedback } }),
      );

  /** pwc_tars's own chats belong to its own report, so only the mirrored ones are asked for. */
  it('sends every filter pwc_tars knows, defaulting the optional ones', async () => {
    const fetchMock = respondWith([]);
    await fetchTarsAuditReport('7', query, NO_AGENTS, BASE_URL);

    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(bodyOf(fetchMock)).toEqual({
      user_id: '7',
      filter_user_ids: [],
      start_date: '2026-08-01',
      end_date: '2026-08-08',
      knowledge_base_ids: [],
      query_filter: '',
      source: 'librechat',
    });
  });

  /** pwc_tars holds agent ids, not agents, so the agent filter never goes upstream. */
  it('forwards users, knowledge bases and keyword but keeps the agent filter', async () => {
    const fetchMock = respondWith([]);
    await fetchTarsAuditReport(
      '7',
      {
        ...query,
        filter_user_ids: ['3', '4'],
        knowledge_base_ids: ['21'],
        agent_ids: ['agent_a'],
        query_filter: 'invoice',
      },
      NO_AGENTS,
      BASE_URL,
    );
    const body = bodyOf(fetchMock);
    expect(body).toMatchObject({
      filter_user_ids: ['3', '4'],
      knowledge_base_ids: ['21'],
      query_filter: 'invoice',
    });
    expect(body).not.toHaveProperty('agent_ids');
  });

  it('names each row by its saved agent and drops the brain', async () => {
    respondWith([
      row({ message_id: 'm-1', agent_id: 'agent_a' }),
      row({ message_id: 'm-2', agent_id: 'agent_a____1' }),
      row({ message_id: 'm-3', agent_id: 'ephemeral' }),
      row({ message_id: 'm-4', agent_id: 'agent_gone' }),
      row({ message_id: 'm-5', agent_id: undefined }),
    ]);
    const directory = directoryOf([{ id: 'agent_a', name: 'Invoice bot' }]);
    const report = await fetchTarsAuditReport('7', query, directory, BASE_URL);

    expect(directory.findAgents).toHaveBeenCalledWith(['agent_a', 'agent_gone']);
    expect(report.data.map((r) => [r.message_id, r.agent_id, r.agent_name])).toEqual([
      ['m-1', 'agent_a', 'Invoice bot'],
      ['m-2', 'agent_a', 'Invoice bot'],
      ['m-3', null, null],
      ['m-4', 'agent_gone', null],
      ['m-5', null, null],
    ]);
    expect(report.data[0]).not.toHaveProperty('domain_name');
  });

  /** LibreChat allows an unnamed agent; it exists, so it must not read as deleted. */
  it('names an existing but unnamed agent by its id', async () => {
    respondWith([row({ message_id: 'm-1', agent_id: 'agent_x' })]);
    const report = await fetchTarsAuditReport(
      '7',
      query,
      directoryOf([{ id: 'agent_x', name: '  ' }]),
      BASE_URL,
    );
    expect(report.data[0].agent_name).toBe('agent_x');
    expect(report.details[0].agent_name).toBe('agent_x');
  });

  it('skips the agent lookup when no row ran a saved agent', async () => {
    respondWith([row({ agent_id: null })]);
    const directory = directoryOf([]);
    await fetchTarsAuditReport('7', query, directory, BASE_URL);
    expect(directory.findAgents).not.toHaveBeenCalled();
  });

  it('filters by agent, with the no-agent value selecting chats that ran none', async () => {
    respondWith(
      [
        row({ message_id: 'm-1', agent_id: 'agent_a' }),
        row({ message_id: 'm-2', agent_id: 'agent_b' }),
        row({ message_id: 'm-3', agent_id: null }),
      ],
      [
        { message_id: 'm-1', like_count: 1 },
        { message_id: 'm-2', like_count: 1 },
      ],
    );
    const report = await fetchTarsAuditReport(
      '7',
      { ...query, agent_ids: ['agent_a', TARS_AUDIT_NO_AGENT] },
      NO_AGENTS,
      BASE_URL,
    );
    expect(report.data.map((r) => r.message_id)).toEqual(['m-1', 'm-3']);
    expect(report.total_count).toBe(2);
    expect(report.feedback_data.map((entry) => entry.message_id)).toEqual(['m-1']);
  });

  /** An older pwc_tars sends no conversation flag; the message's own status stands in. */
  it('falls back to the message status for the conversation deleted flag', async () => {
    respondWith([
      row({ message_id: 'm-1', is_deleted: true, conversation_is_deleted: undefined }),
      row({ message_id: 'm-2', is_deleted: false, conversation_is_deleted: true }),
    ]);
    const report = await fetchTarsAuditReport('7', query, NO_AGENTS, BASE_URL);
    expect(report.data.map((r) => r.conversation_is_deleted)).toEqual([true, true]);
  });

  it('rebuilds the statistics per agent from the rows it returns', async () => {
    respondWith([
      row({ message_id: 'm-1', conversation_id: 'c-1', agent_id: 'agent_a' }),
      row({ message_id: 'm-2', conversation_id: 'c-1', agent_id: 'agent_a' }),
      row({ message_id: 'm-3', conversation_id: 'c-2', agent_id: 'agent_a' }),
      row({ message_id: 'm-4', conversation_id: 'c-3', agent_id: null }),
    ]);
    const report = await fetchTarsAuditReport(
      '7',
      query,
      directoryOf([{ id: 'agent_a', name: 'Invoice bot' }]),
      BASE_URL,
    );
    expect(report.summary).toEqual({
      total_agents: 1,
      total_conversations: 3,
      total_messages: 4,
      date_range: { start_date: '2026-08-01', end_date: '2026-08-08' },
    });
    expect(report.details).toEqual([
      { agent_id: 'agent_a', agent_name: 'Invoice bot', conversation_count: 2, message_count: 3 },
      { agent_id: null, agent_name: null, conversation_count: 1, message_count: 1 },
    ]);
  });

  /**
   * When no domain matches the knowledge-base filter pwc_tars short-circuits with
   * only `total_count` and `data`, so the rest has to default rather than throw.
   */
  it('tolerates the short-circuited empty response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { total_count: 0, data: [] } }));
    await expect(fetchTarsAuditReport('7', query, NO_AGENTS, BASE_URL)).resolves.toEqual({
      total_count: 0,
      data: [],
      feedback_data: [],
      summary: {
        total_agents: 0,
        total_conversations: 0,
        total_messages: 0,
        date_range: { start_date: '2026-08-01', end_date: '2026-08-08' },
      },
      details: [],
    });
  });

  it('relays the pwc_tars message when the date range is rejected', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { message: '起始日期不能晚於結束日期' }));
    await expect(fetchTarsAuditReport('7', query, NO_AGENTS, BASE_URL)).rejects.toMatchObject({
      status: 400,
      serverMessage: '起始日期不能晚於結束日期',
    });
  });
});

describe('fetchTarsAuditFilterOptions blank names', () => {
  afterEach(() => jest.restoreAllMocks());

  /**
   * `display_name` and friends are nullable strings in pwc_tars, so an unset
   * one can come back as `''`. A blank label sorts to the top of the picker and
   * reads as an empty row, so the id stands in instead.
   */
  it('falls back past an empty name to the id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        data: {
          users: [
            { id: 7, name: '', username: '' },
            { id: 8, name: null, username: 'amy' },
          ],
          knowledge_bases: [],
        },
      }),
    );

    const options = await fetchTarsAuditFilterOptions(ADMIN, NO_AGENTS, BASE_URL);

    expect(options.users).toEqual([
      { id: '7', username: '7' },
      { id: '8', username: 'amy' },
    ]);
  });
});

describe('fetchTarsMessageTrace', () => {
  afterEach(() => jest.restoreAllMocks());

  const message = {
    id: 'm/1',
    conversation_id: 'c-1',
    model_name: 'gpt-5.4-mini',
    created_at: '2026-09-01T00:00:00Z',
    ip_addr: null,
    query: 'q',
    response: 'a',
    status: 1,
    error_message: null,
    response_latency: 1.5,
  };

  it('requests the encoded message id as the acting admin and relays the body', async () => {
    const trace = [{ id: 't-1', seq: 1, event_type: 'request', payload: { query: 'q' } }];
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          message,
          user: null,
          trace,
          unapplied_regenerate_count: 2,
          conversation_history: [{ role: 'user', content: 'hi' }],
        },
      }),
    );

    const result = await fetchTarsMessageTrace('42', 'm/1', BASE_URL);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/settings/get_message_execution_trace/m%2F1`,
    );
    expect(actingUserOf(fetchMock)).toBe('42');
    expect(result).toMatchObject({ message, trace, unapplied_regenerate_count: 2 });
    expect(result.conversation_history).toHaveLength(1);
  });

  it('drops rows it cannot read and holds the rest to their types', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          message,
          user: 'amy',
          trace: [null, 'row', { id: 't-1', event_type: 'text', payload: 'x', ok: 'yes' }],
          conversation_history: [{ role: 'user', content: 'hi' }, 'stray'],
        },
      }),
    );
    const result = await fetchTarsMessageTrace('42', 'm-1', BASE_URL);
    expect(result.user).toBeNull();
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({
      id: 't-1',
      event_type: 'text',
      payload: null,
      ok: null,
    });
    expect(result.conversation_history).toEqual([{ role: 'user', content: 'hi' }]);
  });

  /** An older pwc_tars may omit the optional parts; the UI reads them without guards. */
  it('defaults the optional parts', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { message, user: null } }));
    await expect(fetchTarsMessageTrace('42', 'm-1', BASE_URL)).resolves.toMatchObject({
      trace: [],
      unapplied_regenerate_count: 0,
      conversation_history: [],
    });
  });

  /** The route relays a 4xx as-is: 404 is how the dialog tells "message is gone" apart. */
  it('keeps the 404 status when the message no longer exists', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(404, { success: false, message: 'Message not found' }));
    await expect(fetchTarsMessageTrace('42', 'missing', BASE_URL)).rejects.toMatchObject({
      status: 404,
      serverMessage: 'Message not found',
    });
  });

  it('rejects a body without a message rather than rendering a blank trace', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: {} }));
    await expect(fetchTarsMessageTrace('42', 'm-1', BASE_URL)).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe('downloadTarsAuditMemoryDocument', () => {
  afterEach(() => jest.restoreAllMocks());

  it('streams the bytes with the upstream content headers', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('%PDF', {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename=a.pdf',
        },
      }),
    );

    const file = await downloadTarsAuditMemoryDocument('42', 'doc 1', BASE_URL);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) {
      chunks.push(Buffer.from(chunk));
    }

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/settings/download_memory_document_for_audit/doc%201`,
    );
    expect(actingUserOf(fetchMock)).toBe('42');
    expect(Buffer.concat(chunks).toString()).toBe('%PDF');
    expect(file.contentType).toBe('application/pdf');
    expect(file.disposition).toBe('attachment; filename=a.pdf');
  });

  it("relays pwc_tars's reason when the file is gone", async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(404, { success: false, message: '原始檔案已不存在' }));
    await expect(downloadTarsAuditMemoryDocument('42', 'doc-1', BASE_URL)).rejects.toMatchObject({
      status: 404,
      serverMessage: '原始檔案已不存在',
    });
  });
});

/** What a handler wrote, piped bytes included; it finishes when the response ends. */
class CapturedResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';
  private started = false;

  get headersSent(): boolean {
    return this.started;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /** Refuses what Node refuses, so a header the real response would reject fails here too. */
  setHeader(name: string, value: string): this {
    validateHeaderValue(name, value);
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  json(body: unknown): this {
    return this.send(JSON.stringify(body));
  }

  send(body: string | Buffer): this {
    this.started = true;
    this.body += body.toString();
    this.end();
    return this;
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    this.started = true;
    this.body += chunk.toString();
    done();
  }
}

describe('createTarsAuditDocumentHandler', () => {
  type StoredFile = TarsAuditStoredFile & { text?: string };
  const stored: Record<string, StoredFile> = {
    'sheet-1': { file_id: 'sheet-1', filename: '銷售 Q3.xlsx', filepath: '/uploads/u/sheet-1' },
    'report-1': {
      file_id: 'report-1',
      filename: 'report.pdf',
      filepath: 's3-url',
      storageKey: 'k/1',
    },
    'pasted-1': {
      file_id: 'pasted-1',
      filename: 'notes.txt',
      filepath: '',
      source: FileSources.text,
      text: 'hello',
    },
    'vector-1': {
      file_id: 'vector-1',
      filename: 'kb.pdf',
      filepath: '',
      source: FileSources.vectordb,
    },
  };
  const openStream = jest.fn(async (_req: unknown, filepath: string) =>
    Readable.from([`bytes of ${filepath}`]),
  );
  const getDownloadStream = jest.fn((source: string) =>
    source === FileSources.vectordb ? null : openStream,
  );
  /** Every id the tests download is named by the audited message's trace, except `unlisted-1`. */
  const named = [...Object.keys(stored), 'odd-1', 'memory-doc-1'];
  const auditedTrace = {
    message: { id: 'm-1' },
    trace: [
      {
        event_type: 'long_term_memory',
        payload: { documents: named.map((file_id) => ({ id: null, file_id })) },
      },
    ],
  } as unknown as TTarsMessageTrace;
  const loadTrace = jest.fn(async () => auditedTrace);
  const handler = createTarsAuditDocumentHandler<StoredFile>({
    findFile: async (fileId) => stored[fileId] ?? null,
    readText: async (file) => file.text,
    getDownloadStream,
    loadTrace,
  });

  const download = async (documentId: string, messageId: string | null = 'm-1') => {
    const res = new CapturedResponse();
    await handler(
      {
        params: { documentId },
        query: messageId == null ? {} : { messageId },
        user: { tarsId: '42' },
      } as unknown as Parameters<typeof handler>[0],
      res as unknown as ExpressResponse,
    );
    await finished(res);
    return res;
  };

  beforeEach(() => {
    process.env.TARS_AUTH_URL = BASE_URL;
    jest.clearAllMocks();
  });
  afterEach(() => jest.restoreAllMocks());

  it('streams a LibreChat attachment from its own storage, local by default', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await download('sheet-1');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('bytes of /uploads/u/sheet-1');
    expect(getDownloadStream).toHaveBeenCalledWith(FileSources.local);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('銷售 Q3.xlsx'));
    expect(res.headers['cache-control']).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a stored object by its key rather than its URL', async () => {
    expect((await download('report-1')).body).toBe('bytes of k/1');
  });

  it('sends a text-only file as its text', async () => {
    const res = await download('pasted-1');
    expect(res.body).toBe('hello');
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(openStream).not.toHaveBeenCalled();
  });

  it('refuses a LibreChat file its storage cannot stream instead of asking pwc_tars', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await download('vector-1');
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'document_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads any other id from pwc_tars as the acting admin', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }),
      );

    const res = await download('memory-doc-1');

    expect(res.body).toBe('%PDF');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(actingUserOf(fetchMock)).toBe('42');
    expect(loadTrace).toHaveBeenCalledWith('42', 'm-1');
  });

  it('refuses a file the audited message does not name, before touching any storage', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const res = await download('unlisted-1');
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'document_not_found' });
    expect(openStream).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the audited message, so a file id alone downloads nothing', async () => {
    const res = await download('sheet-1', null);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'request_rejected' });
    expect(loadTrace).not.toHaveBeenCalled();
    expect(openStream).not.toHaveBeenCalled();
  });

  it('refuses when pwc_tars no longer grants this account admin access', async () => {
    loadTrace.mockRejectedValueOnce(new TarsRequestError(403, 'trace', 'forbidden'));
    const res = await download('sheet-1');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'not_tars_admin' });
    expect(openStream).not.toHaveBeenCalled();
  });

  it('still downloads when pwc_tars names the file in a header Node cannot send', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      /** Real `Headers` refuse such a value; a fake stands in for a pwc_tars header Node rejects. */
      headers: {
        get: (name: string) =>
          ({
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename=報告.pdf',
          })[name] ?? null,
      } as unknown as Headers,
      body: new Response('%PDF').body,
    } as Response);

    const res = await download('memory-doc-1');

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('%PDF');
    expect(res.headers['content-disposition']).toBe("attachment; filename*=UTF-8''memory-doc-1");
  });

  it('reads a file whose storage source is not a name as local storage', async () => {
    stored['odd-1'] = {
      file_id: 'odd-1',
      filename: '',
      filepath: '/uploads/u/odd-1',
      source: 5 as never,
    };
    const res = await download('odd-1');
    expect(res.statusCode).toBe(200);
    expect(getDownloadStream).toHaveBeenCalledWith(FileSources.local);
    expect(res.headers['content-disposition']).toBe("attachment; filename*=UTF-8''download");
  });

  it("answers with pwc_tars's reason when it has no such document", async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(404, { success: false, message: '原始檔案已不存在' }));
    const res = await download('memory-doc-1');
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({
      code: 'document_not_found',
      error: 'Not found on the server',
      detail: '原始檔案已不存在',
    });
  });

  it('says the storage failed, not pwc_tars, when the storage cannot open the file', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    openStream.mockRejectedValueOnce(new Error('ENOENT'));
    const res = await download('sheet-1');
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      code: 'storage_failed',
      error: 'The file storage could not be read',
      detail: 'ENOENT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('tarsAuditErrorReply', () => {
  const classify = (error: unknown) => tarsAuditErrorReply(error, 'message_not_found');
  const tars = (status: number, detail?: string) => new TarsRequestError(status, '/x', detail);

  /** Only LibreChat's own refusal names the secret; a 503 from pwc_tars or its proxy is pwc_tars failing. */
  it('names a missing or rejected admin signature as the setting to fix', () => {
    expect(classify(tars(503, 'TARS_JWT_SECRET is not configured'))).toMatchObject({
      status: 503,
      code: 'secret_missing',
    });
    expect(classify(tars(503, 'Service Unavailable'))).toMatchObject({
      status: 502,
      code: 'tars_failed',
      detail: 'Service Unavailable',
    });
    expect(classify(tars(403, 'admin only'))).toMatchObject({
      status: 403,
      code: 'not_tars_admin',
      detail: 'admin only',
    });
  });

  /** A relayed 401 would make the browser refresh a LibreChat session that is fine. */
  it('never answers 401 for pwc_tars refusing the signed bearer', () => {
    expect(classify(tars(401, 'Token is invalid'))).toEqual({
      status: 502,
      code: 'credentials_rejected',
      error: 'The server rejected the signed admin request',
      detail: 'Token is invalid',
    });
  });

  it('tells a missing message from a malformed answer and a pwc_tars failure', () => {
    expect(classify(tars(404))).toMatchObject({ status: 404, code: 'message_not_found' });
    expect(tarsAuditErrorReply(tars(404), 'document_not_found').code).toBe('document_not_found');
    expect(classify(tars(502, 'Malformed trace response'))).toMatchObject({
      status: 502,
      code: 'bad_response',
    });
    expect(classify(tars(500, 'db down'))).toMatchObject({
      status: 502,
      code: 'tars_failed',
      detail: 'db down',
    });
    expect(classify(tars(422, 'bad id'))).toMatchObject({ status: 422, code: 'request_rejected' });
    expect(classify(new SyntaxError('Unexpected token <'))).toMatchObject({ code: 'bad_response' });
  });

  it('tells pwc_tars being down, slow or unconfigured apart', () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    });
    expect(classify(refused)).toEqual({
      status: 502,
      code: 'tars_unreachable',
      error: 'The server could not be reached',
      detail: 'ECONNREFUSED',
    });
    const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(classify(timeout)).toMatchObject({ status: 504, code: 'tars_timeout' });
    expect(classify(new Error('TARS_AUTH_URL is not configured'))).toMatchObject({
      status: 503,
      code: 'not_configured',
    });
    expect(classify(new Error('boom'))).toEqual({
      status: 500,
      code: 'internal',
      error: 'Unexpected error',
    });
  });
});

describe('tarsTraceNamesDocument', () => {
  const traceOf = (payloads: unknown[]) =>
    ({ trace: payloads.map((payload) => ({ payload })) }) as unknown as TTarsMessageTrace;

  it('finds a thread file by file_id and a memory document by id', () => {
    const trace = traceOf([
      { documents: [{ id: null, file_id: 'f-1' }, { id: 7 }] },
      { payload: { upload_files: [{ file_id: 'up-1', filename: 'a.png' }] } },
      null,
    ]);
    expect(tarsTraceNamesDocument(trace, 'f-1')).toBe(true);
    expect(tarsTraceNamesDocument(trace, '7')).toBe(true);
    expect(tarsTraceNamesDocument(trace, 'up-1')).toBe(true);
    expect(tarsTraceNamesDocument(trace, 'other')).toBe(false);
  });
});
