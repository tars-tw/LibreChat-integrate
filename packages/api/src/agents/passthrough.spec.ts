import { resolvePassthroughModel, buildPassthroughGetAgent } from './passthrough';
import type { AppConfig } from '@librechat/data-schemas';
import type { LoadAgentDeps, LoadAgentParams } from './load';

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

describe('resolvePassthroughModel', () => {
  it('parses a provider-prefixed model', () => {
    expect(resolvePassthroughModel('openAI/gpt-5.4-mini')).toEqual({
      ok: true,
      value: { endpoint: 'openAI', model: 'gpt-5.4-mini' },
    });
  });

  it('keeps slashes in the model remainder', () => {
    const result = resolvePassthroughModel('openAI/org/model-x');
    expect(result.ok && result.value).toEqual({ endpoint: 'openAI', model: 'org/model-x' });
  });

  it('rejects an unprefixed model', () => {
    expect(resolvePassthroughModel('gpt-5.4-mini').ok).toBe(false);
  });

  it('rejects leading and trailing slashes', () => {
    expect(resolvePassthroughModel('/gpt').ok).toBe(false);
    expect(resolvePassthroughModel('openAI/').ok).toBe(false);
  });

  it('rejects an unknown provider', () => {
    expect(resolvePassthroughModel('bogus/x').ok).toBe(false);
  });

  it('accepts a configured custom endpoint', () => {
    const appConfig = {
      endpoints: { custom: [{ name: 'myllm' }] },
    } as unknown as AppConfig;
    const result = resolvePassthroughModel('myllm/model-a', appConfig);
    expect(result.ok && result.value).toEqual({ endpoint: 'myllm', model: 'model-a' });
  });
});

describe('buildPassthroughGetAgent', () => {
  const deps: LoadAgentDeps = {
    getAgent: jest.fn(),
    getMCPServerTools: jest.fn(),
  };

  function makeReq(body: Record<string, unknown>): LoadAgentParams['req'] {
    return {
      user: { id: 'u1' },
      config: { endpoints: {} } as AppConfig,
      body,
    } as unknown as LoadAgentParams['req'];
  }

  afterEach(() => jest.clearAllMocks());

  it('builds a bare ephemeral agent and maps sampling params', async () => {
    const req = makeReq({
      model: 'openAI/gpt-5.4-mini',
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 128,
    });
    const getAgent = buildPassthroughGetAgent(
      req,
      { endpoint: 'openAI', model: 'gpt-5.4-mini' },
      deps,
    );

    const agent = await getAgent({ id: 'openAI/gpt-5.4-mini' });

    expect(agent?.provider).toBe('openAI');
    expect(agent?.model).toBe('gpt-5.4-mini');
    expect(agent?.tools).toEqual([]);
    expect(agent?.instructions).toBeUndefined();
    expect(agent?.model_parameters).toMatchObject({ temperature: 0.2, topP: 0.9, maxTokens: 128 });
  });

  it('drops promptPrefix and ephemeralAgent toggles so the model stays bare', async () => {
    const req = makeReq({
      model: 'openAI/gpt-5.4-mini',
      promptPrefix: 'leak',
      ephemeralAgent: { web_search: true, execute_code: true },
    });
    const getAgent = buildPassthroughGetAgent(
      req,
      { endpoint: 'openAI', model: 'gpt-5.4-mini' },
      deps,
    );

    const agent = await getAgent({ id: 'x' });

    expect(agent?.tools).toEqual([]);
    expect(agent?.instructions).toBeUndefined();
    expect(deps.getMCPServerTools).not.toHaveBeenCalled();
  });
});
