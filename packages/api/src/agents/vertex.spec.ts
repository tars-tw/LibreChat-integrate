jest.mock('~/endpoints', () => ({
  ...jest.requireActual('~/endpoints'),
  getProviderConfig: jest.fn(),
}));

jest.mock('~/agents/resources', () => ({
  primeResources: jest.fn().mockResolvedValue({ attachments: [], tool_resources: undefined }),
}));

import path from 'path';
import { formatAgentMessages, GraphEvents, Providers, Run } from '@librechat/agents';
import { AIMessage, HumanMessage, ToolMessage } from '@librechat/agents/langchain/messages';
import { AuthKeys, EModelEndpoint } from 'librechat-data-provider';
import type { LCTool } from '@librechat/agents';
import type { Agent } from 'librechat-data-provider';
import type { BaseMessage } from '@librechat/agents/langchain/messages';
import type { InputItem } from '~/agents/responses/types';
import type { InitializeAgentDbMethods } from '~/agents/initialize';
import type { ChatMessage } from '~/agents/openai/types';
import type { ServerRequest } from '~/types';
import {
  signVertexToolCalls,
  nameVertexToolResponses,
  reduceVertexToolSchemas,
  getVertexToolCallSignature,
} from './vertex';
import { convertInputToMessages } from '~/agents/responses/service';
import { getGoogleConfig } from '~/endpoints/google/llm';
import { createTarsVertex } from '~/tars/vertex';
import { convertMessages } from '~/agents/openai/service';
import { sanitizeGeminiSchema } from '~/mcp/zod';
import { initializeAgent } from '~/agents/initialize';
import { getProviderConfig } from '~/endpoints';

const SKIP = 'skip_thought_signature_validator';

const { ChatVertexAI } = jest.requireActual(
  path.join(path.dirname(require.resolve('@librechat/agents')), 'llm/vertexai/index.cjs'),
);

/** An Action or caller schema as it arrives: a union, an open value, a keyword Gemini rejects. */
const external = {
  type: 'object',
  properties: {
    id: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
    value: { description: 'Literal value' },
    note: { anyOf: [{}, { type: 'null' }] },
    filter: { type: 'object', additionalProperties: true },
  },
} as unknown as LCTool['parameters'];

const SCALARS = [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }];

/** The union an open value (`{}`, pydantic `Any`) is typed with. */
const OPEN_VALUE = [{ anyOf: SCALARS }, { type: 'null' }];

const reduced = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    value: { description: 'Literal value', anyOf: OPEN_VALUE },
    note: { nullable: true, anyOf: OPEN_VALUE },
    filter: { type: 'object' },
  },
};

const tool = (parameters?: unknown) =>
  ({ name: 'tool', description: 'A tool', parameters }) as LCTool;

/** A schema as Vertex AI receives it from {@link reduceVertexToolSchemas}. */
function reduce(parameters: unknown): LCTool['parameters'] {
  const agent = { provider: Providers.VERTEXAI, toolDefinitions: [tool(parameters)] };
  reduceVertexToolSchemas(agent);
  return agent.toolDefinitions[0].parameters;
}

describe('getVertexToolCallSignature', () => {
  it.each([
    [Providers.VERTEXAI, 'gemini-3.5-flash', SKIP],
    [Providers.VERTEXAI, 'gemini-3.5-flash(enterprise)', SKIP],
    [Providers.VERTEXAI, 'gemini-4(enterprise)', SKIP],
    [Providers.VERTEXAI, 'gemini-4 (enterprise)', SKIP],
    [Providers.VERTEXAI, 'gemini-2.5-pro(enterprise)', undefined],
    [Providers.VERTEXAI, 'Gemini-3.1-Pro-Preview', SKIP],
    [Providers.VERTEXAI, 'gemini-3-flash-preview', SKIP],
    [Providers.VERTEXAI, 'gemini-4-argon', SKIP],
    [Providers.VERTEXAI, 'publishers/google/models/gemini-3.8-flash', SKIP],
    [Providers.VERTEXAI, 'gemini-2.5-pro', undefined],
    [Providers.VERTEXAI, 'claude-sonnet-5-5', undefined],
    [Providers.VERTEXAI, undefined, undefined],
    [Providers.VERTEXAI, null, undefined],
    [Providers.GOOGLE, 'gemini-3.5-flash', undefined],
    [Providers.OPENAI, 'gpt-5.4-mini', undefined],
    [undefined, 'gemini-3.5-flash', undefined],
  ])('%s %s → %s', (provider, model, expected) => {
    expect(getVertexToolCallSignature(provider, model)).toBe(expected);
  });
});

