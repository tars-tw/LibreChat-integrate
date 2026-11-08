jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { Constants } from 'librechat-data-provider';
import {
  tarsSwitchScope,
  isTarsSavedAgentChat,
  tarsAgentKnowledgeBasesOf,
  fetchTarsChatKnowledgeBases,
  listTarsScopedKnowledgeBases,
  invalidateTarsScopedKnowledgeBasesCache,
} from './scope';

const BASE_URL = 'http://tars.test';
const USER_ID = 'tars-user-1';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

/** The user's chat list (`km_permission`): two of the brain's three knowledge bases, plus one elsewhere. */
const chatList = [
  { id: 'kb-general', name: '通用知識庫', description: null, has_sql_database: true },
  { id: 'kb-hr', name: '人資知識庫', description: null, has_sql_database: false },
  { id: 'kb-other', name: '別的腦', description: null, has_sql_database: false },
];

/** Domain 100 binds kb-general, kb-hr and kb-finance; the user is not on kb-finance's chat list. */
const domains = {
  sys_domains: [{ id: 100, name: '通用腦', knowledge_base_ids: 'kb-general,kb-hr,kb-finance' }],
};

const mockBackend = () =>
  jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/km_permission/chat_knowledge_bases')) {
      return buildResponse(200, { success: true, data: chatList });
    }
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, domains);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

const urlsOf = (fetchMock: jest.SpyInstance) => fetchMock.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  invalidateTarsScopedKnowledgeBasesCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchTarsChatKnowledgeBases', () => {
  it("asks pwc_tars for the user's chat list", async () => {
    const fetchMock = mockBackend();

    await expect(fetchTarsChatKnowledgeBases(USER_ID)).resolves.toEqual(chatList);
    const url = new URL(urlsOf(fetchMock)[0]);
    expect(url.pathname).toBe('/api/km_permission/chat_knowledge_bases');
    expect(url.searchParams.get('user_id')).toBe(USER_ID);
  });

  it('reads nothing from a bare reply', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true }));

    await expect(fetchTarsChatKnowledgeBases(USER_ID)).resolves.toEqual([]);
  });
});

describe('listTarsScopedKnowledgeBases', () => {
  it("narrows the chat list to the brain's knowledge bases", async () => {
    mockBackend();

    const bases = await listTarsScopedKnowledgeBases(USER_ID, 100);

    expect(bases.map((base) => base.id)).toEqual(['kb-general', 'kb-hr']);
  });

  it('never consults the management list', async () => {
    const fetchMock = mockBackend();

    await listTarsScopedKnowledgeBases(USER_ID, 100);

    expect(urlsOf(fetchMock).some((url) => url.includes('/api/knowledge_base/prepare_data'))).toBe(
      false,
    );
  });

  it('is the whole chat list without a brain', async () => {
    mockBackend();

    const bases = await listTarsScopedKnowledgeBases(USER_ID);

    expect(bases.map((base) => base.id)).toEqual(['kb-general', 'kb-hr', 'kb-other']);
  });

  it('is empty for a brain the user cannot reach', async () => {
    mockBackend();

    await expect(listTarsScopedKnowledgeBases(USER_ID, 999)).resolves.toEqual([]);
  });

  it('is empty for an unlinked account without calling pwc_tars', async () => {
    const fetchMock = mockBackend();

    await expect(listTarsScopedKnowledgeBases('', 100)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches per user and brain until invalidated', async () => {
    const fetchMock = mockBackend();
    const listings = () =>
      urlsOf(fetchMock).filter((url) => url.includes('/api/km_permission/chat_knowledge_bases'));

    await listTarsScopedKnowledgeBases(USER_ID, 100);
    await listTarsScopedKnowledgeBases(USER_ID, 100);
    expect(listings()).toHaveLength(1);

    await listTarsScopedKnowledgeBases(USER_ID);
    expect(listings()).toHaveLength(2);

    invalidateTarsScopedKnowledgeBasesCache();
    await listTarsScopedKnowledgeBases(USER_ID, 100);
    expect(listings()).toHaveLength(3);
  });
});

describe('a saved agent picks its own knowledge bases', () => {
  it('narrows the chat list to the picks and never asks for a brain', async () => {
    const fetchMock = mockBackend();

    const bases = await listTarsScopedKnowledgeBases(USER_ID, {
      knowledgeBaseIds: ['kb-hr', 'kb-finance', 'kb-other'],
    });

    expect(bases.map((base) => base.id)).toEqual(['kb-hr', 'kb-other']);
    expect(urlsOf(fetchMock).some((url) => url.includes('get_domain_by_user'))).toBe(false);
  });

  it('reaches nothing when nothing is picked, without calling pwc_tars', async () => {
    const fetchMock = mockBackend();

    await expect(listTarsScopedKnowledgeBases(USER_ID, { knowledgeBaseIds: [] })).resolves.toEqual(
      [],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches picks apart from brains, whatever their order', async () => {
    const fetchMock = mockBackend();
    const listings = () =>
      urlsOf(fetchMock).filter((url) => url.includes('/api/km_permission/chat_knowledge_bases'));

    await listTarsScopedKnowledgeBases(USER_ID, { knowledgeBaseIds: ['kb-hr', 'kb-general'] });
    await listTarsScopedKnowledgeBases(USER_ID, { knowledgeBaseIds: ['kb-general', 'kb-hr'] });
    expect(listings()).toHaveLength(1);

    await listTarsScopedKnowledgeBases(USER_ID, 100);
    expect(listings()).toHaveLength(2);
  });
});

describe('agent picks helpers', () => {
  it('reads picks off a saved agent only', () => {
    const picks = { rag_agent: ['kb-hr'] };

    expect(tarsAgentKnowledgeBasesOf({ id: 'agent_abc', tars_knowledge_bases: picks })).toBe(picks);
    expect(tarsAgentKnowledgeBasesOf({ id: 'agent_abc' })).toEqual({});
    expect(
      tarsAgentKnowledgeBasesOf({
        id: String(Constants.EPHEMERAL_AGENT_ID),
        tars_knowledge_bases: picks,
      }),
    ).toBeUndefined();
    expect(tarsAgentKnowledgeBasesOf(undefined)).toBeUndefined();
  });

  it("scopes a switch to the agent's picks, else to the brain", () => {
    const picks = { rag_agent: ['kb-hr'] };

    expect(tarsSwitchScope(picks, 'rag_agent', 100)).toEqual({ knowledgeBaseIds: ['kb-hr'] });
    expect(tarsSwitchScope(picks, 'sql_agent', 100)).toEqual({ knowledgeBaseIds: [] });
    expect(tarsSwitchScope(undefined, 'rag_agent', 100)).toBe(100);
  });

  it('tells a saved agent chat from an ephemeral one', () => {
    expect(isTarsSavedAgentChat({ agent_id: 'agent_abc' })).toBe(true);
    expect(isTarsSavedAgentChat({ agent_id: String(Constants.EPHEMERAL_AGENT_ID) })).toBe(false);
    expect(isTarsSavedAgentChat({})).toBe(false);
    expect(isTarsSavedAgentChat(undefined)).toBe(false);
  });
});
