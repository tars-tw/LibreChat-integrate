import type { LangflowFlowDefinition } from './models';
import { fetchFlowAgentModels, findFlowAgentModel, findModelEndpoint } from './models';

const tarsNode = (type: string, template: Record<string, { value?: string }>) => ({
  data: { type, node: { template } },
});

describe('findFlowAgentModel', () => {
  it('reads the model a TarsTool node names in ctx__model_name', () => {
    const flow: LangflowFlowDefinition = {
      data: {
        nodes: [
          { data: { type: 'ChatInput', node: { template: {} } } },
          tarsNode('TarsTool', { ctx__model_name: { value: 'gemini-3.6-flash' } }),
        ],
      },
    };
    expect(findFlowAgentModel(flow)).toBe('gemini-3.6-flash');
  });

  it('falls back to the advanced model_name field, as the component does at run time', () => {
    const flow = {
      data: {
        nodes: [
          tarsNode('TarsTool', {
            ctx__model_name: { value: '' },
            model_name: { value: 'gpt-5.5' },
          }),
        ],
      },
    };
    expect(findFlowAgentModel(flow)).toBe('gpt-5.5');
  });

  it('reads a TarsAgent node, which only has model_name', () => {
    const flow = { data: { nodes: [tarsNode('TarsAgent', { model_name: { value: 'gpt-5.5' } })] } };
    expect(findFlowAgentModel(flow)).toBe('gpt-5.5');
  });

  it('trims whitespace', () => {
    const flow = {
      data: { nodes: [tarsNode('TarsTool', { model_name: { value: '  gpt-5.5 ' } })] },
    };
    expect(findFlowAgentModel(flow)).toBe('gpt-5.5');
  });

  it('returns undefined for a blank model, which means "let pwc_tars pick"', () => {
    const flow = { data: { nodes: [tarsNode('TarsTool', { ctx__model_name: { value: '' } })] } };
    expect(findFlowAgentModel(flow)).toBeUndefined();
  });

  it('ignores nodes that are not TARS components', () => {
    const flow = {
      data: { nodes: [tarsNode('OpenAIModel', { model_name: { value: 'gpt-4o' } })] },
    };
    expect(findFlowAgentModel(flow)).toBeUndefined();
  });

  it('tolerates a missing or empty flow', () => {
    expect(findFlowAgentModel(null)).toBeUndefined();
    expect(findFlowAgentModel({})).toBeUndefined();
    expect(findFlowAgentModel({ data: { nodes: [] } })).toBeUndefined();
  });
});

describe('fetchFlowAgentModels', () => {
  const params = { origin: 'http://langflow.test', apiKey: 'key' };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const respond = (byId: Record<string, LangflowFlowDefinition | number>) =>
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const id = String(input).split('/').pop() as string;
      const flow = byId[id];
      if (typeof flow === 'number') {
        return { ok: false, status: flow } as Response;
      }
      return { ok: true, json: async () => flow } as Response;
    });

  it('maps each flow id to the model its TARS node names', async () => {
    respond({
      a: { data: { nodes: [tarsNode('TarsTool', { ctx__model_name: { value: 'gpt-5.5' } })] } },
      b: {
        data: { nodes: [tarsNode('TarsAgent', { model_name: { value: 'gemini-3.6-flash' } })] },
      },
    });
    const models = await fetchFlowAgentModels({ ...params, flowIds: ['a', 'b'] });
    expect([...models]).toEqual([
      ['a', 'gpt-5.5'],
      ['b', 'gemini-3.6-flash'],
    ]);
  });

  it('omits flows with no TARS node, no model, or a failed fetch', async () => {
    respond({
      pinned: { data: { nodes: [tarsNode('TarsTool', { model_name: { value: 'gpt-5.5' } })] } },
      plain: { data: { nodes: [tarsNode('ChatInput', {})] } },
      blank: { data: { nodes: [tarsNode('TarsTool', { ctx__model_name: { value: '' } })] } },
      broken: 500,
    });
    const models = await fetchFlowAgentModels({
      ...params,
      flowIds: ['pinned', 'plain', 'blank', 'broken'],
    });
    expect([...models.keys()]).toEqual(['pinned']);
  });

  it('makes no request when there is nothing to look up', async () => {
    const spy = respond({});
    expect((await fetchFlowAgentModels({ ...params, flowIds: [] })).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends the api key and reads one flow per request', async () => {
    const spy = respond({ a: { data: { nodes: [] } }, b: { data: { nodes: [] } } });
    await fetchFlowAgentModels({ ...params, flowIds: ['a', 'b'] });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(
      'http://langflow.test/api/v1/flows/a',
      expect.objectContaining({ headers: { 'x-api-key': 'key' } }),
    );
  });
});

describe('findModelEndpoint', () => {
  const modelsConfig = {
    openAI: ['gpt-5.4-mini', 'gpt-5.5'],
    google: ['gemini-3.6-flash'],
    anthropic: [],
    vLLM: ['gemma-4-31B', 'gpt-5.5'],
  };

  it('finds the endpoint that serves the model', () => {
    expect(findModelEndpoint('gemini-3.6-flash', modelsConfig)).toBe('google');
    expect(findModelEndpoint('gemma-4-31B', modelsConfig)).toBe('vLLM');
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(findModelEndpoint(' GEMINI-3.6-FLASH ', modelsConfig)).toBe('google');
  });

  it('prefers the first endpoint listing a model two of them offer', () => {
    expect(findModelEndpoint('gpt-5.5', modelsConfig)).toBe('openAI');
  });

  it('returns undefined for a model no endpoint serves', () => {
    expect(findModelEndpoint('llama-9', modelsConfig)).toBeUndefined();
    expect(findModelEndpoint('', modelsConfig)).toBeUndefined();
    expect(findModelEndpoint('gpt-5.5', {})).toBeUndefined();
  });
});