describe('signVertexToolCalls', () => {
  const toolCall = (id: string) => ({ id, name: 'read', args: {}, type: 'tool_call' as const });
  const replay = () => [
    new HumanMessage('hi'),
    new AIMessage({
      content: 'Checking',
      additional_kwargs: { kept: true },
      tool_calls: [toolCall('c1'), toolCall('c2')],
    }),
    new AIMessage('Done'),
  ];

  it('signs each tool call of a message, and only messages that have any', () => {
    const messages = replay();

    signVertexToolCalls(messages, Providers.VERTEXAI, 'gemini-3.5-flash(enterprise)');

    expect(messages[1].additional_kwargs).toEqual({ kept: true, signatures: [SKIP, SKIP] });
    expect(messages[0].additional_kwargs).not.toHaveProperty('signatures');
    expect(messages[2].additional_kwargs).not.toHaveProperty('signatures');
  });

  it.each([
    [Providers.GOOGLE, 'gemini-3.5-flash'],
    [Providers.VERTEXAI, 'gemini-2.5-pro'],
    [Providers.OPENAI, 'gpt-5.4-mini'],
    [undefined, undefined],
  ])('leaves %s %s unsigned', (provider, model) => {
    const messages = replay();

    signVertexToolCalls(messages, provider, model);

    expect(messages[1].additional_kwargs).toEqual({ kept: true });
  });
});

describe('nameVertexToolResponses', () => {
  const clientOptions = {
    model: 'gemini-3.5-flash',
    location: 'global',
    authOptions: {
      credentials: { project_id: 'p', client_email: 'a@b.c', private_key: 'pk' },
      projectId: 'p',
    },
  };
  const call = (id: string, name: string) => ({ id, name, args: {}, type: 'tool_call' as const });
  const parallel = new AIMessage({
    content: '',
    tool_calls: [call('c1', 'read'), call('c2', 'list'), call('c3', 'grep')],
  });
  const result = (id: string, name?: string) =>
    new ToolMessage({ content: `${id} result`, tool_call_id: id, ...(name && { name }) });

  async function responseNames(
    messages: BaseMessage[],
    pick: 'connection' | 'streamedConnection' = 'connection',
  ) {
    nameVertexToolResponses();
    const client = new ChatVertexAI(clientOptions);
    const { contents } = await client[pick].formatData(messages, {});
    return contents.flatMap(({ parts }: { parts: Array<Record<string, { name: string }>> }) =>
      parts.flatMap((part) => part.functionResponse?.name ?? []),
    );
  }

  it.each(['connection', 'streamedConnection'] as const)(
    'names each parallel result after its own call on the %s',
    async (pick) => {
      const names = await responseNames(
        [
          new HumanMessage('go'),
          parallel,
          result('c1', 'read'),
          result('c2', 'list'),
          result('c3', 'grep'),
        ],
        pick,
      );
      expect(names).toEqual(['read', 'list', 'grep']);
    },
  );

  it('follows the call id when results arrive out of order or without a name', async () => {
    const names = await responseNames([
      new HumanMessage('go'),
      parallel,
      result('c3'),
      result('c1'),
      result('c2'),
    ]);
    expect(names).toEqual(['grep', 'read', 'list']);
  });

  it('keeps the name a result carries when no call in the history matches it', async () => {
    const names = await responseNames([
      new HumanMessage('go'),
      new AIMessage({ content: '', tool_calls: [call('c1', 'read')] }),
      result('orphan', 'own_name'),
    ]);
    expect(names).toEqual(['own_name']);
  });

  it('keeps each step of a sequential loop on its own tool', async () => {
    const names = await responseNames([
      new HumanMessage('go'),
      new AIMessage({ content: '', tool_calls: [call('c1', 'read')] }),
      result('c1', 'read'),
      new AIMessage({ content: '', tool_calls: [call('c2', 'list')] }),
      result('c2', 'list'),
    ]);
    expect(names).toEqual(['read', 'list']);
  });

  it('wraps a client once, however many times it is called', async () => {
    nameVertexToolResponses();
    const { buildConnection } = ChatVertexAI.prototype;
    nameVertexToolResponses();
    expect(ChatVertexAI.prototype.buildConnection).toBe(buildConnection);
  });
});

