jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock('./sysconfig', () => ({ getTarsSysConfigValue: jest.fn(async () => undefined) }));
jest.mock('~/tars/models', () => ({
  getTarsModelProfileNames: jest.fn(async () => ['gpt-5.4-mini']),
}));

import jwt from 'jsonwebtoken';
import { getTarsSysConfigValue } from './sysconfig';
import { SystemRoles, Permissions, RetentionMode, PermissionTypes } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { IRole } from '@librechat/data-schemas';
import type { TarsMemoryUser } from './memory';
import {
  addTarsMemoryContext,
  enforceTarsMemoryPolicy,
  getTarsMemoryAudit,
  getTarsMemoryAttachment,
  createTarsMemoryHandlers,
  deleteTarsConversationMemories,
  isTarsMemoryEnabled,
  getTarsMemoryRefreshMs,
  primeTarsMemoryContext,
  scheduleTarsMemoryUpdate,
} from './memory';

const SECRET = 'test-secret';
const user = { id: 'lc-1', tarsId: '42', role: SystemRoles.USER };
const roleWith = (use: boolean) =>
  ({ permissions: { [PermissionTypes.MEMORIES]: { [Permissions.USE]: use } } }) as unknown as IRole;
const getRoleByName = jest.fn(async (): Promise<IRole | null> => roleWith(true));

const reply = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

const lastCall = (fetchMock: jest.SpyInstance) => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return {
    url: String(url),
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body) : undefined,
  };
};

const prime = (req: Parameters<typeof primeTarsMemoryContext>[0]) =>
  primeTarsMemoryContext(req, { conversationId: 'c-1', getRoleByName });

const update = (reqUser = user as TarsMemoryUser | null) =>
  scheduleTarsMemoryUpdate(
    { user: reqUser },
    {
      conversationId: 'c-1',
      query: 'hello',
      response: 'hi there',
      history: [{ role: 'user', content: 'earlier' }],
      model: 'GPT-5.4-mini',
      messageId: 'm-1',
      domainId: 'd-1',
      getRoleByName,
    },
  );

