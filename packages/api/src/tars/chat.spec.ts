jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { logger } from '@librechat/data-schemas';
import { ContentTypes, TARS_MESSAGE_STATUS } from 'librechat-data-provider';
import type { TarsChatMirrorDeps, TarsMirrorRequest } from './chat';
import type { TarsTurnSource } from './mirror';
import { noteTarsMcpToolCall, noteTarsMcpToolError } from './failure';
import { createTarsChatMirror } from './chat';

const BASE_URL = 'http://tars.test';

type Posted = { path: string; body: Record<string, unknown> };

/** Answers pwc_tars like the real routes and keeps what each call posted. */
function mockTars({ createdId = 'tc-new' }: { createdId?: string | null } = {}) {
  const posted: Posted[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    const path = String(url).replace(BASE_URL, '');
    posted.push({ path, body: JSON.parse(String((init as RequestInit).body ?? '{}')) });
    const body = path.endsWith('/create_conversation')
      ? { conversation: createdId ? { id: createdId } : {} }
      : {};
    return { status: 200, ok: true, json: async () => body } as Response;
  });
  return {
    posted,
    message: () => posted.find((call) => call.path.endsWith('/create_message'))?.body,
    paths: () => posted.map((call) => call.path),
  };
}

const makeDeps = (overrides: Partial<TarsChatMirrorDeps> = {}): TarsChatMirrorDeps => ({
  getConvo: jest.fn(async () => null),
  saveConvo: jest.fn(async () => ({})),
  getMessages: jest.fn(async () => []),
  ...overrides,
});

const makeReq = (overrides: Partial<TarsMirrorRequest> = {}): TarsMirrorRequest => ({
  user: { id: 'lc-user', tarsId: 'tars-user' },
  body: { parentMessageId: 'parent-1', endpoint: 'agents' },
  ip: '::ffff:10.0.0.1',
  turnStartedAt: Date.now() - 2_000,
  ...overrides,
});

const answer = (text: string): TarsTurnSource => ({
  response: { text, content: [{ type: ContentTypes.TEXT, text }] },
});

let convoSeq = 0;
const nextConvo = () => `convo-${++convoSeq}`;

