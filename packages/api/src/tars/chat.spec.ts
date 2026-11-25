jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { logger } from '@librechat/data-schemas';
import {
  Permissions,
  ContentTypes,
  RetentionMode,
  PermissionTypes,
  TARS_MESSAGE_STATUS,
} from 'librechat-data-provider';
import type { TarsChatMirrorDeps, TarsMirrorDelivery, TarsMirrorRequest } from './chat';
import type { TarsTurnSource } from './mirror';
import { noteTarsMcpToolCall, noteTarsMcpToolError } from './failure';
import {
  deliverTarsMirror,
  redeliverTarsMirror,
  createTarsChatMirror,
  toTarsResumedTurnMirror,
} from './chat';
import { configureTarsOutbox } from './outbox';
import { recordTarsToolUsage } from './tools/usage';

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

/** Puts back an env value a test replaced; Node would store an unset one as "undefined". */
const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

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
      expect.objectContaining({ noUpsert: true }),
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

  describe('usage no mirrored message carries', () => {
    const secret = process.env.TARS_JWT_SECRET;
    beforeEach(() => {
      process.env.TARS_JWT_SECRET = 'test-secret';
    });
    afterEach(() => restoreEnv('TARS_JWT_SECRET', secret));

    /** `saveConvo` answers null when `noUpsert` finds nothing: the user deleted the chat meanwhile. */
    it('reports only the usage of a conversation deleted before its link is saved', async () => {
      const tars = mockTars();
      const deps = makeDeps({ saveConvo: jest.fn(async () => null) });
      const conversationId = nextConvo();

      await createTarsChatMirror(deps)(makeReq(), {
        conversationId,
        existingTarsConversationId: 'tc-old',
        messageId: 'msg-gone',
        model: 'gpt-5.4-mini',
        query: 'q',
        turn: { ...answer('a'), usage: [{ input_tokens: 100, output_tokens: 20 }] },
      });

      expect(deps.saveConvo).toHaveBeenCalledTimes(1);
      expect(tars.paths()).toEqual(['/api/message/record_usage']);
      expect(tars.posted[0].body).toEqual({
        ref_type: 'chat',
        message_id: 'msg-gone',
        conversation_id: conversationId,
        model_name: 'gpt-5.4-mini',
        domain_id: null,
        prompt_tokens: 100,
        completion_tokens: 20,
        request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
    });

    it('reports a pwc_tars tool that settles after the turn was mirrored, on its message', async () => {
      const tars = mockTars();
      const req = makeReq();
      const conversationId = nextConvo();
      recordTarsToolUsage(req, 'call-1', { prompt: 9, completion: 2 });

      await createTarsChatMirror(makeDeps())(req, {
        conversationId,
        existingTarsConversationId: 'tc-old',
        messageId: 'msg-late',
        model: 'gpt-5.4-mini',
        domainId: '7',
        query: 'q',
        turn: answer('a'),
      });
      /** A call dispatched in the background, or by a detached subagent, outlives the turn. */
      recordTarsToolUsage(req, 'call-2', { prompt: 40, completion: 9 });
      await new Promise((resolve) => setImmediate(resolve));

      expect(tars.paths()).toEqual(['/api/message/create_message', '/api/message/record_usage']);
      expect(tars.message()).toMatchObject({ message_tokens: 9, response_tokens: 2 });
      expect(tars.posted[1].body).toEqual({
        ref_type: 'chat',
        message_id: 'msg-late',
        conversation_id: conversationId,
        model_name: 'gpt-5.4-mini',
        domain_id: '7',
        prompt_tokens: 40,
        completion_tokens: 9,
        request_id: expect.any(String),
      });
    });
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

  it('records a saved agent on a Vertex model under its profile, not the bare id it sends', async () => {
    const tars = mockTars();
    const profile = 'gemini-3.5-flash(enterprise)';

    await createTarsChatMirror(makeDeps())(makeReq(), {
      conversationId: nextConvo(),
      query: 'q',
      turn: answer('a'),
      agent: {
        model: profile,
        model_parameters: { model: 'gemini-3.5-flash', metadata: { tars_model: profile } },
      },
    });

    expect(tars.message()?.model_name).toBe(profile);
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

  it('mirrors a turn whose usage was reported per segment without any usage of its own', async () => {
    const tars = mockTars();
    const req = makeReq();
    recordTarsToolUsage(req, 'call-1', { prompt: 9, completion: 2 });

    await createTarsChatMirror(makeDeps())(req, {
      conversationId: nextConvo(),
      query: 'q',
      turn: { ...answer('approved and done'), usage: [{ input_tokens: 100, output_tokens: 20 }] },
      tokenEstimate: { promptTokens: 120, completionTokens: 30 },
      usageReported: true,
    });

    expect(tars.message()).toMatchObject({
      status: TARS_MESSAGE_STATUS.success,
      response: 'approved and done',
      message_tokens: 0,
      response_tokens: 0,
    });
  });

  describe('when pwc_tars cannot take the turn', () => {
    /** pwc_tars as `mockTars` answers it, except that `failing` paths reply with `failure`. */
    function failingTars(failing: string, failure: () => Promise<Response>) {
      const tars = mockTars({ createdId: 'tc-1' });
      const answer200 = jest.mocked(global.fetch).getMockImplementation()!;
      jest
        .mocked(global.fetch)
        .mockImplementation(async (url, init) =>
          String(url).endsWith(failing) ? failure() : answer200(url, init),
        );
      return tars;
    }

    const keep = () => {
      const kept: Array<{ kind: string; payload: TarsMirrorDelivery }> = [];
      configureTarsOutbox({
        add: async (item) => {
          kept.push(item as never);
        },
        due: async () => [],
        reschedule: async () => undefined,
        remove: async () => undefined,
      });
      return kept;
    };

    afterEach(() => configureTarsOutbox(null));

    it.each([
      ['the agent it ran', { agent_id: 'agent_abc' }, 'agent_abc'],
      ['nothing for an agent never saved', { agent_id: 'ephemeral' }, undefined],
    ])('records %s', async (_case, body, agentId) => {
      const tars = mockTars();

      await createTarsChatMirror(makeDeps())(makeReq({ body: { ...makeReq().body, ...body } }), {
        conversationId: nextConvo(),
        query: 'q',
        turn: answer('a'),
      });

      expect(tars.message()?.agent_id).toBe(agentId);
    });

    it('sends every sync with its own idempotency key', async () => {
      const tars = mockTars();

      await createTarsChatMirror(makeDeps())(makeReq(), {
        conversationId: nextConvo(),
        query: 'q',
        turn: answer('a'),
      });

      expect(tars.message()?.request_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it.each([
      ['the message', '/create_message'],
      ['the conversation', '/create_conversation'],
    ])('keeps the turn to send again when %s cannot be saved', async (_case, failing) => {
      failingTars(failing, () => Promise.reject(new Error('fetch failed')));
      const kept = keep();
      const conversationId = nextConvo();

      await createTarsChatMirror(makeDeps())(makeReq(), {
        conversationId,
        title: 'Flights',
        query: 'q',
        messageId: 'msg-1',
        turn: answer('a'),
      });

      expect(kept).toHaveLength(1);
      expect(kept[0].kind).toBe('mirror');
      expect(kept[0].payload).toMatchObject({
        tarsId: 'tars-user',
        userId: 'lc-user',
        conversationId,
        title: 'Flights',
        message: { messageId: 'msg-1', query: 'q', response: 'a' },
      });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does not keep a turn pwc_tars refused, and logs it', async () => {
      failingTars(
        '/create_message',
        async () => ({ status: 400, ok: false, json: async () => ({}) }) as Response,
      );
      const kept = keep();

      await createTarsChatMirror(makeDeps())(makeReq(), {
        conversationId: nextConvo(),
        query: 'q',
        turn: answer('a'),
      });

      expect(kept).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        '[mirrorChatToTars] Failed to mirror conversation to pwc_tars',
        expect.anything(),
      );
    });

    it('sends a kept turn again under the same key, into the conversation linked meanwhile', async () => {
      failingTars('/create_message', () => Promise.reject(new Error('fetch failed')));
      const kept = keep();
      const deps = makeDeps();
      await createTarsChatMirror(deps)(makeReq(), {
        conversationId: nextConvo(),
        query: 'q',
        turn: answer('a'),
      });
      const firstKey = kept[0].payload.message.requestId;

      const tars = mockTars();
      const retryDeps = makeDeps({
        getConvo: jest.fn(async () => ({ tarsConversationId: 'tc-1' })),
      });
      await expect(deliverTarsMirror(retryDeps, kept[0].payload)).resolves.toBe(true);

      expect(tars.paths()).toEqual(['/api/message/create_message']);
      expect(tars.message()).toMatchObject({ conversation_id: 'tc-1', request_id: firstKey });
      expect(retryDeps.saveConvo).toHaveBeenCalled();
    });

    /**
     * Without the check the link save would bring the conversation back as an empty chat.
     * The turn's tokens still reach pwc_tars, under the mirror's key: had the first attempt
     * landed after all, pwc_tars would hold that key and count nothing twice.
     */
    it('drops a kept turn whose conversation was deleted while it waited, but not its usage', async () => {
      const secret = process.env.TARS_JWT_SECRET;
      process.env.TARS_JWT_SECRET = 'test-secret';
      try {
        failingTars('/create_message', () => Promise.reject(new Error('fetch failed')));
        const kept = keep();
        await createTarsChatMirror(makeDeps())(makeReq(), {
          conversationId: nextConvo(),
          messageId: 'msg-1',
          query: 'q',
          turn: { ...answer('a'), usage: [{ input_tokens: 100, output_tokens: 20 }] },
        });

        const tars = mockTars();
        const retryDeps = makeDeps({ getConvo: jest.fn(async () => null) });
        await expect(redeliverTarsMirror(retryDeps, kept[0].payload)).resolves.toBe(false);

        expect(tars.paths()).toEqual(['/api/message/record_usage']);
        expect(tars.posted[0].body).toMatchObject({
          ref_type: 'chat',
          message_id: 'msg-1',
          prompt_tokens: 100,
          completion_tokens: 20,
          request_id: kept[0].payload.message.requestId,
        });
        expect(retryDeps.saveConvo).not.toHaveBeenCalled();
      } finally {
        restoreEnv('TARS_JWT_SECRET', secret);
      }
    });

    it('resends a kept turn into the link the conversation holds now', async () => {
      failingTars('/create_conversation', () => Promise.reject(new Error('fetch failed')));
      const kept = keep();
      const conversationId = nextConvo();
      await createTarsChatMirror(makeDeps())(makeReq(), {
        conversationId,
        query: 'q',
        turn: answer('a'),
      });

      const tars = mockTars();
      const retryDeps = makeDeps({
        getConvo: jest.fn(async () => ({ tarsConversationId: 'tc-9' })),
      });
      await expect(redeliverTarsMirror(retryDeps, kept[0].payload)).resolves.toBe(true);

      expect(retryDeps.getConvo).toHaveBeenCalledWith('lc-user', conversationId);
      expect(tars.paths()).toEqual(['/api/message/create_message']);
      expect(tars.message()).toMatchObject({ conversation_id: 'tc-9' });
    });
  });

  it('reads the history above the parent the input names, over the request’s', async () => {
    const tars = mockTars();
    const deps = makeDeps({
      getMessages: jest.fn(async () => [
        { messageId: 'p-0', parentMessageId: null, isCreatedByUser: true, text: 'earlier q' },
        { messageId: 'p-1', parentMessageId: 'p-0', isCreatedByUser: false, text: 'earlier a' },
      ]) as never,
    });

    await createTarsChatMirror(deps)(makeReq(), {
      conversationId: nextConvo(),
      query: 'q',
      parentMessageId: 'p-1',
      turn: answer('a'),
    });

    expect(JSON.parse(String(tars.message()?.message)).messages).toEqual([
      { role: 'user', content: 'earlier q' },
      { role: 'assistant', content: 'earlier a' },
      { role: 'user', content: 'q' },
    ]);
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

  describe('personal memory', () => {
    const memoryReq = () => makeReq({ user: { id: 'lc-user', tarsId: 'tars-user', role: 'USER' } });
    const memoryDeps = () =>
      makeDeps({
        getRoleByName: jest.fn(async () => ({
          permissions: { [PermissionTypes.MEMORIES]: { [Permissions.USE]: true } },
        })) as unknown as TarsChatMirrorDeps['getRoleByName'],
      });
    const secret = process.env.TARS_JWT_SECRET;
    beforeEach(() => {
      process.env.TARS_JWT_SECRET = 'test-secret';
    });
    afterEach(() => {
      process.env.TARS_JWT_SECRET = secret;
    });

    it('hands a finished turn to pwc_tars after mirroring it', async () => {
      const { posted, paths } = mockTars();
      const conversationId = nextConvo();
      await createTarsChatMirror(memoryDeps())(memoryReq(), {
        conversationId,
        query: 'hi',
        messageId: 'm-1',
        turn: answer('hello'),
      });

      const allPaths = paths();
      expect(allPaths.indexOf('/api/memory/update')).toBeGreaterThan(
        allPaths.findIndex((path) => path.endsWith('/create_message')),
      );
      const update = posted.find((call) => call.path === '/api/memory/update');
      expect(update?.body).toMatchObject({
        conversation_id: conversationId,
        query: 'hi',
        response: 'hello',
        message_id: 'm-1',
      });
    });

    it.each([
      ['a temporary chat the client flagged', { body: { isTemporary: true } }],
      [
        'a stored temporary chat continued without the flag',
        { resolvedConversation: { isTemporary: true } },
      ],
      [
        'a chat the administrator forces temporary',
        { config: { interfaceConfig: { retentionMode: RetentionMode.EPHEMERAL } } },
      ],
      ['a compaction turn', { body: { compact: true } }],
    ] as const)('does not teach from %s', async (_label, overrides) => {
      const { paths } = mockTars();
      const req = memoryReq();
      const body = { ...req.body, ...('body' in overrides ? overrides.body : {}) };
      await createTarsChatMirror(memoryDeps())(
        { ...req, ...overrides, body } as TarsMirrorRequest,
        { conversationId: nextConvo(), query: 'hi', turn: answer('hello') },
      );
      expect(paths()).not.toContain('/api/memory/update');
    });

    it.each([
      ['a temporary chat the client flagged', { body: { isTemporary: true } }],
      [
        'a stored temporary chat continued without the flag',
        { resolvedConversation: { isTemporary: true } },
      ],
      ['a compaction turn', { body: { compact: true } }],
    ] as const)(
      'does not mirror %s, whose usage is reported instead',
      async (_label, overrides) => {
        const { paths } = mockTars();
        const req = memoryReq();
        const body = { ...req.body, ...('body' in overrides ? overrides.body : {}) };
        await createTarsChatMirror(memoryDeps())(
          { ...req, ...overrides, body } as TarsMirrorRequest,
          { conversationId: nextConvo(), query: 'hi', turn: answer('hello') },
        );
        expect(paths()).toEqual([]);
      },
    );

    it('does not teach from a message of attachments alone', async () => {
      const { paths } = mockTars();
      await createTarsChatMirror(memoryDeps())(memoryReq(), {
        conversationId: nextConvo(),
        query: '',
        turn: { ...answer('hello'), files: [{ file_id: 'f-1', filename: 'a.pdf' }] },
      });
      const allPaths = paths();
      expect(allPaths.some((path) => path.endsWith('/create_message'))).toBe(true);
      expect(allPaths).not.toContain('/api/memory/update');
    });

    it('does not teach from a stopped turn', async () => {
      const { paths } = mockTars();
      await createTarsChatMirror(memoryDeps())(memoryReq(), {
        conversationId: nextConvo(),
        query: 'hi',
        turn: { ...answer('half an ans'), unfinished: true },
      });
      expect(paths()).not.toContain('/api/memory/update');
    });
  });
});

describe('toTarsResumedTurnMirror', () => {
  const responseMessage = {
    messageId: 'm-1',
    model: 'gpt-5.4',
    text: 'done',
    unfinished: false,
    attachments: [{ file_id: 'a-1' }],
  };
  const agent = { model_parameters: { model: 'gpt-5.4' } };

  it('mirrors the finished turn once, without usage of its own, in its own branch', () => {
    expect(
      toTarsResumedTurnMirror({
        conversationId: 'lc-c1',
        conversation: {
          title: 'Approved run',
          model: 'gpt-5.4-mini',
          domain_id: 'd-1',
          tarsConversationId: 'tc-1',
        },
        userMessage: { text: 'run the tool', files: [{ file_id: 'f-1' }], parentMessageId: 'p-1' },
        responseMessage,
        client: { options: { agent } },
        isTemporary: false,
        outcome: { incomplete: false, stepLimitReached: false },
      }),
    ).toEqual({
      conversationId: 'lc-c1',
      existingTarsConversationId: 'tc-1',
      title: 'Approved run',
      model: 'gpt-5.4-mini',
      domainId: 'd-1',
      query: 'run the tool',
      messageId: 'm-1',
      parentMessageId: 'p-1',
      turn: { response: responseMessage, files: [{ file_id: 'f-1' }], unfinished: false },
      usageReported: true,
      agent,
      attachments: responseMessage.attachments,
      outcome: { incomplete: false, stepLimitReached: false },
    });
  });

  it('falls back to the response’s model and leaves the uploads to the request', () => {
    expect(
      toTarsResumedTurnMirror({
        conversationId: 'lc-c1',
        conversation: null,
        userMessage: { text: 'q' },
        responseMessage: { ...responseMessage, unfinished: true },
      }),
    ).toMatchObject({ model: 'gpt-5.4', turn: { files: undefined, unfinished: true } });
  });

  it.each([
    ['a temporary chat', { isTemporary: true, responseMessage }],
    ['a response without an id', { responseMessage: { text: 'x' } }],
    ['no response', { responseMessage: null }],
    ['nothing at all', undefined],
  ])('mirrors nothing for %s', (_case, finished) => {
    expect(toTarsResumedTurnMirror(finished)).toBeNull();
  });

  it('mirrors nothing, and does not fail the resumed turn, when the turn cannot be read', () => {
    const unreadable = {
      get responseMessage(): never {
        throw new Error('unreadable');
      },
    };

    expect(toTarsResumedTurnMirror(unreadable)).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('resumed turn'),
      expect.any(Error),
    );
  });
});
