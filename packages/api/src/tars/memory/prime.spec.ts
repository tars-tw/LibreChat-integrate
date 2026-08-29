jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { primeTarsMemory, getTarsMemorySnapshot, buildTarsMemoryContext } from './prime';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const row = (overrides: Record<string, unknown>) => ({
  id: 'doc-1',
  conversation_id: 'tars-conv-1',
  filename: 'report.pdf',
  extension: 'pdf',
  mime_type: 'application/pdf',
  size: 2048,
  status: 1,
  word_count: 100,
  tokens: 500,
  summary: '報告內容',
  created_by: USER_ID,
  created_at: null,
  ...overrides,
});

const request = () => ({
  user: { tarsId: USER_ID },
  tarsConversationId: 'tars-conv-1',
});

const mockList = (documents: unknown[]) =>
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(
      buildResponse(200, { success: true, data: { documents, token_used: 0, token_limit: 0 } }),
    );

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  delete process.env.TARS_MEMORY_CONTEXT_MAX_CHARS;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('primeTarsMemory', () => {
  it('splits active documents into prompt context and structured tool files', async () => {
    mockList([
      row({}),
      row({ id: 'doc-2', filename: 'orders.xlsx', extension: 'xlsx', summary: 'sheet preview' }),
      row({ id: 'doc-3', filename: 'off.pdf', status: 0, summary: '排除的內容' }),
    ]);
    const req = request();
    const snapshot = await primeTarsMemory(req);
    const context = buildTarsMemoryContext(snapshot);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.activeDocuments.map((doc) => doc.id)).toEqual(['doc-1', 'doc-2']);
    expect(snapshot?.structuredDocuments.map((doc) => doc.id)).toEqual(['doc-2']);
    expect(context.contextText).toContain('report.pdf');
    expect(context.contextText).toContain('報告內容');
    expect(context.contextText).not.toContain('排除的內容');
    expect(context.contextText).not.toContain('sheet preview');
    expect(context.dataContextText).toContain('orders.xlsx (document_id: doc-2)');
    expect(getTarsMemorySnapshot(req)).toBe(snapshot);
  });

  it('fetches once per request even when several agents prime the same turn', async () => {
    const fetchMock = mockList([row({})]);
    const req = request();

    const [first, second] = await Promise.all([primeTarsMemory(req), primeTarsMemory(req)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(await primeTarsMemory(req)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps the context proportionally across files', async () => {
    process.env.TARS_MEMORY_CONTEXT_MAX_CHARS = '100';
    mockList([
      row({ id: 'doc-1', filename: 'a.pdf', summary: 'A'.repeat(400) }),
      row({ id: 'doc-2', filename: 'b.pdf', summary: 'B'.repeat(400) }),
    ]);
    const { contextText } = buildTarsMemoryContext(await primeTarsMemory(request()));

    expect(contextText).toContain('[truncated]');
    const aChars = (contextText?.match(/A/g) ?? []).length;
    const bChars = (contextText?.match(/B/g) ?? []).length;
    expect(aChars).toBeLessThanOrEqual(50);
    expect(bChars).toBeLessThanOrEqual(50);
    expect(aChars).toBeGreaterThan(0);
    expect(bChars).toBeGreaterThan(0);
  });

  it('resolves null without a linked user or tars conversation', async () => {
    const fetchMock = mockList([]);
    await expect(primeTarsMemory({ user: { tarsId: USER_ID } })).resolves.toBeNull();
    await expect(primeTarsMemory({ tarsConversationId: 'tars-conv-1' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails soft when pwc_tars errors', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(primeTarsMemory(request())).resolves.toBeNull();
  });

  it('produces no context blocks for an empty memory', async () => {
    mockList([]);
    const snapshot = await primeTarsMemory(request());
    const context = buildTarsMemoryContext(snapshot);
    expect(context.contextText).toBeNull();
    expect(context.dataContextText).toBeNull();
    expect(snapshot?.structuredDocuments).toEqual([]);
  });

  it('clamps the context to a share of the model context window', async () => {
    mockList([row({ id: 'doc-1', filename: 'a.pdf', summary: 'A'.repeat(4000) })]);
    const snapshot = await primeTarsMemory(request());

    /** 1000 tokens * 0.5 * 2 chars = 1000 chars, well under the 400k default. */
    const clamped = buildTarsMemoryContext(snapshot, 1000);
    expect(clamped.contextText).toContain('[truncated]');
    expect((clamped.contextText?.match(/A/g) ?? []).length).toBeLessThanOrEqual(1000);

    const unclamped = buildTarsMemoryContext(snapshot);
    expect(unclamped.contextText).not.toContain('[truncated]');
    expect((unclamped.contextText?.match(/A/g) ?? []).length).toBe(4000);
  });
});
