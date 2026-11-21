jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { logger } from '@librechat/data-schemas';
import {
  createTarsPrompt,
  deleteTarsPrompt,
  updateTarsPrompt,
  createTarsAgentPrompt,
  updateTarsAgentPrompt,
  fetchTarsAgentPrompts,
  forgetTarsAgentPrompts,
  fetchTarsPromptsForChat,
  renameTarsPromptCategory,
  withTarsAgentPromptCleanup,
  renameTarsAgentPromptCategory,
  fetchTarsDomainKnowledgeBases,
} from './prompts';
import type { TarsPrompt } from './prompts';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const prompt = (id: string, name: string): TarsPrompt => ({
  id,
  name,
  description: null,
  category: 'general',
  content: `content ${name}`,
  status: 1,
  created_by: 'u1',
  created_at: '2024-01-01T00:00:00Z',
});

/** Routes pwc_tars endpoints by URL so call order doesn't matter. */
const routeFetch = (overrides: Record<string, unknown> = {}) =>
  jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/domain_settings/get_domain_by_user')) {
      return buildResponse(200, {
        sys_domains: [
          {
            id: 2,
            name: 'HR',
            description: null,
            role_ids: null,
            knowledge_base_ids: 'kb-1',
            domain_functions: null,
            status: true,
          },
        ],
        ...((overrides.domains as object) ?? {}),
      });
    }
    if (url.includes('/api/prompt/prepare_data_domain')) {
      return buildResponse(200, { prompts: [prompt('d1', 'domain-prompt')] });
    }
    if (url.includes('/api/prompt/prepare_data_km')) {
      return buildResponse(200, {
        prompts: [{ ...prompt('k1', 'kb-prompt'), knowledge_base_name: 'KB One' }],
      });
    }
    if (url.includes('/api/prompt/prepare_data')) {
      return buildResponse(200, { prompts: [prompt('p1', 'personal-prompt')] });
    }
    if (url.includes('/api/knowledge_base/prepare_data')) {
      return buildResponse(200, {
        knowledge_bases: [
          { id: 'kb-1', name: 'KB One' },
          { id: 'kb-2', name: 'KB Two' },
        ],
      });
    }
    return buildResponse(404, {});
  });

describe('fetchTarsPromptsForChat', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns [] without calling pwc_tars when tarsId is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(fetchTarsPromptsForChat('', 2, BASE_URL)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns only personal prompts when no domain is selected', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(routeFetch());
    const result = await fetchTarsPromptsForChat('u1', null, BASE_URL);
    expect(result).toEqual([expect.objectContaining({ id: 'p1', scope: 'personal' })]);
  });

  it('falls back to personal prompts when the domain is outside the user grants', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(routeFetch());
    const result = await fetchTarsPromptsForChat('u1', 999, BASE_URL);
    expect(result).toEqual([expect.objectContaining({ id: 'p1', scope: 'personal' })]);
  });

  it('aggregates the three tiers tagged and ordered domain → kb → personal', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(routeFetch());
    const result = await fetchTarsPromptsForChat('u1', 2, BASE_URL);
    expect(result.map((p) => [p.id, p.scope])).toEqual([
      ['d1', 'domain'],
      ['k1', 'knowledge_base'],
      ['p1', 'personal'],
    ]);
  });
});

describe('fetchTarsDomainKnowledgeBases', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns [] when no domain is selected', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(fetchTarsDomainKnowledgeBases('u1', null, BASE_URL)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the domain's bound knowledge bases to id+name from accessible KBs", async () => {
    jest.spyOn(global, 'fetch').mockImplementation(routeFetch());
    const result = await fetchTarsDomainKnowledgeBases('u1', 2, BASE_URL);
    expect(result).toEqual([{ id: 'kb-1', name: 'KB One' }]);
  });

  it('falls back to the id when a bound KB is not in the accessible set', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(
      jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/domain_settings/get_domain_by_user')) {
          return buildResponse(200, {
            sys_domains: [
              {
                id: 2,
                name: 'HR',
                description: null,
                role_ids: null,
                knowledge_base_ids: 'kb-1,kb-9',
                domain_functions: null,
                status: true,
              },
            ],
          });
        }
        if (url.includes('/api/knowledge_base/prepare_data')) {
          return buildResponse(200, { knowledge_bases: [{ id: 'kb-1', name: 'KB One' }] });
        }
        return buildResponse(404, {});
      }),
    );
    const result = await fetchTarsDomainKnowledgeBases('u1', 2, BASE_URL);
    expect(result).toEqual([
      { id: 'kb-1', name: 'KB One' },
      { id: 'kb-9', name: 'kb-9' },
    ]);
  });
});

