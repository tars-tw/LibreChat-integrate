jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import path from 'path';
import { logger } from '@librechat/data-schemas';
import { AIMessageChunk } from '@librechat/agents/langchain/messages';
import type { TarsVertexDeps } from './vertex';
import {
  createTarsVertex,
  isTarsVertexModel,
  toTarsVertexModelId,
  tarsVertexModelMetadata,
  withTarsVertexUsageModel,
} from './vertex';
import { loadServiceKey } from '~/utils';

const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'acme-gemini',
  private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
  client_email: 'tars@acme-gemini.iam.gserviceaccount.com',
};

function createDeps(
  vertexKey: string | undefined,
  profiles: string[] | null = [],
  endpoint?: string | null,
): TarsVertexDeps & { parseServiceKey: jest.Mock } {
  return {
    getSysConfigValue: jest.fn(async (key: string) =>
      key === 'KEY_VERTEX_AI_API' ? vertexKey : undefined,
    ),
    getModelProfileNames: jest.fn(async () => profiles),
    getModelProfileEndpoint: jest.fn(async () => endpoint),
    parseServiceKey: jest.fn(loadServiceKey),
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('isTarsVertexModel', () => {
  it.each([
    ['gemini-3.5-flash(enterprise)', true],
    ['gemini-3.8-flash (enterprise)', true],
    ['Gemini-3.1-Pro-Preview(Enterprise)', true],
    ['gemini-3.5-flash', false],
    ['gpt-5.4-mini(enterprise)', false],
    ['', false],
  ])('%s → %s', (model, expected) => {
    expect(isTarsVertexModel(model)).toBe(expected);
  });

  it('treats a missing model as not Vertex', () => {
    expect(isTarsVertexModel(undefined)).toBe(false);
    expect(isTarsVertexModel(null)).toBe(false);
  });
});

describe('toTarsVertexModelId', () => {
  it('strips the marker in any case to the Vertex AI model id', () => {
    expect(toTarsVertexModelId('gemini-3.5-flash(enterprise)')).toBe('gemini-3.5-flash');
    expect(toTarsVertexModelId('gemini-3.8-flash (Enterprise)')).toBe('gemini-3.8-flash');
  });

  it('leaves an unmarked name as is', () => {
    expect(toTarsVertexModelId('gemini-3.5-flash')).toBe('gemini-3.5-flash');
  });
});

describe('withTarsVertexUsageModel', () => {
  const usage = { model: 'gemini-3.8-flash', input_tokens: 10 };

  it('renames usage to the profile its model metadata names', () => {
    const metadata = tarsVertexModelMetadata('gemini-3.8-flash (enterprise)');
    expect(withTarsVertexUsageModel(usage, metadata)).toEqual({
      model: 'gemini-3.8-flash (enterprise)',
      input_tokens: 10,
    });
  });

  it('leaves usage of any other model call untouched', () => {
    expect(withTarsVertexUsageModel(usage, { tars_model: '' })).toBe(usage);
    expect(withTarsVertexUsageModel(usage, {})).toBe(usage);
    expect(withTarsVertexUsageModel(usage, undefined)).toBe(usage);
  });

  it('keeps the name of a call that inherited the metadata on another model', () => {
    const summary = { model: 'gemini-3.5-flash-lite', input_tokens: 4 };
    const metadata = tarsVertexModelMetadata('gemini-3.8-flash (enterprise)');
    expect(withTarsVertexUsageModel(summary, metadata)).toBe(summary);
  });

  it('names usage that reports no model after the profile', () => {
    const metadata = tarsVertexModelMetadata('gemini-3.8-flash (enterprise)');
    const unnamed: { model?: string; input_tokens: number } = { input_tokens: 10 };
    expect(withTarsVertexUsageModel(unnamed, metadata)).toEqual({
      model: 'gemini-3.8-flash (enterprise)',
      input_tokens: 10,
    });
  });
});

describe('withTarsVertexUsageModel on client options', () => {
  const metadata = tarsVertexModelMetadata('gemini-3.5-flash(enterprise)');

  it('reads the metadata the options carry', () => {
    expect(withTarsVertexUsageModel({ model: 'gemini-3.5-flash', metadata }).model).toBe(
      'gemini-3.5-flash(enterprise)',
    );
  });

  it('keeps the model of options without the metadata, or on another model', () => {
    expect(withTarsVertexUsageModel({ model: 'gpt-5.4-mini' }).model).toBe('gpt-5.4-mini');
    expect(withTarsVertexUsageModel({ model: 'gemini-2.5-flash', metadata }).model).toBe(
      'gemini-2.5-flash',
    );
    expect(withTarsVertexUsageModel({ model: 'gemini-2.5-flash', metadata: null }).model).toBe(
      'gemini-2.5-flash',
    );
  });
});

describe('model metadata through LangChain', () => {
  const vertexModule = path.join(
    path.dirname(require.resolve('@librechat/agents')),
    'llm/vertexai/index.cjs',
  );

  it('reaches the model-end event next to the bare id, where usage is tagged', async () => {
    const { ChatVertexAI } = jest.requireActual(vertexModule);
    const model = new ChatVertexAI({
      model: 'gemini-3.5-flash',
      location: 'global',
      authOptions: { credentials: SERVICE_ACCOUNT, projectId: SERVICE_ACCOUNT.project_id },
      metadata: tarsVertexModelMetadata('gemini-3.5-flash(enterprise)'),
    });
    jest.spyOn(model, '_streamResponseChunks').mockImplementation(async function* () {
      yield { text: 'hi', message: new AIMessageChunk('hi'), generationInfo: {} };
    });

    let metadata: Record<string, string> | undefined;
    for await (const event of model.streamEvents('hi', { version: 'v2' })) {
      if (event.event === 'on_chat_model_end') {
        metadata = event.metadata;
      }
    }

    expect(metadata?.ls_model_name).toBe('gemini-3.5-flash');
    expect(withTarsVertexUsageModel({ model: metadata?.ls_model_name }, metadata).model).toBe(
      'gemini-3.5-flash(enterprise)',
    );
  });
});

describe('createTarsVertex().getServiceKey', () => {
  it('parses the service account JSON stored in KEY_VERTEX_AI_API', async () => {
    const deps = createDeps(JSON.stringify(SERVICE_ACCOUNT));

    const key = await createTarsVertex(deps).getServiceKey();

    expect(deps.getSysConfigValue).toHaveBeenCalledWith('KEY_VERTEX_AI_API');
    expect(key).toMatchObject({
      project_id: 'acme-gemini',
      client_email: SERVICE_ACCOUNT.client_email,
    });
  });

  it('parses a value once and again only after it changes', async () => {
    const deps = createDeps(JSON.stringify(SERVICE_ACCOUNT));
    const vertex = createTarsVertex(deps);

    await vertex.getServiceKey();
    await vertex.getServiceKey();
    expect(deps.parseServiceKey).toHaveBeenCalledTimes(1);

    (deps.getSysConfigValue as jest.Mock).mockResolvedValue(
      JSON.stringify({ ...SERVICE_ACCOUNT, project_id: 'rotated' }),
    );
    await expect(vertex.getServiceKey()).resolves.toMatchObject({ project_id: 'rotated' });
    expect(deps.parseServiceKey).toHaveBeenCalledTimes(2);
  });

  it('parses and reports once when concurrent reads race on a new value', async () => {
    const deps = createDeps('{"not":"a service account"}');
    const vertex = createTarsVertex(deps);

    await Promise.all([vertex.getServiceKey(), vertex.withModels([]), vertex.getServiceKey()]);

    expect(deps.parseServiceKey).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('treats a parser failure as an unusable key rather than failing every later read', async () => {
    const deps = createDeps(JSON.stringify(SERVICE_ACCOUNT));
    deps.parseServiceKey.mockRejectedValue(new Error('boom'));
    const vertex = createTarsVertex(deps);

    await expect(vertex.getServiceKey()).resolves.toBeUndefined();
    await expect(vertex.getServiceKey()).resolves.toBeUndefined();

    expect(deps.parseServiceKey).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('ignores a static API key and reports it once per value', async () => {
    const deps = createDeps('AIza-static');
    const vertex = createTarsVertex(deps);

    await expect(vertex.getServiceKey()).resolves.toBeUndefined();
    await expect(vertex.getServiceKey()).resolves.toBeUndefined();

    expect(deps.parseServiceKey).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an OAuth client', JSON.stringify({ installed: { client_id: 'x', client_secret: 'y' } })],
    ['a key without its project', JSON.stringify({ ...SERVICE_ACCOUNT, project_id: undefined })],
    ['an empty object', '{}'],
    ['malformed JSON', '{"type": "service_account"'],
  ])('ignores %s and reports it once per value', async (_label, value) => {
    const deps = createDeps(value);
    const vertex = createTarsVertex(deps);

    await expect(vertex.getServiceKey()).resolves.toBeUndefined();
    await expect(vertex.getServiceKey()).resolves.toBeUndefined();

    expect(deps.parseServiceKey).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('is undefined when the row is unset', async () => {
    await expect(createTarsVertex(createDeps(undefined)).getServiceKey()).resolves.toBeUndefined();
  });
});

describe('createTarsVertex().withModels', () => {
  const profiles = [
    'gpt-5.4-mini',
    'gemini-3.5-flash',
    'gemini-3.5-flash(enterprise)',
    'gemini-2.5-pro(enterprise)',
  ];

  it('appends only the Vertex model_profile names, without duplicates', async () => {
    const vertex = createTarsVertex(createDeps(JSON.stringify(SERVICE_ACCOUNT), profiles));

    await expect(
      vertex.withModels(['gemini-3.5-flash', 'gemini-2.5-pro(enterprise)']),
    ).resolves.toEqual([
      'gemini-3.5-flash',
      'gemini-2.5-pro(enterprise)',
      'gemini-3.5-flash(enterprise)',
    ]);
  });

  it('hides the Vertex models without a service account LibreChat can use', async () => {
    const models = ['gemini-3.5-flash'];
    for (const value of [undefined, 'AIza-static', '{"not": "a service account"}', '{"broken": ']) {
      const vertex = createTarsVertex(createDeps(value, profiles));
      await expect(vertex.withModels(models)).resolves.toBe(models);
    }
  });

  it('returns the env list unchanged when pwc_tars lists no Vertex model or is unrestricted', async () => {
    const models = ['gemini-3.5-flash'];
    const key = JSON.stringify(SERVICE_ACCOUNT);
    await expect(
      createTarsVertex(createDeps(key, ['gemini-3.5-flash'])).withModels(models),
    ).resolves.toEqual(models);
    await expect(createTarsVertex(createDeps(key, null)).withModels(models)).resolves.toBe(models);
  });
});

describe('createTarsVertex().withModels availability log', () => {
  const KEY_ID = 'abcdef0123456789abcdef0123456789abcd1234';
  const keyJson = JSON.stringify({ ...SERVICE_ACCOUNT, private_key_id: KEY_ID });
  const flash = 'gemini-3.5-flash(enterprise)';
  const pro = 'gemini-2.5-pro(enterprise)';
  const logged = (): string[] => (logger.info as jest.Mock).mock.calls.map(([line]) => line);

  it('names the key, masked, and every available model on its own line', async () => {
    await createTarsVertex(createDeps(keyJson, ['gpt-5.4-mini', flash, pro])).withModels([]);

    expect(logged()).toEqual([
      '[Gemini Enterprise] Gemini enterprise models on sys_config KEY_VERTEX_AI_API (project acme-gemini, key id ...1234): 2 available',
      `[Gemini Enterprise]   available: ${pro}`,
      `[Gemini Enterprise]   available: ${flash}`,
    ]);
  });

  it('never logs the key itself, and the real logger redaction leaves the lines whole', async () => {
    const { redactMessage } = jest.requireActual('@librechat/data-schemas');

    await createTarsVertex(createDeps(keyJson, [flash])).withModels([]);

    const output = logged().join('\n');
    expect(output).not.toContain(KEY_ID);
    expect(output).not.toContain('PRIVATE KEY');
    expect(output).not.toContain(SERVICE_ACCOUNT.client_email);
    logged().forEach((line) => expect(redactMessage(line)).toBe(line));
  });

  it.each([
    ['is not set', undefined],
    ['is not a service account', 'AIzaSyD-static-api-key-1234'],
  ])('says a pinned model needs the key file when the row %s', async (_, value) => {
    await createTarsVertex(createDeps(value)).withModels([flash]);

    expect(logged()).toEqual([
      '[Gemini Enterprise] Gemini enterprise models on GOOGLE_SERVICE_KEY_FILE, pinned in GOOGLE_MODELS: 1 available',
      `[Gemini Enterprise]   available: ${flash}`,
    ]);
  });

  it.each([[123], [null], [{ id: 'x' }], ['']])(
    'keeps the model list when the key id is unusable: %j',
    async (private_key_id) => {
      const key = JSON.stringify({ ...SERVICE_ACCOUNT, private_key_id });

      await expect(
        createTarsVertex(createDeps(key, [flash])).withModels(['plain']),
      ).resolves.toEqual(['plain', flash]);

      expect(logged()[0]).toContain('(project acme-gemini):');
    },
  );

  it('leaves the key id out of a service account that has none', async () => {
    await createTarsVertex(createDeps(JSON.stringify(SERVICE_ACCOUNT), [flash])).withModels([]);

    expect(logged()[0]).toContain('(project acme-gemini):');
  });

  it('logs once per state: a repeat read or a new row order logs nothing, a change does', async () => {
    const deps = createDeps(keyJson, [flash, pro]);
    const profileNames = deps.getModelProfileNames as jest.Mock;
    const sysConfig = deps.getSysConfigValue as jest.Mock;
    const vertex = createTarsVertex(deps);

    await vertex.withModels([]);
    await vertex.withModels([]);
    profileNames.mockResolvedValue([pro, flash]);
    await vertex.withModels([]);
    expect(logger.info).toHaveBeenCalledTimes(3);

    profileNames.mockResolvedValue([flash]);
    await vertex.withModels([]);
    expect(logged().slice(3)).toEqual([
      expect.stringContaining('1 available'),
      `[Gemini Enterprise]   available: ${flash}`,
    ]);

    jest.mocked(logger.info).mockClear();
    sysConfig.mockResolvedValue(
      JSON.stringify({ ...SERVICE_ACCOUNT, private_key_id: `${KEY_ID}-rotated-5678` }),
    );
    await vertex.withModels([]);
    expect(logged()[0]).toContain('key id ...5678');
  });

  it('logs the same models again after they were gone', async () => {
    const deps = createDeps(keyJson, [flash]);
    const profileNames = deps.getModelProfileNames as jest.Mock;
    const vertex = createTarsVertex(deps);

    await vertex.withModels([]);
    profileNames.mockResolvedValue([]);
    await vertex.withModels([]);
    expect(logger.info).toHaveBeenCalledTimes(3);
    expect(logged()[2]).toBe('[Gemini Enterprise] No Gemini enterprise models available');

    await vertex.withModels([]);
    expect(logger.info).toHaveBeenCalledTimes(3);

    profileNames.mockResolvedValue([flash]);
    await vertex.withModels([]);
    expect(logger.info).toHaveBeenCalledTimes(5);
  });

  it('logs when an unusable key hides the models', async () => {
    const deps = createDeps(keyJson, [flash]);
    const vertex = createTarsVertex(deps);

    await vertex.withModels([]);
    (deps.getSysConfigValue as jest.Mock).mockResolvedValue(undefined);
    await vertex.withModels([]);

    expect(logged().pop()).toBe('[Gemini Enterprise] No Gemini enterprise models available');
  });

  it.each([
    ['pwc_tars lists no such model', createDeps(keyJson, ['gemini-3.5-flash'])],
    ['pwc_tars is unreachable or unconfigured', createDeps(keyJson, null)],
  ])('logs nothing when %s', async (_, deps) => {
    await createTarsVertex(deps).withModels([]);

    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('createTarsVertex().assertModel', () => {
  const model = 'gemini-3.5-flash(enterprise)';

  it('accepts a model pwc_tars lists', async () => {
    const vertex = createTarsVertex(createDeps(undefined, [model]));

    await expect(vertex.assertModel(model, [])).resolves.toBeUndefined();
  });

  it('accepts a model pinned in GOOGLE_MODELS without asking pwc_tars', async () => {
    const deps = createDeps(undefined, null);

    await expect(createTarsVertex(deps).assertModel(model, [model])).resolves.toBeUndefined();

    expect(deps.getModelProfileNames).not.toHaveBeenCalled();
  });

  it.each([
    ['a name pwc_tars does not list', 'gemini-9-flash(enterprise)'],
    ['a marker placed elsewhere in the name', 'gemini(enterprise)-3.5-flash'],
    ['a path in the name', `${model}/../../../endpoints/other`],
    ['a name differing in case', 'gemini-3.5-flash(ENTERPRISE)'],
  ])('refuses %s', async (_label, name) => {
    const vertex = createTarsVertex(createDeps(undefined, [model]));

    await expect(vertex.assertModel(name, [])).rejects.toThrow('not listed by pwc_tars');
  });

  it('refuses everything unpinned when the list cannot be read', async () => {
    const vertex = createTarsVertex(createDeps(undefined, null));

    await expect(vertex.assertModel(model, ['gemini-2.5-pro(enterprise)'])).rejects.toThrow(
      'not listed by pwc_tars',
    );
  });
});

describe('createTarsVertex().getClientOptions', () => {
  const model = 'gemini-3.5-flash(enterprise)';
  const endpoint = (host: string, location: string) =>
    `https://${host}/v1/projects/acme/locations/${location}/endpoints/openapi`;

  it.each([
    ['the seeded global endpoint', endpoint('aiplatform.googleapis.com', 'global'), 'global'],
    [
      'a region chosen for compliance',
      endpoint('europe-west4-aiplatform.googleapis.com', 'europe-west4'),
      'europe-west4',
    ],
    [
      'a location ending the URL',
      'https://host/v1/projects/acme/locations/us-central1',
      'us-central1',
    ],
    ['an endpoint without a location', 'https://aiplatform.googleapis.com/v1', 'global'],
    ['a region only in the host', 'https://asia-east1-aiplatform.googleapis.com/v1', 'asia-east1'],
    ['a bare regional host', 'https://Europe-West4-aiplatform.googleapis.com', 'europe-west4'],
    [
      'a path location over the host one',
      endpoint('asia-east1-aiplatform.googleapis.com', 'europe-west4'),
      'europe-west4',
    ],
    ['a host that only resembles a regional one', 'https://x-aiplatform.evil.example/v1', 'global'],
    ['a profile without an endpoint', undefined, 'global'],
  ])('reads the location from %s', async (_label, value, location) => {
    const deps = createDeps(undefined, [], value);

    const options = await createTarsVertex(deps).getClientOptions(model);

    expect(deps.getModelProfileEndpoint).toHaveBeenCalledWith(model);
    expect(options.defaultLocation).toBe(location);
  });

  it.each([
    ['a fragment', 'attacker.example#'],
    ['a query', 'attacker.example?'],
    ['a backslash', 'attacker.example\\x'],
    ['a port', 'attacker.example:8443#'],
    ['credentials', 'user@attacker.example#'],
    ['a dot', 'attacker.example'],
    ['an encoded character', 'us%2Dcentral1'],
    ['upper case', 'Europe-West4'],
  ])('refuses a location with %s, without repeating it', async (_label, location) => {
    const deps = createDeps(undefined, [], endpoint('aiplatform.googleapis.com', location));

    const refused = createTarsVertex(deps).getClientOptions(model);

    await expect(refused).rejects.toThrow(`"${model}" has an invalid location`);
    await expect(refused).rejects.not.toThrow(location);
  });

  it('takes a configured location over a malformed one', async () => {
    const deps = createDeps(undefined, [], endpoint('aiplatform.googleapis.com', 'Europe-West4'));

    const options = await createTarsVertex(deps).getClientOptions(model, {}, 'asia-east1');

    expect(options.defaultLocation).toBe('asia-east1');
  });

  it('refuses a model whose location cannot be read', async () => {
    const deps = createDeps(undefined, [model], null);

    await expect(createTarsVertex(deps).getClientOptions(model)).rejects.toThrow(
      `Vertex AI model "${model}" has no known location`,
    );
  });

  it.each([
    ['cannot be read', null],
    ['names another region', endpoint('aiplatform.googleapis.com', 'europe-west4')],
  ])('takes a configured location without reading the endpoint, which %s', async (_, value) => {
    const deps = createDeps(undefined, [model], value);

    const options = await createTarsVertex(deps).getClientOptions(model, {}, 'asia-east1');

    expect(options.defaultLocation).toBe('asia-east1');
    expect(deps.getModelProfileEndpoint).not.toHaveBeenCalled();
  });

  it('treats an empty configured location as unset, as getGoogleConfig does', async () => {
    const deps = createDeps(undefined, [model], null);

    await expect(createTarsVertex(deps).getClientOptions(model, {}, '')).rejects.toThrow(
      'no known location',
    );
  });

  it("drops the Gemini API's settings and the env project, and sends the bare model id", async () => {
    const options = await createTarsVertex(createDeps(undefined)).getClientOptions(model, {
      temperature: 0.2,
    });

    expect(options).toEqual({
      reverseProxyUrl: undefined,
      authHeader: undefined,
      projectId: undefined,
      defaultLocation: 'global',
      modelOptions: { temperature: 0.2, model: 'gemini-3.5-flash' },
    });
  });
});
