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
import { FileSources } from 'librechat-data-provider';
import type { Response as ExpressResponse } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import type { TarsAuditStoredFile } from './audit';
import {
  fetchTarsAuditReport,
  fetchTarsMessageTrace,
  fetchTarsAuditFilterOptions,
  tarsAuditErrorReply,
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

/** pwc_tars gates both audit routes behind `@admin_required`. */
describe('audit requests carry the acting admin', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('signs the filter-options request as the admin', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: {} }));
    await fetchTarsAuditFilterOptions(ADMIN, BASE_URL);
    expect(actingUserOf(fetchMock)).toBe(ADMIN);
  });

  it('signs the report request as the admin', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { data: [] } }));
    await fetchTarsAuditReport(
      ADMIN,
      { start_date: '2026-08-01', end_date: '2026-08-08' },
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
  it('stringifies the ids of all three pickers', async () => {
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
    await expect(fetchTarsAuditFilterOptions(ADMIN, BASE_URL)).resolves.toEqual({
      users: [{ id: '3', username: 'ada' }],
      domains: [{ id: '8', name: 'Finance' }],
      knowledge_bases: [{ id: '21', name: 'Tax rules' }],
    });
  });

  it('returns empty pickers when pwc_tars omits them', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: {} }));
    await expect(fetchTarsAuditFilterOptions(ADMIN, BASE_URL)).resolves.toEqual({
      users: [],
      domains: [],
      knowledge_bases: [],
    });
  });

  /** A row without an id cannot be selected, so it must not reach the dropdown. */
  it('drops rows with no id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: { domains: [{ name: 'orphan' }, { id: 1, name: 'Finance' }] },
      }),
    );
    const options = await fetchTarsAuditFilterOptions(ADMIN, BASE_URL);
    expect(options.domains).toEqual([{ id: '1', name: 'Finance' }]);
  });
});

describe('fetchTarsAuditReport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const query = { start_date: '2026-08-01', end_date: '2026-08-08' };

  it('sends every filter, defaulting the optional ones', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { data: [] } }));
    await fetchTarsAuditReport('7', query, BASE_URL);

    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(bodyOf(fetchMock)).toEqual({
      user_id: '7',
      filter_user_ids: [],
      start_date: '2026-08-01',
      end_date: '2026-08-08',
      domain_id: '',
      knowledge_base_ids: [],
      query_filter: '',
    });
  });

  /** pwc_tars treats a null `domain_id` as "no filter" only when it arrives blank. */
  it('sends a blank domain_id rather than null', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { data: [] } }));
    await fetchTarsAuditReport('7', { ...query, domain_id: null }, BASE_URL);
    expect(bodyOf(fetchMock).domain_id).toBe('');
  });

  it('forwards the selected users, knowledge bases and keyword', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { data: [] } }));
    await fetchTarsAuditReport(
      '7',
      {
        ...query,
        filter_user_ids: ['3', '4'],
        knowledge_base_ids: ['21'],
        domain_id: '8',
        query_filter: 'invoice',
      },
      BASE_URL,
    );
    expect(bodyOf(fetchMock)).toMatchObject({
      filter_user_ids: ['3', '4'],
      knowledge_base_ids: ['21'],
      domain_id: '8',
      query_filter: 'invoice',
    });
  });

  /** The plotting arrays only restate `details`, so only summary/details survive. */
  it('flattens chart_data down to the summary and the per-brain rollup', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          total_count: 1,
          data: [{ message_id: 'm-1' }],
          feedback_data: [{ message_id: 'm-1', like_count: 1 }],
          chart_data: {
            bar_chart: { labels: ['Finance'], conversation_data: [2], message_data: [5] },
            pie_chart: { labels: ['Finance'], data: [5] },
            summary: {
              total_domains: 1,
              total_conversations: 2,
              total_messages: 5,
              date_range: { start_date: '2026-08-01', end_date: '2026-08-08' },
            },
            details: [
              {
                domain_name: 'Finance',
                conversation_count: 2,
                message_count: 5,
                knowledge_bases: [{ id: 21, name: 'Tax rules' }],
                conversations: [{ conversation_id: 'c-1', messages: [{ message_id: 'm-1' }] }],
              },
            ],
          },
        },
      }),
    );

    const report = await fetchTarsAuditReport('7', query, BASE_URL);
    expect(report.summary?.total_messages).toBe(5);
    expect(report.details).toEqual([
      {
        domain_name: 'Finance',
        conversation_count: 2,
        message_count: 5,
        knowledge_bases: [{ id: 21, name: 'Tax rules' }],
      },
    ]);
    expect(report.feedback_data).toHaveLength(1);
  });

  /**
   * When no domain matches the knowledge-base filter pwc_tars short-circuits with
   * only `total_count` and `data`, so the rest has to default rather than throw.
   */
  it('tolerates the short-circuited empty response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { total_count: 0, data: [] } }));
    await expect(fetchTarsAuditReport('7', query, BASE_URL)).resolves.toEqual({
      total_count: 0,
      data: [],
      feedback_data: [],
      summary: null,
      details: [],
    });
  });

  it('relays the pwc_tars message when the date range is rejected', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { message: '起始日期不能晚於結束日期' }));
    await expect(fetchTarsAuditReport('7', query, BASE_URL)).rejects.toMatchObject({
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
          domains: [],
          knowledge_bases: [],
        },
      }),
    );

    const options = await fetchTarsAuditFilterOptions(ADMIN, BASE_URL);

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

  it('returns the bytes with the upstream content headers', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename=a.pdf',
      }),
      arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer,
    } as Response);

    const file = await downloadTarsAuditMemoryDocument('42', 'doc 1', BASE_URL);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/settings/download_memory_document_for_audit/doc%201`,
    );
    expect(actingUserOf(fetchMock)).toBe('42');
    expect(file.buffer.toString()).toBe('%PDF');
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
  const handler = createTarsAuditDocumentHandler<StoredFile>({
    findFile: async (fileId) => stored[fileId] ?? null,
    readText: async (file) => file.text,
    getDownloadStream,
  });

  const download = async (documentId: string) => {
    const res = new CapturedResponse();
    await handler(
      { params: { documentId }, user: { tarsId: '42' } } as unknown as Parameters<
        typeof handler
      >[0],
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
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer,
    } as Response);

    const res = await download('memory-doc-1');

    expect(res.body).toBe('%PDF');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(actingUserOf(fetchMock)).toBe('42');
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
      arrayBuffer: async () => new TextEncoder().encode('%PDF').buffer,
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