describe('renameTarsPromptCategory', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('moves the scope to the new category as the caller, never as a body-supplied user', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'ok', updated_count: 3 }));

    const result = await renameTarsPromptCategory(
      'u1',
      {
        old_category: 'test',
        new_category: '測試',
        domain_id: 208,
        ...({ user_id: 'someone-else' } as object),
      },
      BASE_URL,
    );

    expect(result).toEqual({ updated_count: 3 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE_URL}/api/prompt/rename_category`);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      old_category: 'test',
      new_category: '測試',
      domain_id: 208,
      user_id: 'u1',
      updated_by: 'u1',
    });
  });
});

describe('agent prompts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const okFetch = (body: unknown = { prompt: prompt('p1', 'p') }) =>
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, body));

  const sent = (fetchMock: jest.SpyInstance, index = 0) => {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return {
      url: new URL(String(url)),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
  };

  const input = {
    name: 'n',
    content: 'c',
    category: 'cat',
    knowledge_base_id: 'kb-1',
    domain_id: 2,
    ...({ agent_id: 'agent_forged' } as object),
  };

  it('never lets a body-supplied agent_id reach the generic create and update', async () => {
    const fetchMock = okFetch();

    await createTarsPrompt('u1', input, BASE_URL);
    await updateTarsPrompt('u1', 'p1', input, BASE_URL);

    expect(sent(fetchMock, 0).body).not.toHaveProperty('agent_id');
    expect(sent(fetchMock, 0).body).toMatchObject({ knowledge_base_id: 'kb-1', created_by: 'u1' });
    expect(sent(fetchMock, 1).body).not.toHaveProperty('agent_id');
  });

  it('scopes an agent prompt to the authorized agent alone', async () => {
    const fetchMock = okFetch();

    await createTarsAgentPrompt('u1', 'agent_a', input, BASE_URL);
    await updateTarsAgentPrompt('u1', 'agent_a', 'p1', input, BASE_URL);

    const created = sent(fetchMock, 0);
    expect(created.url.pathname).toBe('/api/prompt/create_prompt');
    expect(created.body).toEqual({
      name: 'n',
      content: 'c',
      category: 'cat',
      agent_id: 'agent_a',
      created_by: 'u1',
    });
    const updated = sent(fetchMock, 1);
    expect(updated.url.pathname).toBe('/api/prompt/update_prompt/p1');
    expect(updated.method).toBe('PUT');
    expect(updated.body).toEqual({
      name: 'n',
      content: 'c',
      category: 'cat',
      agent_id: 'agent_a',
      updated_by: 'u1',
    });
  });

  it('renames an agent category with agent_id only, and the generic rename never sends one', async () => {
    const fetchMock = okFetch({ updated_count: 2 });
    const rename = { old_category: 'a', new_category: 'b', knowledge_base_id: 'kb-1' };

    expect(await renameTarsAgentPromptCategory('u1', 'agent_a', rename, BASE_URL)).toEqual({
      updated_count: 2,
    });
    await renameTarsPromptCategory('u1', { ...rename, ...({ agent_id: 'x' } as object) }, BASE_URL);

    expect(sent(fetchMock, 0).body).toEqual({
      old_category: 'a',
      new_category: 'b',
      agent_id: 'agent_a',
      user_id: 'u1',
      updated_by: 'u1',
    });
    expect(sent(fetchMock, 1).body).not.toHaveProperty('agent_id');
  });

  it('lists and deletes by agent', async () => {
    const fetchMock = okFetch({ prompts: [prompt('p1', 'p')] });

    expect(await fetchTarsAgentPrompts('agent_a', BASE_URL)).toHaveLength(1);
    await deleteTarsPrompt('p1', { agentId: 'agent_a' }, BASE_URL);

    expect(sent(fetchMock, 0).url.pathname).toBe('/api/prompt/prepare_data_agent');
    expect(sent(fetchMock, 0).url.searchParams.get('agent_id')).toBe('agent_a');
    const removed = sent(fetchMock, 1);
    expect(removed.method).toBe('DELETE');
    expect(removed.url.pathname).toBe('/api/prompt/delete_prompt/p1');
    expect(removed.url.searchParams.get('agent_id')).toBe('agent_a');
  });

  it("drops a deleted agent's prompts and only logs a failure", async () => {
    const fetchMock = okFetch({ deleted_count: 3 });

    await forgetTarsAgentPrompts('agent_a', BASE_URL);

    const removed = sent(fetchMock, 0);
    expect(removed.method).toBe('DELETE');
    expect(removed.url.pathname).toBe('/api/prompt/delete_agent_prompts');
    expect(removed.url.searchParams.get('agent_id')).toBe('agent_a');

    fetchMock.mockResolvedValue(buildResponse(500, { error: 'boom' }));
    await expect(forgetTarsAgentPrompts('agent_a', BASE_URL)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('cleans up only after a delete that removed the agent', async () => {
    const fetchMock = okFetch({ deleted_count: 1 });
    const saved = process.env.TARS_AUTH_URL;
    process.env.TARS_AUTH_URL = BASE_URL;
    try {
      const missing = withTarsAgentPromptCleanup(async (_search: { id: string }) => null);
      await missing({ id: 'agent_x' });
      expect(fetchMock).not.toHaveBeenCalled();

      const removed = withTarsAgentPromptCleanup(async (search: { id: string }) => search);
      expect(await removed({ id: 'agent_a' })).toEqual({ id: 'agent_a' });
      await new Promise((resolve) => setImmediate(resolve));
      expect(sent(fetchMock, 0).url.searchParams.get('agent_id')).toBe('agent_a');
    } finally {
      process.env.TARS_AUTH_URL = saved;
    }
  });
});
