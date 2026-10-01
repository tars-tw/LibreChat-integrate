jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { invalidateTarsSysConfigCache } from '~/tars/sysconfig';
import { TarsRequestError } from '~/tars/client';
import { runTarsBuiltinTool } from './client';

const BASE_URL = 'http://tars.test';
const TOOL_URL = `${BASE_URL}/api/langflow-service/tools/run_table_task`;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** An SSE body delivered in the given chunks, so frames can straddle reads. */
const sseResponse = (chunks: string[]): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

const result = { content: '已完成 3 / 3 列', summary: '3 rows', sources: [], generated_urls: [] };

const mockBackend = (tool: (url: string, init?: RequestInit) => Response) =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/api/settings/list_sys_configs')) {
      return jsonResponse(200, [
        { key: 'KEY_LANGFLOW_API_KEY', value: 'service-key', status: 'active' },
      ]);
    }
    if (url.startsWith(TOOL_URL)) {
      return tool(url, init ?? undefined);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const run = (options: Partial<Parameters<typeof runTarsBuiltinTool>[1]> = {}) =>
  runTarsBuiltinTool('run_table_task', {
    inputs: { instruction: 'x' },
    context: { knowledge_base_ids: 'kb-1' },
    longRunning: true,
    librechatUserId: 'lc-user',
    ...options,
  });

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsSysConfigCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('runTarsBuiltinTool', () => {
  it('relays progress as it streams, then returns the result', async () => {
    const whole =
      ': keepalive\n\n' +
      frame({ type: 'progress', kind: 'table_task', message: '正在從知識庫檢索所有文件…' }) +
      frame({ type: 'progress', kind: 'table_task', message: '目前正在處理第 1-2 列，共 3 列…' }) +
      frame({ type: 'result', data: result });
    const cut = whole.indexOf('目前') + 3;
    const fetchMock = mockBackend(() => sseResponse([whole.slice(0, cut), whole.slice(cut)]));
    const progress: string[] = [];

    const output = await run({ onProgress: (message) => progress.push(message) });

    expect(progress).toEqual(['正在從知識庫檢索所有文件…', '目前正在處理第 1-2 列，共 3 列…']);
    expect(output).toMatchObject({
      content: '已完成 3 / 3 列',
      summary: '3 rows',
      is_error: false,
    });
    const [url, init] = fetchMock.mock.calls.find(([called]) =>
      String(called).startsWith(TOOL_URL),
    )!;
    expect(url).toBe(`${TOOL_URL}/stream`);
    expect((init as RequestInit).headers).toMatchObject({
      'X-TARS-Service-Key': 'service-key',
      'X-Use-Librechat-Gateway': 'true',
      'X-Librechat-User-Id': 'lc-user',
      Accept: 'text/event-stream',
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      inputs: { instruction: 'x' },
      context: { knowledge_base_ids: 'kb-1' },
    });
  });

  it('raises the failure pwc_tars streamed, with its own message', async () => {
    mockBackend(() =>
      sseResponse([
        frame({ type: 'progress', message: '正在檢索…' }),
        frame({ type: 'error', message: '模型配額已用盡', error_code: 'rate_limit', status: 429 }),
      ]),
    );
    const error = await run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TarsRequestError);
    expect(error).toMatchObject({ status: 429, serverMessage: '模型配額已用盡' });
  });

  it('falls back to the JSON route on a pwc_tars without the stream route', async () => {
    const fetchMock = mockBackend((url) =>
      url.endsWith('/stream')
        ? new Response('<h1>Not Found</h1>', {
            status: 404,
            headers: { 'Content-Type': 'text/html' },
          })
        : jsonResponse(200, { success: true, data: result }),
    );
    await expect(run()).resolves.toMatchObject({ content: '已完成 3 / 3 列' });
    expect(
      fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(TOOL_URL)),
    ).toEqual([`${TOOL_URL}/stream`, TOOL_URL]);
  });

  it('does not retry a tool the stream route refused', async () => {
    const fetchMock = mockBackend(() =>
      sseResponse([frame({ type: 'error', message: '找不到工具', status: 404 })]),
    );
    await expect(run()).rejects.toMatchObject({ status: 404, serverMessage: '找不到工具' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith(TOOL_URL))).toHaveLength(
      1,
    );
  });

  it('closes the connection when a frame cannot be read, so pwc_tars stops the tool', async () => {
    const cancelled = jest.fn();
    mockBackend(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {not json\n\n'));
        },
        cancel: cancelled,
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    await expect(run()).rejects.toThrow(SyntaxError);
    expect(cancelled).toHaveBeenCalled();
  });

  it('fails when the stream ends without a result', async () => {
    mockBackend(() => sseResponse([frame({ type: 'progress', message: 'x' })]));
    await expect(run()).rejects.toThrow('without a result');
  });

  it('passes the caller’s abort through to the request', async () => {
    const controller = new AbortController();
    mockBackend((_url, init) => {
      expect(init?.signal?.aborted).toBe(false);
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(run({ signal: controller.signal })).rejects.toThrow('aborted');
  });
});