describe('reduceVertexToolSchemas', () => {
  it('reduces a union, an open value and a keyword Gemini rejects', () => {
    expect(reduce(external)).toEqual(reduced);
  });

  it("types generate_file's `Any | None` cell value and `list[list[Any]]` rows", () => {
    const result = reduce({
      type: 'object',
      properties: {
        value: { anyOf: [{}, { type: 'null' }], default: null, description: 'Literal value' },
        rows: { type: 'array', items: { type: 'array', items: {} } },
      },
    });

    expect(result?.properties).toEqual({
      value: { default: null, description: 'Literal value', nullable: true, anyOf: OPEN_VALUE },
      rows: { type: 'array', items: { type: 'array', items: { anyOf: OPEN_VALUE } } },
    });
  });

  it('types the items of tuple and item-less arrays, which reduce to an empty schema', () => {
    const result = reduce({
      type: 'object',
      properties: {
        bare: { type: 'array' },
        tuple: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
        prefixed: { type: 'array', prefixItems: [{}] },
      },
    });

    expect(result?.properties).toEqual({
      bare: { type: 'array', items: { anyOf: OPEN_VALUE } },
      tuple: { type: 'array', items: { anyOf: OPEN_VALUE } },
      prefixed: { type: 'array', items: { anyOf: OPEN_VALUE } },
    });
  });

  it('types a property whose unresolved `$ref` the sanitizer strips, rather than 400 the request', () => {
    const result = reduce({
      type: 'object',
      properties: { node: { $ref: '#/$defs/missing', description: 'Unresolved' } },
    });

    expect(result?.properties).toEqual({ node: { description: 'Unresolved', anyOf: OPEN_VALUE } });
  });

  it('keeps typed, enum and object properties as `sanitizeGeminiSchema` leaves them', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', nullable: true },
        mode: { enum: ['a', 'b'] },
        nested: { properties: { id: { type: 'string' } } },
        items: { type: 'string' },
      },
    };

    expect(reduce(schema)).toEqual(sanitizeGeminiSchema(schema));
  });

  it('reaches open values nested under objects and array items', () => {
    const result = reduce({
      type: 'object',
      properties: {
        cells: { type: 'array', items: { type: 'object', properties: { value: {} } } },
      },
    });

    expect(result?.properties).toEqual({
      cells: {
        type: 'array',
        items: { type: 'object', properties: { value: { anyOf: OPEN_VALUE } } },
      },
    });
  });

  it('leaves the root untyped and every object it does not recognize as a schema alone', () => {
    expect(reduce({ description: 'root' })).toEqual({ description: 'root' });
    expect(reduce({ type: 'object', properties: { flag: true } })).toEqual({
      type: 'object',
      properties: { flag: true },
    });
  });

  it('builds each open value separately, so tools cannot alias one another', () => {
    const properties = reduce({ type: 'object', properties: { a: {}, b: {} } })
      ?.properties as unknown as Record<string, { anyOf: unknown[] }>;

    expect(properties.a.anyOf).not.toBe(properties.b.anyOf);
    expect(properties.a.anyOf[0]).not.toBe(properties.b.anyOf[0]);
  });

  it('reduces an MCP schema the same after upstream already sanitized it', () => {
    const schema = {
      type: 'object',
      properties: {
        value: { anyOf: [{}, { type: 'null' }] },
        rows: { type: 'array', items: {} },
        kind: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
    };

    expect(reduce(sanitizeGeminiSchema(schema))).toEqual(reduce(schema));
  });

  it('keeps the other fields of a tool, and a tool without parameters as it is', () => {
    const bare = tool(undefined);
    const agent = {
      provider: Providers.VERTEXAI,
      toolDefinitions: [bare, { ...tool(external), allowed_callers: ['direct'] } as LCTool],
    };

    reduceVertexToolSchemas(agent);

    expect(agent.toolDefinitions[0]).toBe(bare);
    expect(agent.toolDefinitions[1]).toMatchObject({
      name: 'tool',
      description: 'A tool',
      allowed_callers: ['direct'],
    });
  });

  it('keeps a tool already in the subset as it is', () => {
    const typed = tool({ type: 'object', properties: { id: { type: 'string' } } });
    const agent = { provider: Providers.VERTEXAI, toolDefinitions: [typed] };

    reduceVertexToolSchemas(agent);

    expect(agent.toolDefinitions[0]).toBe(typed);
  });

  it('resolves `$ref`s before reducing, so a referenced shape is kept', () => {
    const agent = {
      provider: Providers.VERTEXAI,
      toolDefinitions: [
        tool({
          type: 'object',
          properties: { row: { $ref: '#/$defs/Row' } },
          $defs: { Row: { type: 'object', properties: { cell: { type: 'string' } } } },
        }),
      ],
    };

    reduceVertexToolSchemas(agent);

    expect(agent.toolDefinitions[0].parameters?.properties?.row).toEqual({
      type: 'object',
      properties: { cell: { type: 'string' } },
    });
  });

  it('handles an agent with no tools', () => {
    const agent: { provider: Providers; toolDefinitions?: LCTool[] } = {
      provider: Providers.VERTEXAI,
    };

    expect(() => reduceVertexToolSchemas(agent)).not.toThrow();
    expect(agent.toolDefinitions).toBeUndefined();
  });

  it.each([Providers.GOOGLE, Providers.OPENAI, undefined])(
    'leaves %s tools untouched, down to the object',
    (provider) => {
      const definitions = [tool(external)];
      const agent = { provider, toolDefinitions: definitions };

      reduceVertexToolSchemas(agent);

      expect(agent.toolDefinitions).toBe(definitions);
    },
  );
});