describe('tars memory', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = 'http://tars.test';
    process.env.TARS_JWT_SECRET = SECRET;
    fetchMock = jest.spyOn(global, 'fetch');
    getRoleByName.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TARS_AUTH_URL;
    delete process.env.TARS_JWT_SECRET;
  });

  describe('isTarsMemoryEnabled', () => {
    it('follows the integration and the yaml switch', () => {
      expect(isTarsMemoryEnabled()).toBe(true);
      expect(isTarsMemoryEnabled({ memoryAssist: { enabled: false } })).toBe(false);
      delete process.env.TARS_AUTH_URL;
      expect(isTarsMemoryEnabled()).toBe(false);
    });
  });

  describe('getTarsMemoryRefreshMs', () => {
    it('reads the yaml value, zero included, and defaults otherwise', () => {
      expect(getTarsMemoryRefreshMs()).toBe(30000);
      expect(getTarsMemoryRefreshMs({ memoryAssist: { panelRefreshMs: 5000 } })).toBe(5000);
      expect(getTarsMemoryRefreshMs({ memoryAssist: { panelRefreshMs: 0 } })).toBe(0);
    });
  });

  describe('primeTarsMemoryContext', () => {
    it('recalls as the signed user and returns the context', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: { memory_context: ' remembered ' } }));
      const req = { user, body: { text: 'what do I like?', domain_id: 'd-1' } };

      await expect(prime(req)).resolves.toBe('remembered');

      const { url, method, headers, body } = lastCall(fetchMock);
      expect(url).toBe('http://tars.test/api/memory/context');
      expect(method).toBe('POST');
      expect(headers['X-TARS-Domain-Id']).toBe('d-1');
      expect(body).toEqual({ query: 'what do I like?', conversation_id: 'c-1' });
      const token = headers.Authorization.replace('Bearer ', '');
      expect((jwt.verify(token, SECRET) as { user_id: string }).user_id).toBe('42');
    });

    it('asks once per request, so handoff agents share one recall', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: { memory_context: 'x' } }));
      const req = { user, body: { text: 'q' } };
      await Promise.all([prime(req), prime(req)]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('leaves out the placeholder id of a new conversation', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: { memory_context: '' } }));
      await expect(
        primeTarsMemoryContext(
          { user, body: { text: 'q' } },
          { conversationId: 'new', getRoleByName },
        ),
      ).resolves.toBeNull();
      expect(lastCall(fetchMock).body.conversation_id).toBeUndefined();
    });

    it.each([
      ['an API caller with no text', { user, body: {} }],
      ['a temporary chat', { user, body: { text: 'q', isTemporary: true } }],
      ['a compaction turn', { user, body: { text: 'q', compact: true } }],
      ['an unlinked account', { user: { id: 'lc-1' }, body: { text: 'q' } }],
      [
        'a user who turned it off',
        { user: { ...user, personalization: { memories: false } }, body: { text: 'q' } },
      ],
    ])('does not call pwc_tars for %s', async (_name, req) => {
      await expect(prime(req)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not call pwc_tars for a role without MEMORIES.USE', async () => {
      getRoleByName.mockResolvedValueOnce(roleWith(false));
      await expect(prime({ user, body: { text: 'q' } })).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tells the model chat cannot save memory in manual upkeep', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: { memory_context: 'remembered' } }));
      const context = await prime({
        user: { ...user, personalization: { memoryAutoUpdate: false } },
        body: { text: 'q' },
      });
      expect(context).toContain('remembered');
      expect(context).toContain('Personal memory');
    });

    it('still tells the model in manual upkeep when recall fails', async () => {
      fetchMock.mockResolvedValue(reply(503, { message: 'warming up' }));
      const context = await prime({
        user: { ...user, personalization: { memoryAutoUpdate: false } },
        body: { text: 'q' },
      });
      expect(context).toContain('Personal memory');
    });

    it('goes on without memory when pwc_tars fails', async () => {
      fetchMock.mockResolvedValue(reply(503, { message: 'warming up' }));
      await expect(prime({ user, body: { text: 'q' } })).resolves.toBeNull();
    });

    it('goes on without memory when pwc_tars cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(prime({ user, body: { text: 'q' } })).resolves.toBeNull();
    });

    it('does not call pwc_tars while the yaml switch is off', async () => {
      const req = { user, body: { text: 'q' } };
      await expect(
        primeTarsMemoryContext(req, { getRoleByName, config: { enabled: false } }),
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the context when the records it came with are malformed', async () => {
      fetchMock.mockResolvedValue(
        reply(200, { data: { memory_context: 'remembered', records: 'oops' } }),
      );
      const req = { user, body: { text: 'q' } };
      await expect(prime(req)).resolves.toBe('remembered');
      await expect(getTarsMemoryAttachment(req, { messageId: 'm-1' })).resolves.toBeNull();
      await expect(getTarsMemoryAudit(req)).resolves.toMatchObject({
        context_available: true,
        records: [],
      });
    });
  });

  describe('getTarsMemoryAttachment', () => {
    const ids = { messageId: 'm-1', conversationId: 'c-1' };

    it('keeps ids and a count, never the text', async () => {
      fetchMock.mockResolvedValue(
        reply(200, {
          data: {
            memory_context: 'private text',
            records: [
              { id: '1', memory_type: 'profile', item_count: 3 },
              { id: '2', memory_type: 'semantic', item_count: 1 },
            ],
          },
        }),
      );
      const req = { user, body: { text: 'q' } };
      await prime(req);
      const attachment = await getTarsMemoryAttachment(req, ids);
      expect(attachment).toMatchObject({
        type: 'tars_memory',
        messageId: 'm-1',
        conversationId: 'c-1',
        tars_memory: { ids: ['1', '2'], count: 4 },
      });
      expect(JSON.stringify(attachment)).not.toContain('private text');
    });

    it('adds nothing on a turn that recalled nothing', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: { memory_context: '', records: [] } }));
      const req = { user, body: { text: 'q' } };
      await prime(req);
      await expect(getTarsMemoryAttachment(req, ids)).resolves.toBeNull();
    });

    it('adds nothing and asks nothing for a request that never recalled', async () => {
      await expect(getTarsMemoryAttachment({}, ids)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('getTarsMemoryAudit', () => {
    it('keeps the text for the audit while the attachment keeps only ids', async () => {
      fetchMock.mockResolvedValue(
        reply(200, {
          data: {
            memory_context: 'private text',
            retrieval_ms: 12,
            records: [
              {
                id: '1',
                memory_type: 'semantic',
                item_count: 1,
                score: 0.8,
                content: 'fact',
                created_at: 'c',
              },
            ],
          },
        }),
      );
      const req = { user, body: { text: 'q' } };
      await prime(req);
      await expect(getTarsMemoryAudit(req)).resolves.toEqual({
        context_available: true,
        retrieval_ms: 12,
        records: [{ memory_type: 'semantic', score: 0.8, content: 'fact', created_at: 'c' }],
      });
    });

    it('records a failed recall as tried and empty', async () => {
      fetchMock.mockResolvedValue(reply(503, { message: 'warming up' }));
      const req = { user, body: { text: 'q' } };
      await prime(req);
      await expect(getTarsMemoryAudit(req)).resolves.toEqual({
        context_available: false,
        retrieval_ms: null,
        records: [],
      });
    });

    it('has nothing for a turn that never tried', async () => {
      const req = { user: { ...user, personalization: { memories: false } }, body: { text: 'q' } };
      await prime(req);
      await expect(getTarsMemoryAudit(req)).resolves.toBeNull();
      await expect(getTarsMemoryAudit({})).resolves.toBeNull();
    });
  });

  describe('addTarsMemoryContext', () => {
    it('adds the block to the per-turn instructions', () => {
      const agent: { dynamicToolContextMap?: Record<string, unknown> } = {};
      addTarsMemoryContext(agent, 'remembered');
      expect(agent.dynamicToolContextMap?.tars_user_memory).toContain('remembered');
    });

    it('leaves the agent alone with nothing recalled', () => {
      const agent: { dynamicToolContextMap?: Record<string, unknown> } = {};
      addTarsMemoryContext(agent, null);
      expect(agent.dynamicToolContextMap).toBeUndefined();
    });
  });

  describe('temporary chats', () => {
    it.each([
      ['the client flag', { body: { text: 'hi', isTemporary: true } }],
      [
        'a stored temporary chat continued without the flag',
        { body: { text: 'hi' }, resolvedConversation: { isTemporary: true } },
      ],
      [
        'a chat the administrator forces temporary',
        {
          body: { text: 'hi' },
          config: { interfaceConfig: { retentionMode: RetentionMode.EPHEMERAL } },
        },
      ],
    ] as const)('recall nothing when marked by %s', async (_label, req) => {
      await expect(prime({ user, ...req })).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('teach nothing when only the stored conversation says temporary', async () => {
      await scheduleTarsMemoryUpdate(
        { user, resolvedConversation: { isTemporary: true } },
        { conversationId: 'c-1', query: 'hi', response: 'hello', history: [], getRoleByName },
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('enforceTarsMemoryPolicy', () => {
    const withMemory = () => ({ dynamicToolContextMap: { tars_user_memory: 'memo', other: 'x' } });

    it('hands the recalled memory to the memory inspector and keeps what it allows', () => {
      const agent = withMemory();
      const inspect = jest.fn();
      enforceTarsMemoryPolicy(agent, inspect);
      expect(inspect).toHaveBeenCalledWith(['memo']);
      expect(agent.dynamicToolContextMap.tars_user_memory).toBe('memo');
    });

    it('drops only the memory the inspector refuses, so the turn goes on', () => {
      const agent = withMemory();
      expect(() =>
        enforceTarsMemoryPolicy(agent, () => {
          throw new Error('refused');
        }),
      ).not.toThrow();
      expect(agent.dynamicToolContextMap).toEqual({ other: 'x' });
    });

    it('asks nothing of a turn without memory', () => {
      const inspect = jest.fn();
      enforceTarsMemoryPolicy({}, inspect);
      enforceTarsMemoryPolicy({ dynamicToolContextMap: {} }, inspect);
      expect(inspect).not.toHaveBeenCalled();
    });
  });

  describe('scheduleTarsMemoryUpdate', () => {
    it('hands the turn over with the canonical model name', async () => {
      fetchMock.mockResolvedValue(reply(202, { data: {} }));
      await update();
      const { url, headers, body } = lastCall(fetchMock);
      expect(url).toBe('http://tars.test/api/memory/update');
      expect(headers['X-TARS-Domain-Id']).toBe('d-1');
      expect(body).toEqual({
        conversation_id: 'c-1',
        query: 'hello',
        response: 'hi there',
        history: [{ role: 'user', content: 'earlier' }],
        message_id: 'm-1',
        model_name: 'gpt-5.4-mini',
      });
    });

    it('skips a user who turned memory off', async () => {
      await update({ ...user, personalization: { memories: false } });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never asks pwc_tars in manual upkeep', async () => {
      await update({ ...user, personalization: { memoryAutoUpdate: false } });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never rejects', async () => {
      fetchMock.mockRejectedValue(new Error('down'));
      await expect(update()).resolves.toBeUndefined();
    });
  });

  describe('deleteTarsConversationMemories', () => {
    it('sends the conversation ids as the signed user, without repeats', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: {} }));
      await deleteTarsConversationMemories('42', ['c1', 'c2', 'c1', '']);
      const { url, method, headers, body } = lastCall(fetchMock);
      expect(url).toBe('http://tars.test/api/memory/memories/delete_by_conversation');
      expect(method).toBe('POST');
      expect(body).toEqual({ conversation_ids: ['c1', 'c2'] });
      const token = headers.Authorization.replace('Bearer ', '');
      expect((jwt.verify(token, SECRET) as { user_id: string }).user_id).toBe('42');
    });

    it('splits a long list into requests pwc_tars accepts', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: {} }));
      const ids = Array.from({ length: 450 }, (_, i) => `c${i}`);
      await deleteTarsConversationMemories('42', ids);
      const sizes = fetchMock.mock.calls.map(
        ([, init]) => JSON.parse(init.body).conversation_ids.length,
      );
      expect(sizes).toEqual([200, 200, 50]);
    });

    it.each([
      ['an unlinked account', undefined, ['c1']],
      ['no conversations', '42', []],
      ['a missing list', '42', undefined],
    ])('does not call pwc_tars for %s', async (_name, tarsId, ids) => {
      await deleteTarsConversationMemories(tarsId, ids);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never rejects, so a pwc_tars failure cannot fail the conversation delete', async () => {
      fetchMock.mockRejectedValue(new Error('down'));
      await expect(deleteTarsConversationMemories('42', ['c1'])).resolves.toBeUndefined();
    });

    it('never rejects on a list that is not one, since callers do not await it', async () => {
      const notAList = 'c1' as unknown as string[];
      await expect(deleteTarsConversationMemories('42', notAList)).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('handlers', () => {
    const updateMemoryAutoUpdate = jest.fn(async (): Promise<object | null> => ({}));
    const handlers = createTarsMemoryHandlers({ updateMemoryAutoUpdate });

    const run = async (
      handler: keyof typeof handlers,
      req: { user?: unknown; params?: unknown; body?: unknown; config?: unknown },
    ) => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      await handlers[handler](
        { params: {}, ...req } as unknown as Request,
        res as unknown as Response,
      );
      return { status: res.status.mock.calls[0]?.[0] ?? 200, body: res.json.mock.calls[0]?.[0] };
    };

    it('lists the memories of the signed user', async () => {
      const memory = { id: '1', memory_type: 'semantic', content: 'fact' };
      fetchMock.mockResolvedValue(reply(200, { data: [memory] }));
      await expect(run('list', { user })).resolves.toEqual({
        status: 200,
        body: { memories: [memory] },
      });
      expect(lastCall(fetchMock).url).toBe('http://tars.test/api/memory/memories');
    });

    it.each(['false', 'FALSE', '0', ' off '])(
      'says memory is off without asking the store when the switch is %s',
      async (value) => {
        jest.mocked(getTarsSysConfigValue).mockResolvedValueOnce(value);
        await expect(run('list', { user })).resolves.toEqual({
          status: 200,
          body: { memories: [], disabled: true },
        });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('clears as the signed user', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: { cleared: true } }));
      const { status, body } = await run('clear', { user });
      expect(status).toBe(200);
      expect(body).toEqual({ cleared: true });
      const call = lastCall(fetchMock);
      expect(call.url).toBe('http://tars.test/api/memory/memories');
      expect(call.method).toBe('DELETE');
    });

    it('is gone when tars.memoryAssist.enabled is off', async () => {
      const config = { config: { tars: { memoryAssist: { enabled: false } } } };
      const { status } = await run('list', { user, config });
      expect(status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses an unlinked account before reaching pwc_tars', async () => {
      const { status } = await run('list', { user: { id: 'lc-1' } });
      expect(status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('adds as the signed user and answers 201', async () => {
      fetchMock.mockResolvedValue(reply(201, { data: { id: '3', content: '- a' } }));
      const { status, body } = await run('create', { user, body: { content: 'a' } });
      expect(status).toBe(201);
      expect(body).toEqual({ memory: { id: '3', content: '- a' } });
      const call = lastCall(fetchMock);
      expect(call.url).toBe('http://tars.test/api/memory/memories');
      expect(call.method).toBe('POST');
      expect(call.body).toEqual({ content: 'a' });
    });

    it('refuses an empty addition without calling pwc_tars', async () => {
      const { status } = await run('create', { user, body: { content: ' ' } });
      expect(status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('relays the reason pwc_tars refuses an addition', async () => {
      fetchMock.mockResolvedValue(reply(400, { message: 'profile allows at most 30 items' }));
      await expect(run('create', { user, body: { content: 'a' } })).resolves.toEqual({
        status: 400,
        body: { error: 'profile allows at most 30 items' },
      });
    });

    it('returns the edited record, which carries its new id', async () => {
      fetchMock.mockResolvedValue(reply(200, { data: { id: '2', content: 'new' } }));
      const { body } = await run('update', {
        user,
        params: { id: '1' },
        body: { content: 'new' },
      });
      expect(body).toEqual({ memory: { id: '2', content: 'new' } });
      const call = lastCall(fetchMock);
      expect(call.url).toBe('http://tars.test/api/memory/memories/1');
      expect(call.method).toBe('PUT');
    });

    it.each(['../users', '1/2', 'abc'])(
      'refuses the id %s without calling pwc_tars',
      async (id) => {
        const { status } = await run('remove', { user, params: { id } });
        expect(status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('stores the upkeep choice under the acting user', async () => {
      const { body } = await run('preferences', { user, body: { memoryAutoUpdate: false } });
      expect(updateMemoryAutoUpdate).toHaveBeenCalledWith('lc-1', false);
      expect(body).toEqual({ preferences: { memoryAutoUpdate: false } });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('answers 404 when the acting user no longer exists', async () => {
      updateMemoryAutoUpdate.mockResolvedValueOnce(null);
      const { status } = await run('preferences', { user, body: { memoryAutoUpdate: true } });
      expect(status).toBe(404);
    });

    it('answers 500 when the upkeep choice cannot be stored', async () => {
      updateMemoryAutoUpdate.mockRejectedValueOnce(new Error('db down'));
      const { status } = await run('preferences', { user, body: { memoryAutoUpdate: true } });
      expect(status).toBe(500);
    });

    it('refuses an upkeep choice that is not a boolean', async () => {
      const { status } = await run('preferences', { user, body: { memoryAutoUpdate: 'off' } });
      expect(status).toBe(400);
    });

    it('refuses an empty edit', async () => {
      const { status } = await run('update', { user, params: { id: '1' }, body: { content: ' ' } });
      expect(status).toBe(400);
    });

    it.each([
      [404, 404],
      [503, 503],
      [500, 500],
    ])('answers a pwc_tars %i with %i', async (upstream, expected) => {
      fetchMock.mockResolvedValue(reply(upstream, { message: 'detail' }));
      const { status } = await run('remove', { user, params: { id: '1' } });
      expect(status).toBe(expected);
    });
  });
});
