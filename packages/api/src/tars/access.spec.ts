jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import jwt from 'jsonwebtoken';
import { PermissionBits, ResourceType } from 'librechat-data-provider';
import type { JwtPayload } from 'jsonwebtoken';
import {
  fetchTarsChatPrompts,
  resolveTarsChatPromptAgent,
  fetchTarsKnowledgeBaseShareCheck,
  saveTarsKnowledgeBaseChatAssignees,
  fetchTarsKnowledgeBaseChatAssignees,
} from './access';
import { listTarsScopedKnowledgeBases, invalidateTarsScopedKnowledgeBasesCache } from './scope';
import { TarsRequestError } from './client';

const BASE_URL = 'http://tars.test';
const SECRET = 'access-secret-access-secret-access-1234';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const envelope = (data?: unknown) => ({ success: true, data });

/** pwc_tars checks the caller against the knowledge base, so both calls are signed as the user. */
const requestOf = (fetchMock: jest.SpyInstance, index = 0) => {
  const [input, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  const url = new URL(String(input));
  const headers = init.headers as Record<string, string>;
  return {
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    method: init.method ?? 'GET',
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    actingUser: (
      jwt.verify(headers.Authorization.slice('Bearer '.length), SECRET, {
        algorithms: ['HS256'],
      }) as JwtPayload
    ).user_id,
  };
};

describe('knowledge base chat list', () => {
  const saved = { secret: process.env.TARS_JWT_SECRET, url: process.env.TARS_AUTH_URL };

  beforeEach(() => {
    process.env.TARS_JWT_SECRET = SECRET;
    process.env.TARS_AUTH_URL = BASE_URL;
    invalidateTarsScopedKnowledgeBasesCache();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    for (const [key, value] of [
      ['TARS_JWT_SECRET', saved.secret],
      ['TARS_AUTH_URL', saved.url],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('reads the assignees as the acting user', async () => {
    const principals = [
      { principal_type: 'group', principal_id: 'g1', name: '人資處', email: null, is_active: true },
    ];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(
          200,
          envelope({ knowledge_base_id: 'kb1', knowledge_base_name: 'HR', principals }),
        ),
      );

    await expect(fetchTarsKnowledgeBaseChatAssignees('u1', 'kb1')).resolves.toEqual(principals);
    expect(requestOf(fetchMock)).toEqual({
      path: '/api/km_permission/assignments',
      query: { knowledge_base_id: 'kb1' },
      method: 'GET',
      body: undefined,
      actingUser: 'u1',
    });
  });

  it('reads nothing from a bare reply', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true }));

    await expect(fetchTarsKnowledgeBaseChatAssignees('u1', 'kb1')).resolves.toEqual([]);
  });

  it('saves the list as the acting user, sending only the id and principals', async () => {
    const result = {
      knowledge_base_id: 'kb1',
      knowledge_base_name: 'HR',
      user_count: 1,
      group_count: 0,
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope(result)));
    const principals = [{ principal_type: 'user' as const, principal_id: 'u2' }];

    await expect(saveTarsKnowledgeBaseChatAssignees('u1', 'kb1', { principals })).resolves.toEqual(
      result,
    );
    expect(requestOf(fetchMock)).toEqual({
      path: '/api/km_permission/assignments/save',
      query: {},
      method: 'POST',
      body: { knowledge_base_id: 'kb1', principals },
      actingUser: 'u1',
    });
  });

  it('relays a refusal from pwc_tars', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(403, { success: false, message: '沒有權限設定這個知識庫' }));

    await expect(
      saveTarsKnowledgeBaseChatAssignees('u1', 'kb1', { principals: [] }),
    ).rejects.toBeInstanceOf(TarsRequestError);
  });

  it('asks pwc_tars which share targets lack the knowledge bases, without signing as anyone', async () => {
    const data = {
      knowledge_bases: [{ id: 'kb1', name: 'HR' }],
      missing: [
        {
          principal_type: 'group',
          principal_id: 'g1',
          knowledge_bases: [{ id: 'kb1', name: 'HR' }],
        },
      ],
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, envelope(data)));
    const principals = [{ principal_type: 'group' as const, principal_id: 'g1' }];

    await expect(fetchTarsKnowledgeBaseShareCheck(['kb1'], principals)).resolves.toEqual(data);
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(String(input)).pathname).toBe('/api/km_permission/share_check');
    expect(JSON.parse(String(init.body))).toEqual({ knowledge_base_ids: ['kb1'], principals });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('reads an empty share check from a bare reply', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true }));

    await expect(fetchTarsKnowledgeBaseShareCheck(['kb1'], [])).resolves.toEqual({
      knowledge_bases: [],
      missing: [],
    });
  });

  it('drops the cached chat scopes after a save, so the next turn sees the new list', async () => {
    let chatList = [{ id: 'kb1', name: 'HR', description: null }];
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/km_permission/chat_knowledge_bases')) {
        return buildResponse(200, envelope(chatList));
      }
      if (url.includes('/api/km_permission/assignments/save')) {
        return buildResponse(
          200,
          envelope({ knowledge_base_id: 'kb2', user_count: 1, group_count: 0 }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    expect((await listTarsScopedKnowledgeBases('u2')).map((kb) => kb.id)).toEqual(['kb1']);
    chatList = [...chatList, { id: 'kb2', name: '規章', description: null }];
    expect((await listTarsScopedKnowledgeBases('u2')).map((kb) => kb.id)).toEqual(['kb1']);

    await saveTarsKnowledgeBaseChatAssignees('u1', 'kb2', {
      principals: [{ principal_type: 'user', principal_id: 'u2' }],
    });

    expect((await listTarsScopedKnowledgeBases('u2')).map((kb) => kb.id)).toEqual(['kb1', 'kb2']);
    const listings = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/km_permission/chat_knowledge_bases'),
    );
    expect(listings).toHaveLength(2);
  });

  describe('fetchTarsChatPrompts', () => {
    const prompt = (id: string, extra: object = {}) => ({
      id,
      name: id,
      description: null,
      category: null,
      content: id,
      status: 1,
      created_by: 'u1',
      created_at: '2026-11-08',
      ...extra,
    });

    const mockPrompts = () =>
      jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/prompt/prepare_data') {
          return buildResponse(200, { prompts: [prompt('mine')] });
        }
        if (url.pathname === '/api/km_permission/chat_knowledge_bases') {
          return buildResponse(
            200,
            envelope([
              { id: 'kb1', name: 'HR', description: null },
              { id: 'kb2', name: '規章', description: null },
            ]),
          );
        }
        if (url.pathname === '/api/prompt/prepare_data_agent') {
          const agent = url.searchParams.get('agent_id');
          return buildResponse(200, { prompts: [prompt(`${agent}-p`, { agent_id: agent })] });
        }
        if (url.pathname === '/api/prompt/prepare_data_km') {
          const kb = url.searchParams.get('knowledge_base_id');
          return buildResponse(200, {
            prompts: [prompt(`${kb}-p`, kb === 'kb2' ? { knowledge_base_name: '公司規章' } : {})],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

    it("lists the picked knowledge bases' prompts the user may reach, then their own", async () => {
      const fetchMock = mockPrompts();

      const result = await fetchTarsChatPrompts('u1', ['kb1', 'kb2', 'kb-other']);

      expect(result.knowledgeBases).toEqual([
        { id: 'kb1', name: 'HR' },
        { id: 'kb2', name: '規章' },
      ]);
      expect(result.prompts.map((p) => [p.id, p.scope, p.knowledge_base_name])).toEqual([
        ['kb1-p', 'knowledge_base', 'HR'],
        ['kb2-p', 'knowledge_base', '公司規章'],
        ['mine', 'personal', undefined],
      ]);
      const asked = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
      expect(
        asked
          .filter((url) => url.pathname === '/api/prompt/prepare_data_km')
          .map((url) => url.searchParams.get('knowledge_base_id')),
      ).toEqual(['kb1', 'kb2']);
      expect(asked.some((url) => url.pathname.includes('domain'))).toBe(false);
    });

    it('lists only personal prompts without picks, never asking for the chat list', async () => {
      const fetchMock = mockPrompts();

      const result = await fetchTarsChatPrompts('u1', []);

      expect(result).toEqual({
        prompts: [expect.objectContaining({ id: 'mine', scope: 'personal' })],
        knowledgeBases: [],
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("lists the authorized agent's prompts first, tagged with its name", async () => {
      const fetchMock = mockPrompts();

      const result = await fetchTarsChatPrompts('u1', ['kb1'], { id: 'agent_a', name: '客服' });

      expect(result.prompts.map((p) => [p.id, p.scope, p.agent_name])).toEqual([
        ['agent_a-p', 'agent', '客服'],
        ['kb1-p', 'knowledge_base', undefined],
        ['mine', 'personal', undefined],
      ]);
      const agentCalls = fetchMock.mock.calls
        .map(([url]) => new URL(String(url)))
        .filter((url) => url.pathname === '/api/prompt/prepare_data_agent');
      expect(agentCalls.map((url) => url.searchParams.get('agent_id'))).toEqual(['agent_a']);
    });
  });

  describe('resolveTarsChatPromptAgent', () => {
    const stored = { _id: 'oid-1', id: 'agent_a', name: '客服' };

    const deps = (agent: typeof stored | null, allowed: boolean, managesAll = false) => ({
      getAgent: jest.fn(async () => agent),
      hasCapability: jest.fn(async () => managesAll),
      checkPermission: jest.fn(async () => allowed),
    });

    it('returns the agent when the user may view it', async () => {
      const d = deps(stored, true);

      const agent = await resolveTarsChatPromptAgent({ id: 'u1', role: 'USER' }, 'agent_a', d);

      expect(agent).toEqual({ id: 'agent_a', name: '客服' });
      expect(d.getAgent).toHaveBeenCalledWith({ id: 'agent_a' });
      expect(d.checkPermission).toHaveBeenCalledWith({
        userId: 'u1',
        role: 'USER',
        resourceType: ResourceType.AGENT,
        resourceId: 'oid-1',
        requiredPermission: PermissionBits.VIEW,
      });
    });

    it('lets a role that manages all agents past the ACL, as the agent routes do', async () => {
      const d = deps(stored, false, true);

      const agent = await resolveTarsChatPromptAgent({ id: 'u1', role: 'ADMIN' }, 'agent_a', d);

      expect(agent).toEqual({ id: 'agent_a', name: '客服' });
      expect(d.hasCapability).toHaveBeenCalledWith({ id: 'u1', role: 'ADMIN' }, 'manage:agents');
      expect(d.checkPermission).not.toHaveBeenCalled();
    });

    it('falls back to the ACL when the capability check fails', async () => {
      const d = deps(stored, true);
      d.hasCapability.mockRejectedValue(new Error('down'));

      expect(await resolveTarsChatPromptAgent({ id: 'u1' }, 'agent_a', d)).toEqual({
        id: 'agent_a',
        name: '客服',
      });
    });

    it('returns nothing for an agent the user may not view', async () => {
      expect(await resolveTarsChatPromptAgent({ id: 'u1' }, 'agent_a', deps(stored, false))).toBe(
        null,
      );
    });

    it('returns nothing for a missing agent or no agent id, without a permission check', async () => {
      const missing = deps(null, true);
      expect(await resolveTarsChatPromptAgent({ id: 'u1' }, 'agent_x', missing)).toBe(null);
      expect(missing.checkPermission).not.toHaveBeenCalled();

      const none = deps(stored, true);
      expect(await resolveTarsChatPromptAgent({ id: 'u1' }, undefined, none)).toBe(null);
      expect(none.getAgent).not.toHaveBeenCalled();
    });

    it('falls back to the id for an unnamed agent', async () => {
      const agent = await resolveTarsChatPromptAgent(
        { id: 'u1' },
        'agent_a',
        deps({ ...stored, name: '' }, true),
      );
      expect(agent).toEqual({ id: 'agent_a', name: 'agent_a' });
    });
  });
});