/**
 * The real run up to the request body, stopped before any network: `convertMessages` and the
 * reduction, then the graph, `ChatVertexAI`'s signature handling and LangChain's converter.
 */
describe('a gateway tool loop reaching Vertex AI', () => {
  const STOP = 'stop before the network';
  const credentials = { project_id: 'p', client_email: 'a@b.c', private_key: 'pk' };
  const clientOptions = {
    location: 'global',
    authOptions: { credentials, projectId: credentials.project_id },
    streaming: true,
  };
  const connection = Object.getPrototypeOf(
    new ChatVertexAI({ model: 'gemini-3.5-flash', ...clientOptions }).connection,
  );
  const formatData = connection.formatData;

  afterAll(() => {
    connection.formatData = formatData;
  });

  const toolCall = (id: string, name: string, args = '{}') => ({
    id,
    type: 'function',
    function: { name, arguments: args },
  });

  const loop = [
    { role: 'system', content: 'Be brief' },
    { role: 'user', content: 'Make the file' },
    {
      role: 'assistant',
      content: 'Checking first',
      tool_calls: [toolCall('c1', 'read', '{"id":"1"}'), toolCall('c2', 'list')],
    },
    { role: 'tool', tool_call_id: 'c1', name: 'read', content: 'r1' },
    { role: 'tool', tool_call_id: 'c2', name: 'list', content: 'r2' },
    { role: 'assistant', content: null, tool_calls: [toolCall('c3', 'generate_file')] },
    { role: 'tool', tool_call_id: 'c3', name: 'generate_file', content: 'r3' },
  ] as unknown as ChatMessage[];

  async function requestBody(
    model: string,
    messages: BaseMessage[] = convertMessages(
      loop,
      getVertexToolCallSignature(Providers.VERTEXAI, model),
    ),
  ) {
    let body: { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> };
    connection.formatData = async function (this: unknown, input: unknown, parameters: unknown) {
      body = await formatData.call(this, input, parameters);
      throw new Error(STOP);
    };

    const agent = {
      provider: Providers.VERTEXAI,
      toolDefinitions: ['read', 'list', 'generate_file'].map(
        (name): LCTool => ({ name, description: name, parameters: external }),
      ),
    };
    reduceVertexToolSchemas(agent);

    const run = await Run.create({
      runId: 'run',
      graphConfig: {
        type: 'multi-agent',
        edges: [],
        agents: [
          {
            agentId: 'agent',
            provider: Providers.VERTEXAI,
            clientOptions: { model, ...clientOptions },
            toolDefinitions: agent.toolDefinitions,
            maxContextTokens: 100_000,
          },
        ],
      },
      customHandlers: { [GraphEvents.ON_TOOL_EXECUTE]: { handle: () => undefined } },
      returnContent: true,
    } as unknown as Parameters<typeof Run.create>[0]);

    await expect(
      run.processStream({ messages }, {
        configurable: { thread_id: 'thread', user_id: 'user' },
        recursionLimit: 5,
        streamMode: 'values',
        version: 'v2',
      } as never),
    ).rejects.toThrow(STOP);

    return body!;
  }

  const functionCalls = (body: Awaited<ReturnType<typeof requestBody>>) =>
    body.contents.flatMap(({ parts }) => parts.filter((part) => 'functionCall' in part));

  it('signs every replayed function call on Gemini 3, with or without text beside it', async () => {
    const body = await requestBody('gemini-3.5-flash');

    expect(functionCalls(body)).toEqual([
      { functionCall: { name: 'read', args: { id: '1' } }, thoughtSignature: SKIP },
      { functionCall: { name: 'list', args: {} }, thoughtSignature: SKIP },
      { functionCall: { name: 'generate_file', args: {} }, thoughtSignature: SKIP },
    ]);
    const [, firstStep] = body.contents;
    expect(firstStep.parts[0]).toEqual({ text: 'Checking first' });
    expect(firstStep.parts[0]).not.toHaveProperty('thoughtSignature');
  });

  it('signs a Responses API replay, which arrives through formatAgentMessages', async () => {
    const model = 'gemini-3.5-flash';
    const { messages } = formatAgentMessages(
      convertInputToMessages([
        { type: 'message', role: 'user', content: 'Make the file' },
        { type: 'function_call', call_id: 'c1', name: 'read', arguments: '{"id":"1"}' },
        { type: 'function_call_output', call_id: 'c1', output: 'r1' },
      ] as InputItem[]) as unknown as Parameters<typeof formatAgentMessages>[0],
      {},
      new Set(['read']),
    );

    signVertexToolCalls(messages, Providers.VERTEXAI, model);

    expect(functionCalls(await requestBody(model, messages))).toEqual([
      { functionCall: { name: 'read', args: { id: '1' } }, thoughtSignature: SKIP },
    ]);
  });

  it('sends no signature on Gemini 2.5, which does not validate one', async () => {
    const body = await requestBody('gemini-2.5-pro');

    expect(functionCalls(body)).toHaveLength(3);
    expect(functionCalls(body)[0]).not.toHaveProperty('thoughtSignature');
  });

  it('declares reduced schemas in the shape LangChain folds them to, without throwing', async () => {
    const body = (await requestBody('gemini-3.5-flash')) as unknown as {
      tools: Array<{ functionDeclarations: Array<{ parameters: unknown }> }>;
    };

    expect(body.tools[0].functionDeclarations[0].parameters).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        value: { description: 'Literal value', anyOf: SCALARS, nullable: true },
        note: { anyOf: SCALARS, nullable: true },
        filter: { type: 'object' },
      },
    });
  });
});

