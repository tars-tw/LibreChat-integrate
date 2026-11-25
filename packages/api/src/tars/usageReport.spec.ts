jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import jwt from 'jsonwebtoken';
import { logger } from '@librechat/data-schemas';
import type { TarsUsageClient, TarsUsageDelivery } from './usageReport';
import {
  reportTarsUsage,
  savedTarsAgentId,
  reportTarsApiUsage,
  deliverTarsUsageReport,
  reportTarsFallbackUsage,
  reportTarsCollectedUsage,
  withTarsDetachedUsageReport,
} from './usageReport';
import { configureTarsOutbox } from './outbox';
import { getTarsToolUsage, recordTarsToolUsage } from './tools/usage';

const SECRET = 'usage-secret';

const reply = (status: number, body: unknown = {}): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

/** Lets a report that was fired without awaiting reach `fetch`. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const lastCall = (fetchMock: jest.SpyInstance) => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const headers = (init as RequestInit).headers as Record<string, string>;
  return {
    url,
    method: (init as RequestInit).method,
    body: JSON.parse((init as RequestInit).body as string),
    userId: (
      jwt.verify(headers.Authorization.replace('Bearer ', ''), SECRET) as { user_id: string }
    ).user_id,
  };
};

const makeClient = (overrides: Partial<TarsUsageClient> = {}): TarsUsageClient => ({
  options: {
    req: { user: { tarsId: '42' }, body: { domain_id: 'd-1' } },
    agent: { model_parameters: { model: 'gpt-5.4' } },
  },
  conversationId: 'lc-c1',
  responseMessageId: 'm-1',
  model: 'client-model',
  ...overrides,
});

describe('tars usage reports', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = 'http://tars.test';
    process.env.TARS_JWT_SECRET = SECRET;
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(reply(200, { recorded: true }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    delete process.env.TARS_AUTH_URL;
    delete process.env.TARS_JWT_SECRET;
  });

  describe('reportTarsUsage', () => {
    it('posts the summed tokens as the signed user', async () => {
      await reportTarsUsage('42', {
        refType: 'title',
        messageId: 'm-1',
        conversationId: 'lc-c1',
        model: 'gpt-5.4-mini',
        domainId: 'd-1',
        usage: [
          { input_tokens: 30, output_tokens: 5 },
          { input_tokens: 2, output_tokens: 1 },
        ],
      });

      const { url, method, body, userId } = lastCall(fetchMock);
      expect(url).toBe('http://tars.test/api/message/record_usage');
      expect(method).toBe('POST');
      expect(userId).toBe('42');
      expect(body).toEqual({
        ref_type: 'title',
        message_id: 'm-1',
        conversation_id: 'lc-c1',
        model_name: 'gpt-5.4-mini',
        domain_id: 'd-1',
        prompt_tokens: 32,
        completion_tokens: 6,
        request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
    });

    it('sends the key it is given, so a report standing in for a mirror shares its key', async () => {
      await reportTarsUsage('42', {
        refType: 'chat',
        requestId: 'mirror-key',
        messageId: 'm-1',
        usage: [{ input_tokens: 3, output_tokens: 1 }],
      });

      expect(lastCall(fetchMock).body.request_id).toBe('mirror-key');
    });

    it('keeps a report pwc_tars did not answer, to send again under the same key', async () => {
      const kept: Array<{
        kind: string;
        payload: TarsUsageDelivery;
      }> = [];
      configureTarsOutbox({
        add: async (item) => {
          kept.push(item as never);
        },
        due: async () => [],
        reschedule: async () => undefined,
        remove: async () => undefined,
      });
      fetchMock.mockRejectedValueOnce(new Error('fetch failed'));

      await reportTarsUsage('42', {
        refType: 'title',
        messageId: 'm-1',
        usage: [{ input_tokens: 3 }],
      });

      expect(kept).toHaveLength(1);
      expect(kept[0].kind).toBe('usage');
      expect(kept[0].payload.tarsId).toBe('42');
      const requestId = kept[0].payload.body.request_id;
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Could not report'),
        expect.anything(),
      );

      fetchMock.mockResolvedValueOnce(reply(200));
      await deliverTarsUsageReport(kept[0].payload);
      expect(lastCall(fetchMock).body.request_id).toBe(requestId);
      configureTarsOutbox(null);
    });

    it.each([
      ['no linked user', null, { messageId: 'm-1', usage: [{ input_tokens: 1 }] }],
      ['no message', '42', { messageId: null, usage: [{ input_tokens: 1 }] }],
      ['no tokens', '42', { messageId: 'm-1', usage: [{ input_tokens: 0, output_tokens: 0 }] }],
    ])('sends nothing with %s', async (_case, tarsId, report) => {
      await reportTarsUsage(tarsId, { refType: 'title', ...report });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends nothing when pwc_tars is not configured', async () => {
      delete process.env.TARS_AUTH_URL;

      await reportTarsUsage('42', {
        refType: 'title',
        messageId: 'm-1',
        usage: [{ input_tokens: 1 }],
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('logs a failed report and never throws', async () => {
      fetchMock.mockResolvedValueOnce(reply(500)).mockRejectedValueOnce(new Error('down'));
      const report = {
        refType: 'subagent' as const,
        messageId: 'm-1',
        usage: [{ output_tokens: 3 }],
      };

      await expect(reportTarsUsage('42', report)).resolves.toBeUndefined();
      await expect(reportTarsUsage('42', report)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('reportTarsCollectedUsage', () => {
    it('reports the title on the model it ran', async () => {
      await reportTarsCollectedUsage(makeClient(), {
        context: 'title',
        collectedUsage: [{ input_tokens: 30, output_tokens: 5 }],
        model: 'gpt-5.4-mini',
      });

      const { body } = lastCall(fetchMock);
      expect(body).toMatchObject({
        ref_type: 'title',
        message_id: 'm-1',
        conversation_id: 'lc-c1',
        model_name: 'gpt-5.4-mini',
        domain_id: 'd-1',
        prompt_tokens: 30,
        completion_tokens: 5,
      });
    });

    it.each(['activity-label', 'activity-phase', 'reasoning-label'])(
      'reports %s usage as an activity label',
      async (context) => {
        await reportTarsCollectedUsage(makeClient(), {
          context,
          collectedUsage: [{ input_tokens: 4, output_tokens: 2 }],
          model: 'label-model',
        });

        expect(lastCall(fetchMock).body).toMatchObject({
          ref_type: 'activity_label',
          model_name: 'label-model',
        });
      },
    );

    it.each(['message', 'abort'])(
      'leaves a finished turn’s %s usage to the chat mirror',
      async (context) => {
        const result = reportTarsCollectedUsage(makeClient(), {
          context,
          collectedUsage: [{ input_tokens: 100, output_tokens: 20 }],
        });

        expect(result).toBeUndefined();
        await settle();
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['a run that paused for review', { pendingApproval: { actionId: 'a-1' } }],
      ['a resumed segment', { tarsResumedSegment: true }],
    ])('reports %s as chat usage, with its pwc_tars tools', async (_case, flags) => {
      const client = makeClient(flags);
      const req = client.options?.req as object;
      recordTarsToolUsage(req, 'call-1', { prompt: 7, completion: 3 });

      await reportTarsCollectedUsage(client, {
        context: 'message',
        collectedUsage: [{ input_tokens: 100, output_tokens: 20 }],
      });

      expect(lastCall(fetchMock).body).toMatchObject({
        ref_type: 'chat',
        model_name: 'gpt-5.4',
        prompt_tokens: 107,
        completion_tokens: 23,
      });
    });

    it('reports a pwc_tars tool that settles after the segment as the turn’s own chat usage', async () => {
      const client = makeClient({ pendingApproval: { actionId: 'a-1' } });
      const req = client.options?.req as object;
      recordTarsToolUsage(req, 'call-1', { prompt: 7, completion: 3 });
      await reportTarsCollectedUsage(client, {
        context: 'message',
        collectedUsage: [{ input_tokens: 100, output_tokens: 20 }],
      });

      /** A call dispatched in the background, or by a detached subagent, outlives the turn. */
      recordTarsToolUsage(req, 'call-2', { prompt: 40, completion: 9 });
      await settle();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(lastCall(fetchMock).body).toEqual({
        ref_type: 'chat',
        message_id: 'm-1',
        conversation_id: 'lc-c1',
        model_name: 'gpt-5.4',
        domain_id: 'd-1',
        prompt_tokens: 40,
        completion_tokens: 9,
        request_id: expect.any(String),
      });
    });

    it('takes a turn’s tool usage only for the turn itself, never for a title', async () => {
      const client = makeClient();
      const req = client.options?.req as object;
      recordTarsToolUsage(req, 'call-1', { prompt: 7, completion: 3 });

      await reportTarsCollectedUsage(client, {
        context: 'title',
        collectedUsage: [{ input_tokens: 30, output_tokens: 5 }],
      });

      expect(lastCall(fetchMock).body).toMatchObject({ prompt_tokens: 30, completion_tokens: 5 });
      expect(getTarsToolUsage(req).size).toBe(1);
    });

    it.each([
      ['a user not linked to pwc_tars', { req: { user: {}, body: {} } }],
      ['no request', { req: null }],
    ])('reports nothing for %s', async (_case, options) => {
      await reportTarsCollectedUsage(makeClient({ options }), {
        context: 'title',
        collectedUsage: [{ input_tokens: 30, output_tokens: 5 }],
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['a temporary chat the client flagged', { body: { isTemporary: true } }, 'chat'],
      [
        'a stored temporary chat continued without the flag',
        { body: {}, resolvedConversation: { isTemporary: true } },
        'chat',
      ],
      ['a manual compaction', { body: { compact: true } }, 'compaction'],
    ])('reports the whole of %s, which is never mirrored', async (_case, fields, refType) => {
      const client = makeClient({
        options: {
          req: { user: { tarsId: '42' }, ...fields },
          agent: { model_parameters: { model: 'm' } },
        },
      });
      recordTarsToolUsage(client.options?.req as object, 'call-1', { prompt: 7, completion: 3 });

      await reportTarsCollectedUsage(client, {
        context: 'message',
        collectedUsage: [{ input_tokens: 100, output_tokens: 20 }],
      });

      expect(lastCall(fetchMock).body).toMatchObject({
        ref_type: refType,
        prompt_tokens: 107,
        completion_tokens: 23,
      });
    });

    it('reports a temporary chat’s labels as well', async () => {
      const req = { user: { tarsId: '42' }, body: { isTemporary: true } };
      await reportTarsCollectedUsage(makeClient({ options: { req } }), {
        context: 'activity-label',
        collectedUsage: [{ input_tokens: 4, output_tokens: 2 }],
      });

      expect(lastCall(fetchMock).body.ref_type).toBe('activity_label');
    });

    it('reports the saved agent the usage ran for', async () => {
      await reportTarsCollectedUsage(
        makeClient({
          options: {
            req: { user: { tarsId: '42' }, body: {} },
            agent: { id: 'agent_abc', model_parameters: { model: 'gpt-5.4' } },
          },
        }),
        { context: 'title', collectedUsage: [{ input_tokens: 1, output_tokens: 1 }] },
      );

      expect(lastCall(fetchMock).body.agent_id).toBe('agent_abc');
    });

    it('leaves out an agent that was never saved', async () => {
      await reportTarsCollectedUsage(
        makeClient({
          options: {
            req: { user: { tarsId: '42' }, body: { agent_id: 'ephemeral' } },
            agent: null,
          },
        }),
        { context: 'title', collectedUsage: [{ input_tokens: 1, output_tokens: 1 }] },
      );

      expect(lastCall(fetchMock).body).not.toHaveProperty('agent_id');
    });

    it('falls back to the client’s model when the agent names none', async () => {
      await reportTarsCollectedUsage(
        makeClient({ options: { req: { user: { tarsId: '42' } }, agent: null } }),
        { context: 'title', collectedUsage: [{ input_tokens: 1, output_tokens: 1 }] },
      );

      expect(lastCall(fetchMock).body.model_name).toBe('client-model');
    });

    it('never throws on a malformed client', () => {
      const broken = {
        get options(): never {
          throw new Error('boom');
        },
      } as unknown as TarsUsageClient;

      expect(reportTarsCollectedUsage(broken, { context: 'title' })).toBeUndefined();
      expect(reportTarsCollectedUsage(null, { context: 'title' })).toBeUndefined();
    });

    it('falls back to resolvedConversation.domain_id on a resumed segment', async () => {
      const req = {
        user: { tarsId: '42' },
        body: {},
        resolvedConversation: { domain_id: 'd-resumed' },
      };
      const client = makeClient({ options: { req }, tarsResumedSegment: true });

      await reportTarsCollectedUsage(client, {
        context: 'message',
        collectedUsage: [{ input_tokens: 12, output_tokens: 4 }],
      });

      expect(lastCall(fetchMock).body).toMatchObject({
        ref_type: 'chat',
        domain_id: 'd-resumed',
      });
    });

    it('never throws when reportTarsUsage receives a null report', async () => {
      await expect(reportTarsUsage('42', null)).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports an Event Actor pause staged before it is published, with its pwc_tars tools', async () => {
      const client = makeClient({
        stagedApproval: { pendingAction: { actionId: 'a-1' } },
        eventActorInvocationId: 'invocation-1',
      });
      recordTarsToolUsage(client.options?.req as object, 'call-1', { prompt: 7, completion: 3 });

      await reportTarsCollectedUsage(client, {
        context: 'message',
        collectedUsage: [{ input_tokens: 100, output_tokens: 20 }],
      });

      expect(lastCall(fetchMock).body).toMatchObject({
        ref_type: 'chat',
        prompt_tokens: 107,
        completion_tokens: 23,
      });
    });

    it('leaves a staged pause outside an Event Actor run to the chat mirror', async () => {
      const result = reportTarsCollectedUsage(
        makeClient({ stagedApproval: { pendingAction: { actionId: 'a-1' } } }),
        { context: 'message', collectedUsage: [{ input_tokens: 100, output_tokens: 20 }] },
      );

      expect(result).toBeUndefined();
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('savedTarsAgentId', () => {
    it('names the saved agent without the suffix a parallel run adds', () => {
      expect(savedTarsAgentId('agent_abc____2')).toBe('agent_abc');
    });

    it('passes over empty and ephemeral candidates to a later saved one', () => {
      expect(savedTarsAgentId(undefined, '', 'ephemeral', null, 'agent_x')).toBe('agent_x');
    });

    it('is null when no candidate is a saved agent', () => {
      expect(savedTarsAgentId('ephemeral', 'openAI__gpt-5.4____1', null)).toBeNull();
      expect(savedTarsAgentId()).toBeNull();
    });
  });

  describe('reportTarsFallbackUsage', () => {
    const temporaryClient = (overrides: Partial<TarsUsageClient> = {}) =>
      makeClient({
        options: {
          req: { user: { tarsId: '42' }, body: { isTemporary: true, domain_id: 'd-1' } },
          agent: { id: 'agent_abc', model_parameters: { model: 'vllm-model' } },
        },
        ...overrides,
      });

    it('reports the estimate of an unmirrored turn the provider reported nothing for', async () => {
      await reportTarsFallbackUsage(temporaryClient(), {
        usage: { reasoning_tokens: 4 },
        collectedUsage: [],
        promptTokens: 120,
        completionTokens: 30,
      });

      expect(lastCall(fetchMock).body).toMatchObject({
        ref_type: 'chat',
        message_id: 'm-1',
        model_name: 'vllm-model',
        domain_id: 'd-1',
        agent_id: 'agent_abc',
        prompt_tokens: 120,
        completion_tokens: 34,
      });
    });

    it('still estimates when only a side call (summarization) reported usage', async () => {
      await reportTarsFallbackUsage(temporaryClient(), {
        collectedUsage: [{ usage_type: 'summarization', input_tokens: 10, output_tokens: 2 }],
        promptTokens: 50,
        completionTokens: 5,
      });

      expect(lastCall(fetchMock).body).toMatchObject({ prompt_tokens: 50, completion_tokens: 5 });
    });

    it.each([
      ['a primary call reported usage', { collectedUsage: [{ input_tokens: 9 }] }],
      ['the run aggregate reported usage', { usage: { input_tokens: 0, output_tokens: 3 } }],
    ])('reports nothing when %s, as LibreChat bills no estimate', async (_case, recorded) => {
      const result = reportTarsFallbackUsage(temporaryClient(), {
        promptTokens: 50,
        completionTokens: 5,
        ...recorded,
      });

      expect(result).toBeUndefined();
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves a mirrored turn’s estimate to its message', async () => {
      const result = reportTarsFallbackUsage(makeClient(), {
        promptTokens: 50,
        completionTokens: 5,
      });

      expect(result).toBeUndefined();
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a paused segment’s estimate', async () => {
      await reportTarsFallbackUsage(makeClient({ tarsResumedSegment: true }), {
        promptTokens: 50,
        completionTokens: 5,
      });

      expect(lastCall(fetchMock).body).toMatchObject({ ref_type: 'chat', prompt_tokens: 50 });
    });

    it('sends nothing for an empty estimate', async () => {
      await reportTarsFallbackUsage(temporaryClient(), {
        promptTokens: 0,
        completionTokens: -3,
      });
      await settle();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never throws on a malformed or unlinked client', () => {
      const broken = {
        get options(): never {
          throw new Error('boom');
        },
      } as unknown as TarsUsageClient;

      expect(reportTarsFallbackUsage(broken, { promptTokens: 5 })).toBeUndefined();
      expect(reportTarsFallbackUsage(null, { promptTokens: 5 })).toBeUndefined();
      expect(
        reportTarsFallbackUsage(makeClient({ options: { req: { user: {} } } }), {
          promptTokens: 5,
        }),
      ).toBeUndefined();
    });
  });

  describe('reportTarsApiUsage', () => {
    it('reports the run and its pwc_tars tool tokens as chat usage', async () => {
      const apiReq = { user: { tarsId: '42' }, body: { agent_id: 'agent_api' } };
      recordTarsToolUsage(apiReq, 'call-1', { prompt: 7, completion: 3 });

      await reportTarsApiUsage(apiReq, {
        messageId: 'chatcmpl-1',
        conversationId: 'conv-1',
        model: 'fallback-model',
        agent: { id: 'agent_api____1', model_parameters: { model: 'gpt-5.4-mini' } },
        collectedUsage: [
          { input_tokens: 100, output_tokens: 20 },
          { input_tokens: 10, output_tokens: 2, usage_type: 'summarization' },
        ],
      });

      expect(lastCall(fetchMock).body).toEqual({
        ref_type: 'chat',
        message_id: 'chatcmpl-1',
        conversation_id: 'conv-1',
        model_name: 'gpt-5.4-mini',
        domain_id: null,
        agent_id: 'agent_api',
        prompt_tokens: 117,
        completion_tokens: 25,
        request_id: expect.any(String),
      });
    });

    it('reports a pwc_tars tool that settles after the run on the run’s message', async () => {
      const apiReq = { user: { tarsId: '42' }, body: {} };
      await reportTarsApiUsage(apiReq, {
        messageId: 'resp-1',
        conversationId: 'conv-1',
        agent: { id: 'agent_api', model_parameters: { model: 'gpt-5.4-mini' } },
        collectedUsage: [{ input_tokens: 10, output_tokens: 2 }],
      });

      recordTarsToolUsage(apiReq, 'call-1', { prompt: 40, completion: 9 });
      await settle();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(lastCall(fetchMock).body).toMatchObject({
        ref_type: 'chat',
        message_id: 'resp-1',
        conversation_id: 'conv-1',
        model_name: 'gpt-5.4-mini',
        agent_id: 'agent_api',
        prompt_tokens: 40,
        completion_tokens: 9,
      });
    });

    it('names the model it was given when the agent carries none', async () => {
      await reportTarsApiUsage(
        { user: { tarsId: '42' } },
        {
          messageId: 'resp-1',
          model: 'gpt-5.4-mini',
          agent: { id: 'agent_api' },
          collectedUsage: [{ input_tokens: 1, output_tokens: 1 }],
        },
      );

      expect(lastCall(fetchMock).body.model_name).toBe('gpt-5.4-mini');
    });

    it('reports nothing for a user not linked to pwc_tars, or a run that used nothing', async () => {
      const usage = { messageId: 'resp-1', collectedUsage: [{ input_tokens: 5 }] };
      expect(reportTarsApiUsage({ user: {} }, usage)).toBeUndefined();
      expect(reportTarsApiUsage(null, usage)).toBeUndefined();

      await reportTarsApiUsage({ user: { tarsId: '42' } }, { messageId: 'resp-1' });
      await settle();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never throws on a malformed request', () => {
      const broken = {
        get user(): never {
          throw new Error('boom');
        },
      };

      expect(reportTarsApiUsage(broken, { messageId: 'resp-1' })).toBeUndefined();
    });
  });

  describe('withTarsDetachedUsageReport', () => {
    it('reports each detached call as subagent usage and still bills it', async () => {
      const record = jest.fn(async () => undefined);
      const client = makeClient();
      const wrapped = withTarsDetachedUsageReport(client, record);
      // A detached child may finish after the client moved on to another response.
      client.responseMessageId = 'm-2';

      const usage = { input_tokens: 50, output_tokens: 8, model: 'child-model' };
      await wrapped(usage);
      await settle();

      expect(record).toHaveBeenCalledWith(usage);
      expect(lastCall(fetchMock).body).toMatchObject({
        ref_type: 'subagent',
        message_id: 'm-1',
        model_name: 'child-model',
        prompt_tokens: 50,
        completion_tokens: 8,
      });
    });

    it('reports a temporary chat’s detached calls too', async () => {
      const req = { user: { tarsId: '42' }, body: { isTemporary: true } };
      await withTarsDetachedUsageReport(
        makeClient({ options: { req } }),
        jest.fn(async () => undefined),
      )({ input_tokens: 3, output_tokens: 1 });
      await settle();

      expect(lastCall(fetchMock).body.ref_type).toBe('subagent');
    });

    it('names a detached child by its own agent, else the parent’s', async () => {
      const client = makeClient({
        options: {
          req: { user: { tarsId: '42' }, body: {} },
          agent: { id: 'agent_parent', model_parameters: { model: 'gpt-5.4' } },
        },
      });
      const wrapped = withTarsDetachedUsageReport(
        client,
        jest.fn(async () => undefined),
      );

      await wrapped({ input_tokens: 1, agentId: 'agent_child' } as never);
      await settle();
      expect(lastCall(fetchMock).body.agent_id).toBe('agent_child');

      await wrapped({ input_tokens: 1 });
      await settle();
      expect(lastCall(fetchMock).body.agent_id).toBe('agent_parent');
    });

    it('uses the agent’s model when the call names none', async () => {
      await withTarsDetachedUsageReport(
        makeClient(),
        jest.fn(async () => undefined),
      )({
        input_tokens: 1,
      });
      await settle();

      expect(lastCall(fetchMock).body.model_name).toBe('gpt-5.4');
    });

    it.each([
      ['an unlinked user', makeClient({ options: { req: { user: {} } } })],
      ['no client', null],
    ])('returns the recorder unchanged for %s', (_case, client) => {
      const record = jest.fn(async () => undefined);

      expect(withTarsDetachedUsageReport(client, record)).toBe(record);
    });

    it('still bills a call whose usage cannot be read for the report', async () => {
      const record = jest.fn(async () => undefined);
      const usage = {
        input_tokens: 1,
        get model(): string {
          throw new Error('unreadable');
        },
      };

      await withTarsDetachedUsageReport(makeClient(), record)(usage);

      expect(record).toHaveBeenCalledWith(usage);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('detached subagent usage report'),
        expect.any(Error),
      );
    });

    it('returns the recorder unchanged on a malformed client', () => {
      const record = jest.fn(async () => undefined);
      const broken = {
        get options() {
          throw new Error('broken client');
        },
      } as unknown as TarsUsageClient;

      expect(withTarsDetachedUsageReport(broken, record)).toBe(record);
    });
  });
});
