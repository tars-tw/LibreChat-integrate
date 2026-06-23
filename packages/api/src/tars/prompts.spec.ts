jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { fetchTarsPromptsForChat, fetchTarsDomainKnowledgeBases } from './prompts';
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