/**
 * The real path from `model_profile.endpoint` to the URL that receives the service account's token:
 * client options, `getGoogleConfig`, then `ChatVertexAI`'s connection. Nothing is sent.
 */
describe('the host a model_profile.endpoint leads to', () => {
  const originalLocation = process.env.GOOGLE_LOC;
  const serviceKey = { project_id: 'p', client_email: 'a@b.c', private_key: 'pk' };
  const endpoint = (location: string) =>
    `https://aiplatform.googleapis.com/v1/projects/p/locations/${location}/endpoints/openapi`;

  async function requestHost(value: string): Promise<string> {
    const model = 'gemini-3.5-flash(enterprise)';
    const options = await createTarsVertex({
      getSysConfigValue: async () => undefined,
      getModelProfileNames: async () => [model],
      getModelProfileEndpoint: async () => value,
      parseServiceKey: async () => null,
    }).getClientOptions(model);
    const { llmConfig } = getGoogleConfig(
      { [AuthKeys.GOOGLE_SERVICE_KEY]: serviceKey },
      { ...options, forceVertex: true },
    );
    const url: string = await new ChatVertexAI(llmConfig).connection.buildUrl();
    return new URL(url).host;
  }

  beforeEach(() => {
    delete process.env.GOOGLE_LOC;
  });

  afterAll(() => {
    process.env.GOOGLE_LOC = originalLocation;
    if (originalLocation === undefined) {
      delete process.env.GOOGLE_LOC;
    }
  });

  it.each([
    'attacker.example#',
    'attacker.example?',
    'attacker.example\\x',
    'attacker.example:8443#',
    'user@attacker.example#',
  ])('builds no URL for the crafted location %s', async (location) => {
    await expect(requestHost(endpoint(location))).rejects.toThrow('invalid location');
  });

  it('goes to the regional host for a location chosen for compliance', async () => {
    await expect(requestHost(endpoint('europe-west4'))).resolves.toBe(
      'europe-west4-aiplatform.googleapis.com',
    );
  });
});