describe('createTarsChatMirror', () => {
  const env = process.env.TARS_AUTH_URL;
  beforeEach(() => {
    process.env.TARS_AUTH_URL = BASE_URL;
  });
  afterEach(() => {
    process.env.TARS_AUTH_URL = env;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('mirrors nothing when TARS is off, the account is unlinked or the turn has no query', async () => {
    const tars = mockTars();
    const mirror = createTarsChatMirror(makeDeps());
    const input = { conversationId: nextConvo(), query: 'hi', turn: answer('hello') };

    delete process.env.TARS_AUTH_URL;
    await mirror(makeReq(), input);
    process.env.TARS_AUTH_URL = BASE_URL;
    await mirror(makeReq({ user: { id: 'lc-user', tarsId: null } }), input);
    await mirror(makeReq(), { ...input, query: '' });

    expect(tars.posted).toHaveLength(0);
  });

  it('creates and links the pwc_tars conversation on the first turn, then posts the message', async () => {
    const tars = mockTars({ createdId: 'tc-1' });
    const deps = makeDeps();
    const conversationId = nextConvo();

    await createTarsChatMirror(deps)(makeReq(), {
      conversationId,
      title: 'Flights',
      model: 'gpt-5.4-mini',
      domainId: '7',
      query: 'Taipei to Narita?',
      messageId: 'msg-1',
      turn: answer('Two flights a day.'),
      outcome: {},
    });

    expect(tars.paths()).toEqual([
      '/api/conversation/create_conversation',
      '/api/message/create_message',
    ]);
    expect(deps.saveConvo).toHaveBeenCalledWith(
      { userId: 'lc-user' },
      { conversationId, tarsConversationId: 'tc-1' },
      expect.any(Object),
    );
    const message = tars.message();
    expect(message).toMatchObject({
      conversation_id: 'tc-1',
      query: 'Taipei to Narita?',
      response: 'Two flights a day.',
      model_name: 'gpt-5.4-mini',
      status: TARS_MESSAGE_STATUS.success,
      ip_addr: '10.0.0.1',
    });
    expect(message?.response_latency).toBeGreaterThan(0);
    expect((message?.trace as { type: string }[])[0]).toMatchObject({
      type: 'request',
      source: 'librechat',
      domain_id: '7',
    });
  });

  it('reuses an existing link and only pushes the title', async () => {
    const tars = mockTars();
    const deps = makeDeps({ getConvo: jest.fn(async () => ({ tarsConversationId: 'tc-old' })) });

    await createTarsChatMirror(deps)(makeReq(), {
      conversationId: nextConvo(),
      title: 'Renamed',
      query: 'q',
      turn: answer('a'),
    });

    expect(tars.paths()).toEqual([
      expect.stringMatching(/^\/api\/conversation\/update_conversation\/tc-old/),
      '/api/message/create_message',
    ]);
    expect(tars.message()?.conversation_id).toBe('tc-old');
  });

  it('stops without a message when pwc_tars returns no conversation id', async () => {
    const tars = mockTars({ createdId: null });
    const deps = makeDeps();

    await createTarsChatMirror(deps)(makeReq(), {
      conversationId: nextConvo(),
      query: 'q',
      turn: answer('a'),
    });

    expect(tars.paths()).toEqual(['/api/conversation/create_conversation']);
    expect(deps.saveConvo).not.toHaveBeenCalled();
  });

  it('names a turn of attachments alone by its files and keeps their download ids', async () => {
    const tars = mockTars();

    await createTarsChatMirror(makeDeps())(makeReq(), {
      conversationId: nextConvo(),
      query: '',
      turn: {
        ...answer('Read both.'),
        files: [
          { file_id: 'f-pdf', filename: 'a.pdf', type: 'application/pdf' },
          { file_id: 'f-img', filename: 'b.png', type: 'image/png' },
        ],
      },
    });

    const message = tars.message();
    expect(message?.query).toBe('a.pdf, b.png');
    const trace = message?.trace as {
      type: string;
      payload?: unknown;
      image_input_count?: number;
    }[];
    expect(trace.find((record) => record.type === 'request_raw')?.payload).toMatchObject({
      upload_files: [
        { file_id: 'f-pdf', filename: 'a.pdf' },
        { file_id: 'f-img', filename: 'b.png' },
      ],
    });
    expect(trace.find((record) => record.type === 'provenance')?.image_input_count).toBe(1);
  });

  it('falls back to the model the saved agent ran', async () => {
    const tars = mockTars();

    await createTarsChatMirror(makeDeps())(makeReq(), {
      conversationId: nextConvo(),
      query: 'q',
      turn: answer('a'),
      agent: { model_parameters: { model: 'gpt-5.4-mini', apiKey: 'sk-secret' } },
    });

    const message = tars.message();
    expect(message?.model_name).toBe('gpt-5.4-mini');
    expect(JSON.stringify(message)).not.toContain('sk-secret');
  });

  it('records a failed turn with its error and no estimated tokens', async () => {
    const tars = mockTars();

    await createTarsChatMirror(makeDeps())(makeReq(), {
      conversationId: nextConvo(),
      query: 'q',
      turn: { errorText: '400 bad parameter' },
      tokenEstimate: { promptTokens: 120, completionTokens: 0 },
    });

    expect(tars.message()).toMatchObject({
      status: TARS_MESSAGE_STATUS.failed,
      error_message: '400 bad parameter',
      message_tokens: 0,
      response_tokens: 0,
    });
  });

  it('records a stopped turn as interrupted and bills LibreChat’s own count', async () => {
    const tars = mockTars();

    await createTarsChatMirror(makeDeps())(makeReq(), {
      conversationId: nextConvo(),
      query: 'q',
      turn: { ...answer('partial'), unfinished: true },
      tokenEstimate: { promptTokens: 120, completionTokens: 30 },
      outcome: { aborted: true },
    });

    expect(tars.message()).toMatchObject({
      status: TARS_MESSAGE_STATUS.interrupted,
      message_tokens: 120,
      response_tokens: 30,
    });
  });

  it('still mirrors the message when the history cannot be read', async () => {
    const tars = mockTars();
    const deps = makeDeps({
      getMessages: jest.fn(async () => {
        throw new Error('mongo down');
      }),
    });

    await createTarsChatMirror(deps)(makeReq(), {
      conversationId: nextConvo(),
      query: 'q',
      turn: answer('a'),
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(JSON.parse(String(tars.message()?.message)).messages).toEqual([
      { role: 'user', content: 'q' },
    ]);
  });

  it('mirrors a turn whose request fields hold the wrong kinds of values', async () => {
    const tars = mockTars();
    const req = makeReq({
      body: { files: 'photo.png', model: { name: 'gpt' } } as never,
      turnStartedAt: 'yesterday' as never,
      ip: 42 as never,
    });

    await createTarsChatMirror(makeDeps())(req, {
      conversationId: nextConvo(),
      query: 'q',
      turn: { ...answer('a'), files: 'notes.txt' as never },
      agent: { model_parameters: 'params' as never, model: 7 as never },
    });

    expect(tars.message()).toMatchObject({ query: 'q', model_name: null, ip_addr: null });
    expect(tars.message()).not.toHaveProperty('response_latency');
  });

  /** The tool layer knows the turn only by the run configurable's user_id and thread_id. */
  it('marks a call its MCP server failed, then forgets it for the next turn', async () => {
    const conversationId = nextConvo();
    const formatted: [string, undefined] = ['quota exceeded', undefined];
    noteTarsMcpToolError(formatted, { isError: true });
    noteTarsMcpToolCall('mcp-call', formatted, { user_id: 'lc-user', thread_id: conversationId });
    const turn: TarsTurnSource = {
      response: {
        text: 'sorry',
        content: [
          {
            type: ContentTypes.TOOL_CALL,
            tool_call: {
              id: 'mcp-call',
              name: 'lookup_mcp_x',
              args: '{}',
              output: 'quota exceeded',
            },
          },
          { type: ContentTypes.TEXT, text: 'sorry' },
        ],
      },
    };
    const resultOk = () =>
      (tars.message()?.trace as Array<{ type: string; ok?: boolean }>)?.find(
        (record) => record.type === 'tool_result',
      )?.ok;

    let tars = mockTars();
    const mirror = createTarsChatMirror(makeDeps());
    await mirror(makeReq(), { conversationId, query: 'look it up', turn });
    expect(resultOk()).toBe(false);

    jest.restoreAllMocks();
    tars = mockTars();
    await mirror(makeReq(), { conversationId, query: 'again', turn });
    expect(resultOk()).toBe(true);
  });

  it('never rejects, whatever fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('pwc_tars down'));
    const deps = makeDeps({
      saveConvo: jest.fn(async () => {
        throw new Error('unreachable');
      }),
    });

    await expect(
      createTarsChatMirror(deps)(makeReq(), {
        conversationId: nextConvo(),
        query: 'q',
        turn: answer('a'),
      }),
    ).resolves.toBeUndefined();
    await expect(
      createTarsChatMirror(deps)({} as TarsMirrorRequest, {
        conversationId: nextConvo(),
        query: 'q',
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