describe('initializeAgent', () => {
  const definition = { name: 'action_tool', description: 'An action', parameters: external };

  async function initialize(provider: Providers | undefined) {
    (getProviderConfig as jest.Mock).mockReturnValue({
      overrideProvider: EModelEndpoint.google,
      getOptions: async () => ({
        ...(provider && { provider }),
        llmConfig: { model: 'gemini-3.5-flash' },
      }),
    });
    const agent = {
      id: 'agent-1',
      provider: EModelEndpoint.google,
      model: 'gemini-3.5-flash(enterprise)',
      tools: [],
      model_parameters: { model: 'gemini-3.5-flash(enterprise)' },
    } as unknown as Agent;
    return initializeAgent(
      {
        req: {
          user: { id: 'user-1' },
          config: {},
          body: { conversationId: 'convo-1', parentMessageId: 'a1' },
        } as unknown as ServerRequest,
        res: {} as import('express').Response,
        agent,
        loadTools: jest.fn().mockResolvedValue({
          toolDefinitions: [definition],
          toolRegistry: new Map([[definition.name, definition]]),
        }),
        conversationId: 'convo-1',
        parentMessageId: 'a1',
        endpointOption: { endpoint: EModelEndpoint.agents },
        allowedProviders: new Set([EModelEndpoint.google]),
        isInitialAgent: true,
      },
      {
        getFiles: jest.fn().mockResolvedValue([]),
        getConvoFiles: jest.fn().mockResolvedValue([]),
        getToolFilesByIds: jest.fn().mockResolvedValue([]),
        getUserKey: jest.fn().mockResolvedValue('user-1'),
        getUserKeyValues: jest.fn().mockResolvedValue([]),
        updateFilesUsage: jest.fn().mockResolvedValue([]),
        getMessages: jest.fn().mockResolvedValue([]),
      } as unknown as InitializeAgentDbMethods,
    );
  }

  it('hands a Vertex agent reduced schemas, whatever tool source loaded them', async () => {
    const result = await initialize(Providers.VERTEXAI);

    expect(result.provider).toBe(Providers.VERTEXAI);
    expect(result.toolDefinitions?.[0].parameters).toEqual(reduced);
  });

  it('hands a Gemini API agent its schemas as loaded', async () => {
    const result = await initialize(Providers.GOOGLE);

    expect(result.toolDefinitions?.[0].parameters).toEqual(external);
  });
});
