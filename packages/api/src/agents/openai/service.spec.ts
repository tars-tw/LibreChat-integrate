import { GraphEvents } from '@librechat/agents';
import { ErrorTypes } from 'librechat-data-provider';
import { isBaseMessage } from '@librechat/agents/langchain/messages';
import type { AIMessage, BaseMessage, ToolMessage } from '@librechat/agents/langchain/messages';
import type { FiltersConfig } from 'librechat-data-provider';
import type { ChatCompletionDependencies } from './service';
import type { ChatCompletionResponse } from './types';
import type { EventHandler } from './handlers';
import { createAgentChatCompletion } from './service';

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

type CreateRunArgs = {
  user?: Record<string, unknown>;
  tenantId?: string;
  appConfig?: Record<string, unknown>;
  requestBody?: Record<string, unknown>;
};
type ProcessStreamConfig = { configurable?: Record<string, unknown> };

function createMockReq(
  user?: Record<string, unknown>,
  body: Record<string, unknown> = {
    model: 'agent_test',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
  },
) {
  return {
    body,
    user,
    on: jest.fn(),
  } as unknown as Parameters<typeof createAgentChatCompletion>[0];
}

function createMockRes() {
  const res: Record<string, unknown> = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    headersSent: false,
  };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res as unknown as Parameters<typeof createAgentChatCompletion>[1];
}

function getResponseMock(
  res: Parameters<typeof createAgentChatCompletion>[1],
  method: 'flushHeaders' | 'json' | 'setHeader' | 'status',
): jest.Mock {
  return res[method] as unknown as jest.Mock;
}

function expectRawFreeFilterError(
  res: Parameters<typeof createAgentChatCompletion>[1],
  rawValue: string,
  code: string | null = 'content_filter_block',
): void {
  expect(getResponseMock(res, 'status')).toHaveBeenCalledWith(400);
  const body = getResponseMock(res, 'json').mock.calls[0][0] as {
    error: { code: string | null; message: string; param: string | null; type: string };
  };
  expect(body.error).toMatchObject({
    code,
    param: null,
    type: 'invalid_request_error',
  });
  expect(body.error.message).not.toContain(rawValue);
  expect(JSON.stringify(body)).not.toContain(rawValue);
}

describe('createAgentChatCompletion - MCP permission user propagation', () => {
  let createRun: jest.Mock;
  let processStream: jest.Mock;
  let deps: ChatCompletionDependencies;

  beforeEach(() => {
    processStream = jest.fn().mockResolvedValue(undefined);
    createRun = jest.fn().mockResolvedValue({ processStream });

    deps = {
      getAgent: jest.fn().mockResolvedValue({
        id: 'agent_test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tools: [],
      }),
      initializeAgent: jest.fn().mockResolvedValue({
        id: 'agent_test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tools: [],
        attachments: [],
        toolContextMap: {},
        maxContextTokens: 1000,
        model_parameters: {},
      }),
      createRun: createRun as unknown as ChatCompletionDependencies['createRun'],
    };
  });

  it('forwards the role-bearing safe user to createRun and configurable.user', async () => {
    const req = createMockReq({
      id: 'user-123',
      role: 'ADMIN',
      email: 'admin@example.com',
      password: 'secret',
    });

    await createAgentChatCompletion(req, createMockRes(), deps);

    expect(createRun).toHaveBeenCalledTimes(1);
    const runArgs = createRun.mock.calls[0][0] as CreateRunArgs;
    expect(runArgs.user).toMatchObject({ id: 'user-123', role: 'ADMIN' });
    // createSafeUser must strip sensitive fields.
    expect(runArgs.user).not.toHaveProperty('password');

    expect(processStream).toHaveBeenCalledTimes(1);
    const streamConfig = processStream.mock.calls[0][1] as ProcessStreamConfig;
    expect(streamConfig.configurable?.user).toMatchObject({ id: 'user-123', role: 'ADMIN' });
    expect(streamConfig.configurable?.user_id).toBe('user-123');
  });

  it('falls back to a bare id when no authenticated user is attached', async () => {
    const req = createMockReq(undefined);

    await createAgentChatCompletion(req, createMockRes(), deps);

    expect(createRun).toHaveBeenCalledTimes(1);
    const runArgs = createRun.mock.calls[0][0] as CreateRunArgs;
    expect(runArgs.user).toEqual({ id: 'api-user' });

    const streamConfig = processStream.mock.calls[0][1] as ProcessStreamConfig;
    // No role present → the runtime MCP check fails closed.
    expect(streamConfig.configurable?.user).toEqual({ id: 'api-user' });
    expect(streamConfig.configurable?.user).not.toHaveProperty('role');
  });

  it('adapts runtime tool loading to the request-backed public dependency', async () => {
    const req = createMockReq({ id: 'user-123', role: 'USER' });
    const res = createMockRes();
    const loadAgentTools = jest.fn().mockResolvedValue({
      tools: [],
      toolContextMap: {},
    });
    deps.loadAgentTools = loadAgentTools;
    (deps.initializeAgent as jest.Mock).mockImplementation(
      async ({
        loadTools,
      }: {
        loadTools?: (params: Record<string, unknown>) => Promise<unknown>;
      }) => {
        await loadTools?.({
          provider: 'openai',
          agentId: 'agent_test',
          tools: ['tool-a'],
          model: 'gpt-4o-mini',
          tool_options: undefined,
          tool_resources: undefined,
          requestBody: { conversationId: 'conversation-123' },
          codeExecutionContext: { endpoint: 'openai' },
        });
        return {
          id: 'agent_test',
          provider: 'openai',
          model: 'gpt-4o-mini',
          tools: [],
          attachments: [],
          toolContextMap: {},
          maxContextTokens: 1000,
          model_parameters: {},
        };
      },
    );

    await createAgentChatCompletion(req, res, deps);

    expect(loadAgentTools).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        res,
        provider: 'openai',
        agentId: 'agent_test',
        tools: ['tool-a'],
        codeExecutionContext: { endpoint: 'openai' },
      }),
    );
  });

  it('threads the parent message id into the run and execution context', async () => {
    const req = createMockReq({ id: 'user-123', role: 'USER' }) as unknown as {
      body: Record<string, unknown>;
    };
    req.body.parent_message_id = 'parent-123';

    await createAgentChatCompletion(req as never, createMockRes(), deps);

    expect(deps.initializeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ parentMessageId: 'parent-123' }),
      }),
    );
    const runArgs = createRun.mock.calls[0][0] as CreateRunArgs;
    expect(runArgs.requestBody).toEqual(expect.objectContaining({ parentMessageId: 'parent-123' }));
    const streamConfig = processStream.mock.calls[0][1] as ProcessStreamConfig;
    expect(streamConfig.configurable?.requestBody).toEqual(runArgs.requestBody);
  });

  it('forwards the normalized MCP body to deferred execution loaders', async () => {
    const req = createMockReq({ id: 'user-123', role: 'USER' }) as unknown as {
      body: Record<string, unknown>;
    };
    req.body.stream = true;
    req.body.parent_message_id = 'parent-123';
    const loadTools = jest.fn().mockResolvedValue({ loadedTools: [] });
    deps.toolExecuteOptions = { loadTools };

    await createAgentChatCompletion(req as never, createMockRes(), deps);

    const runArgs = createRun.mock.calls[0][0] as CreateRunArgs & {
      customHandlers: Record<string, { handle: (event: string, data: unknown) => Promise<void> }>;
    };
    const streamConfig = processStream.mock.calls[0][1] as ProcessStreamConfig;
    const resolve = jest.fn();
    const reject = jest.fn();
    await runArgs.customHandlers[GraphEvents.ON_TOOL_EXECUTE].handle(GraphEvents.ON_TOOL_EXECUTE, {
      toolCalls: [{ id: 'tool-call-1', name: 'deferred_mcp_tool', args: {} }],
      agentId: 'agent_test',
      configurable: streamConfig.configurable,
      metadata: {},
      resolve,
      reject,
    });

    expect(loadTools).toHaveBeenCalledWith(
      ['deferred_mcp_tool'],
      'agent_test',
      expect.objectContaining({ requestBody: runArgs.requestBody }),
      undefined,
    );
  });

  it('uses the root parent sentinel when chat completions omit a parent id', async () => {
    const req = createMockReq({ id: 'user-123', role: 'USER' });

    await createAgentChatCompletion(req, createMockRes(), deps);

    expect(deps.initializeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          parentMessageId: '00000000-0000-0000-0000-000000000000',
        }),
      }),
    );
  });

  it('omits an unavailable parent for an existing chat-completions conversation', async () => {
    const req = createMockReq({ id: 'user-123', role: 'USER' }) as unknown as {
      body: Record<string, unknown>;
    };
    req.body.conversation_id = 'conversation-123';

    await createAgentChatCompletion(req as never, createMockRes(), deps);

    const requestBody = (deps.initializeAgent as jest.Mock).mock.calls[0][0].requestBody;
    expect(requestBody).toEqual({
      messageId: expect.any(String),
      conversationId: 'conversation-123',
    });
    expect(requestBody).not.toHaveProperty('parentMessageId');
  });

  it('forwards appConfig and tenantId to createRun', async () => {
    const appConfig = {
      endpoints: {
        agents: { capabilities: ['execute_code'] },
      },
      langfuse: {
        publicKey: 'pk-tenant-1',
        secretKey: 'sk-tenant-1',
      },
      interfaceConfig: {
        modelSelect: true,
      },
      filters: {
        messages: {
          pii: {
            starterPatterns: [],
          },
        },
      },
      messageFilter: {
        pii: {
          starterPatterns: [],
        },
      },
    };
    deps.appConfig = appConfig as never;
    const req = createMockReq({
      id: 'user-123',
      tenantId: 'tenant-1',
      role: 'USER',
    });

    await createAgentChatCompletion(req, createMockRes(), deps);

    expect(createRun).toHaveBeenCalledTimes(1);
    const runArgs = createRun.mock.calls[0][0] as CreateRunArgs;
    expect(runArgs.tenantId).toBe('tenant-1');
    expect(runArgs.appConfig).toEqual({
      endpoints: appConfig.endpoints,
      filters: appConfig.filters,
      langfuse: appConfig.langfuse,
      messageFilter: appConfig.messageFilter,
    });
    expect(runArgs.appConfig).not.toHaveProperty('interfaceConfig');
  });

  it('forwards the stateful environment allowlist from appConfig to agent initialization', async () => {
    deps.appConfig = {
      endpoints: {
        agents: {
          capabilities: ['execute_code', 'stateful_code_sessions'],
          statefulCodeSessions: { allowedEnvironments: ['user', 'agent-user'] },
        },
      },
    } as never;

    await createAgentChatCompletion(createMockReq({ id: 'user-123' }), createMockRes(), deps);

    expect(deps.initializeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        codeEnvAvailable: true,
        statefulSessionsAvailable: true,
        allowedStatefulCodeEnvironments: ['user', 'agent-user'],
      }),
    );
  });

  it('preserves stateful scope policy status and code in an initialization error response', async () => {
    const policyError = Object.assign(
      new Error('Stateful code environment is not allowed by this deployment: conversation'),
      {
        code: ErrorTypes.STATEFUL_CODE_ENVIRONMENT_NOT_ALLOWED,
        status: 403,
        statusCode: 403,
      },
    );
    (deps.initializeAgent as jest.Mock).mockRejectedValueOnce(policyError);
    const res = createMockRes();

    await createAgentChatCompletion(createMockReq({ id: 'user-123' }), res, deps);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: policyError.message,
        type: 'invalid_request_error',
        param: null,
        code: ErrorTypes.STATEFUL_CODE_ENVIRONMENT_NOT_ALLOWED,
      },
    });
  });
});

describe('createAgentChatCompletion - provider error disclosure', () => {
  const rawValue = 'PRIVATE-PROVIDER-ECHO';
  let deps: ChatCompletionDependencies;

  beforeEach(() => {
    const processStream = jest.fn().mockRejectedValue(new Error(`Provider echoed ${rawValue}`));
    deps = {
      getAgent: jest.fn().mockResolvedValue({
        id: 'agent_test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tools: [],
      }),
      initializeAgent: jest.fn().mockResolvedValue({
        id: 'agent_test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tools: [],
        attachments: [],
        toolContextMap: {},
        maxContextTokens: 1000,
        model_parameters: {},
      }),
      createRun: jest.fn().mockResolvedValue({
        processStream,
      }) as unknown as ChatCompletionDependencies['createRun'],
      appConfig: {
        filters: {
          messages: {
            pii: {},
          },
        },
      },
    };
  });

  it('returns a generic non-streaming error when a provider echoes submitted content', async () => {
    const res = createMockRes();

    await createAgentChatCompletion(createMockReq(), res, deps);

    expect(getResponseMock(res, 'status')).toHaveBeenCalledWith(500);
    expect(getResponseMock(res, 'json')).toHaveBeenCalledWith({
      error: {
        code: null,
        message: 'An error occurred while processing the request',
        param: null,
        type: 'server_error',
      },
    });
    expect(JSON.stringify(getResponseMock(res, 'json').mock.calls)).not.toContain(rawValue);
  });

  it('returns a generic streaming error when a provider echoes submitted content', async () => {
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    const res = createMockRes();
    getResponseMock(res, 'flushHeaders').mockImplementation(() => {
      (res as unknown as { headersSent: boolean }).headersSent = true;
    });

    await createAgentChatCompletion(req, res, deps);

    const writes = (res.write as unknown as jest.Mock).mock.calls;
    expect(JSON.stringify(writes)).toContain('An error occurred while processing the request');
    expect(JSON.stringify(writes)).not.toContain(rawValue);
  });

  it('preserves the legacy non-streaming provider error when protection is inactive', async () => {
    deps.appConfig = undefined;
    const res = createMockRes();

    await createAgentChatCompletion(createMockReq(), res, deps);

    expect(getResponseMock(res, 'json')).toHaveBeenCalledWith({
      error: {
        code: null,
        message: `Provider echoed ${rawValue}`,
        param: null,
        type: 'server_error',
      },
    });
  });

  it.each<{ filters: FiltersConfig; policy: string }>([
    {
      policy: 'a management-only prompt',
      filters: { prompts: { pii: {} } },
    },
    {
      policy: 'an inert message',
      filters: { messages: { pii: { starterPatterns: [] } } },
    },
  ])('preserves the legacy provider error for $policy policy', async ({ filters }) => {
    deps.appConfig = { filters };
    const res = createMockRes();

    await createAgentChatCompletion(createMockReq(), res, deps);

    expect(getResponseMock(res, 'json')).toHaveBeenCalledWith({
      error: {
        code: null,
        message: `Provider echoed ${rawValue}`,
        param: null,
        type: 'server_error',
      },
    });
  });

  it('preserves the legacy streaming provider error when protection is inactive', async () => {
    deps.appConfig = undefined;
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    const res = createMockRes();
    getResponseMock(res, 'flushHeaders').mockImplementation(() => {
      (res as unknown as { headersSent: boolean }).headersSent = true;
    });

    await createAgentChatCompletion(req, res, deps);

    expect(JSON.stringify((res.write as unknown as jest.Mock).mock.calls)).toContain(
      `Provider echoed ${rawValue}`,
    );
  });
});

describe('createAgentChatCompletion - source-aware content protection', () => {
  let createRun: jest.Mock;
  let initializeAgent: jest.Mock;
  let getAgent: jest.Mock;
  let deps: ChatCompletionDependencies;

  beforeEach(() => {
    createRun = jest.fn().mockResolvedValue({
      processStream: jest.fn().mockResolvedValue(undefined),
    });
    initializeAgent = jest.fn().mockResolvedValue({
      id: 'agent_test',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tools: [],
      attachments: [],
      toolContextMap: {},
      maxContextTokens: 1000,
      model_parameters: {},
    });
    getAgent = jest.fn().mockResolvedValue({
      id: 'agent_test',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tools: [],
    });
    deps = {
      getAgent,
      initializeAgent,
      createRun: createRun as unknown as ChatCompletionDependencies['createRun'],
    };
  });

  it('blocks submitted message content before agent lookup without echoing the value', async () => {
    const rawValue = 'PRIVATE-MESSAGE';
    const filters: FiltersConfig = {
      messages: {
        pii: {
          fields: ['text'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };
    deps.appConfig = { filters };
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: rawValue }],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, rawValue);
    expect(getAgent).not.toHaveBeenCalled();
    expect(initializeAgent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
  });

  it('blocks submitted tool arguments before agent lookup', async () => {
    const rawValue = 'PRIVATE-TOOL-ARG';
    const filters: FiltersConfig = {
      toolArguments: {
        pii: {
          fields: ['arguments'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };
    deps.appConfig = { filters };
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'lookup',
                arguments: JSON.stringify({ token: rawValue }),
              },
            },
          ],
        },
      ],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, rawValue);
    expect(getAgent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
  });

  it('rejects structured tool arguments before lookup without echoing their content', async () => {
    const rawValue = 'PRIVATE-STRUCTURED-TOOL-ARG';
    const filters: FiltersConfig = {
      toolArguments: {
        pii: {
          fields: ['arguments'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };
    deps.appConfig = { filters };
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'lookup',
                arguments: { token: rawValue },
              },
            },
          ],
        },
      ],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, rawValue, null);
    expect(getAgent).not.toHaveBeenCalled();
    expect(initializeAgent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
  });

  it('blocks registered submitted model parameters before agent lookup', async () => {
    const rawValue = 'PRIVATE-MODEL-PARAMETER';
    const filters: FiltersConfig = {
      modelParameters: {
        pii: {
          fields: ['metadata'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };
    deps.appConfig = { filters };
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: 'safe' }],
      metadata: { trace: rawValue },
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, rawValue);
    expect(getAgent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
  });

  it('re-inspects initialized agent instructions before headers or run creation', async () => {
    const rawValue = 'PRIVATE-INITIALIZED-INSTRUCTION';
    const filters: FiltersConfig = {
      agentInstructions: {
        pii: {
          fields: ['instructions'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };
    deps.appConfig = { filters };
    initializeAgent.mockResolvedValue({
      id: 'agent_test',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tools: [],
      instructions: `Persisted ${rawValue}`,
      attachments: [],
      toolContextMap: {},
      maxContextTokens: 1000,
      model_parameters: {},
    });
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: 'safe' }],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expect(getAgent).toHaveBeenCalledTimes(1);
    expect(initializeAgent).toHaveBeenCalledTimes(1);
    expectRawFreeFilterError(res, rawValue);
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'flushHeaders')).not.toHaveBeenCalled();
  });

  it('re-inspects late-loaded tool definitions on nested pure subagents', async () => {
    const rawValue = 'PRIVATE-NESTED-TOOL-DEFINITION';
    const filters: FiltersConfig = {
      agentInstructions: {
        pii: {
          fields: ['description'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };
    deps.appConfig = { filters };
    const initializedAgentBase = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      tools: [],
      attachments: [],
      requestAttachments: [],
      agentContextAttachments: [],
      toolContextMap: {},
      maxContextTokens: 1000,
      model_parameters: {},
    };
    initializeAgent.mockResolvedValue({
      ...initializedAgentBase,
      id: 'agent_test',
      subagentAgentConfigs: [
        {
          ...initializedAgentBase,
          id: 'agent_pure',
          subagentAgentConfigs: [
            {
              ...initializedAgentBase,
              id: 'agent_nested_pure',
              toolDefinitions: [
                {
                  name: 'nested_lookup',
                  description: rawValue,
                  parameters: { type: 'object' },
                },
              ],
            },
          ],
        },
      ],
    });
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: 'safe' }],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, rawValue);
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'flushHeaders')).not.toHaveBeenCalled();
  });

  it('re-inspects initialized agent-context attachments before headers or run creation', async () => {
    const rawValue = 'PRIVATE-INITIALIZED-FILE';
    const filters: FiltersConfig = {
      files: {
        pii: {
          fields: ['extracted_text'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };
    deps.appConfig = { filters };
    initializeAgent.mockResolvedValue({
      id: 'agent_test',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tools: [],
      attachments: [],
      requestAttachments: [],
      agentContextAttachments: [
        {
          filename: 'context.txt',
          filepath: '/context.txt',
          text: `Persisted ${rawValue}`,
        },
      ],
      toolContextMap: {},
      maxContextTokens: 1000,
      model_parameters: {},
    });
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: 'safe' }],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expect(getAgent).toHaveBeenCalledTimes(1);
    expect(initializeAgent).toHaveBeenCalledTimes(1);
    expectRawFreeFilterError(res, rawValue);
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'flushHeaders')).not.toHaveBeenCalled();
  });

  it('re-inspects the exact initialized dynamic tool context before headers or run creation', async () => {
    const rawValue = 'PRIVATE-DYNAMIC-TOOL-CONTEXT';
    const filters: FiltersConfig = {
      files: {
        pii: {
          fields: ['content'],
          starterPatterns: [],
          customPatterns: [{ id: 'private', label: 'private value', regex: rawValue }],
        },
      },
    };
    deps.appConfig = { filters };
    initializeAgent.mockResolvedValue({
      id: 'agent_test',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tools: [],
      attachments: [],
      requestAttachments: [],
      agentContextAttachments: [],
      dynamicToolContextMap: {
        ignored: 42,
        empty: '',
        files: `  Persisted ${rawValue}  `,
      },
      toolContextMap: {},
      maxContextTokens: 1000,
      model_parameters: {},
    });
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: 'safe' }],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, rawValue);
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'flushHeaders')).not.toHaveBeenCalled();
  });

  it('fails closed on opaque file input before agent lookup', async () => {
    const filters: FiltersConfig = {
      files: {
        pii: {
          fields: ['content'],
          starterPatterns: [],
          uninspectable: 'block',
        },
      },
    };
    deps.appConfig = { filters };
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [
        {
          role: 'user',
          content: [{ type: 'input_file', file_id: 'file-private-reference' }],
        },
      ],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, 'file-private-reference', 'content_filter_uninspectable');
    expect(getAgent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
  });

  it('fails closed when protected nested message content exceeds traversal limits', async () => {
    let nested: Record<string, unknown> = { value: 'safe' };
    for (let depth = 0; depth < 30; depth++) {
      nested = { nested };
    }
    const filters: FiltersConfig = {
      messages: {
        pii: {
          fields: ['content_part'],
          starterPatterns: ['sk_prefix'],
        },
      },
    };
    deps.appConfig = { filters };
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'safe', payload: nested }],
        },
      ],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, 'safe', 'content_filter_uninspectable');
    expect(getAgent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
    expect(getResponseMock(res, 'setHeader')).not.toHaveBeenCalled();
  });

  it('keeps filtering disabled when both policies are omitted', async () => {
    const rawValue = 'PRIVATE-UNFILTERED';
    deps.appConfig = {
      endpoints: {
        agents: { capabilities: [] },
      },
    };
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: rawValue }],
      metadata: { trace: rawValue },
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expect(getAgent).toHaveBeenCalledTimes(1);
    expect(initializeAgent).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledTimes(1);
    expect(getResponseMock(res, 'setHeader')).toHaveBeenCalled();
    expect(getResponseMock(res, 'status')).not.toHaveBeenCalledWith(400);
  });

  it('applies the legacy message filter with an OpenAI-format raw-free error', async () => {
    const rawValue = 'sk-private-legacy-token';
    deps.appConfig = {
      messageFilter: {
        pii: {
          starterPatterns: ['sk_prefix'],
        },
      },
    };
    const req = createMockReq(undefined, {
      model: 'agent_test',
      messages: [{ role: 'user', content: rawValue }],
      stream: true,
    });
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expectRawFreeFilterError(res, rawValue, 'message_filter_pii_block');
    expect(getAgent).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });
});

describe('createAgentChatCompletion - LangChain run input', () => {
  let createRun: jest.Mock;
  let processStream: jest.Mock;
  let deps: ChatCompletionDependencies;

  beforeEach(() => {
    processStream = jest.fn().mockResolvedValue(undefined);
    createRun = jest.fn().mockResolvedValue({ processStream });

    deps = {
      getAgent: jest.fn().mockResolvedValue({
        id: 'agent_test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tools: [],
      }),
      initializeAgent: jest.fn().mockResolvedValue({
        id: 'agent_test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tools: [],
        attachments: [],
        toolContextMap: {},
        maxContextTokens: 1000,
        model_parameters: {},
      }),
      createRun: createRun as unknown as ChatCompletionDependencies['createRun'],
    };
  });

  async function runWithMessages(messages: unknown[]): Promise<BaseMessage[]> {
    const req = createMockReq(
      { id: 'user-123', role: 'USER' },
      { model: 'agent_test', messages, stream: false },
    );
    await createAgentChatCompletion(req, createMockRes(), deps);
    expect(createRun).toHaveBeenCalledTimes(1);
    return (createRun.mock.calls[0][0] as { messages: BaseMessage[] }).messages;
  }

  it('passes BaseMessage instances into the run, not role-tagged plain objects', async () => {
    const messages = await runWithMessages([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ]);

    for (const message of messages) {
      expect(isBaseMessage(message)).toBe(true);
      expect(typeof message.getType).toBe('function');
    }
    expect(messages.map((message) => message.getType())).toEqual(['system', 'human']);

    const streamInput = processStream.mock.calls[0][0] as { messages: BaseMessage[] };
    expect(streamInput.messages).toBe(messages);
  });

  it('rebuilds an assistant tool call and its result as AIMessage/ToolMessage', async () => {
    const messages = await runWithMessages([
      { role: 'user', content: '目前我們資料庫有什麼模型' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'sql_query', arguments: '{"question":"list models"}' },
          },
        ],
      },
      { role: 'tool', content: 'rows...', tool_call_id: 'call_1', name: 'sql_query' },
    ]);

    expect(messages.map((message) => message.getType())).toEqual(['human', 'ai', 'tool']);

    const assistant = messages[1] as AIMessage;
    expect(assistant.tool_calls).toEqual([
      { id: 'call_1', name: 'sql_query', args: { question: 'list models' }, type: 'tool_call' },
    ]);

    const toolMessage = messages[2] as ToolMessage;
    expect(toolMessage.tool_call_id).toBe('call_1');
    expect(toolMessage.content).toBe('rows...');
  });

  it('keeps a tool call whose arguments are not valid JSON', async () => {
    const messages = await runWithMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'sql_query', arguments: '{"que' } },
        ],
      },
    ]);

    expect((messages[1] as AIMessage).tool_calls).toEqual([
      { id: 'call_1', name: 'sql_query', args: {}, type: 'tool_call' },
    ]);
  });

  it('preserves multimodal user content as content blocks', async () => {
    const messages = await runWithMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        ],
      },
    ]);

    expect(messages[0].getType()).toBe('human');
    expect(messages[0].content).toEqual([
      { type: 'text', text: 'what is this' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ]);
  });

  it('rejects a tool message with no tool_call_id instead of building a broken ToolMessage', async () => {
    const req = createMockReq(
      { id: 'user-123', role: 'USER' },
      {
        model: 'agent_test',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'tool', content: 'rows...' },
        ],
        stream: false,
      },
    );
    const res = createMockRes();

    await createAgentChatCompletion(req, res, deps);

    expect(getResponseMock(res, 'status')).toHaveBeenCalledWith(400);
    expect(createRun).not.toHaveBeenCalled();
  });
});

describe('createAgentChatCompletion - client-side tools', () => {
  let createRun: jest.Mock;
  let processStream: jest.Mock;
  let deps: ChatCompletionDependencies;
  let agentTools: unknown[];

  const WEATHER_TOOL = {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  };

  beforeEach(() => {
    agentTools = [];
    processStream = jest.fn().mockResolvedValue(undefined);
    createRun = jest.fn().mockResolvedValue({ processStream });

    deps = {
      getAgent: jest.fn().mockResolvedValue({
        id: 'agent_test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tools: [],
      }),
      initializeAgent: jest.fn().mockImplementation(async () => ({
        id: 'agent_test',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tools: agentTools,
        attachments: [],
        toolContextMap: {},
        maxContextTokens: 1000,
        model_parameters: {},
      })),
      createRun: createRun as unknown as ChatCompletionDependencies['createRun'],
    };
  });

  function requestWith(body: Record<string, unknown>) {
    return createMockReq(
      { id: 'user-123', role: 'USER' },
      {
        model: 'agent_test',
        messages: [{ role: 'user', content: 'weather in Taipei?' }],
        stream: false,
        ...body,
      },
    );
  }

  /** Drives the graph's tool dispatch the way ToolNode does: hand the batch to
   *  the host handler, then unwind with whatever it rejected. */
  function dispatchToolCall(toolCalls: Array<{ id: string; name: string; args: object }>): void {
    processStream.mockImplementation(async () => {
      const handlers = (
        createRun.mock.calls[0][0] as { customHandlers: Record<string, EventHandler> }
      ).customHandlers;
      let rejection: unknown;
      handlers.on_tool_execute.handle('on_tool_execute', {
        toolCalls,
        reject: (error: unknown) => {
          rejection = error;
        },
      });
      throw rejection ?? new Error('handler did not reject');
    });
  }

  it('binds caller tools as schema-only definitions instead of executable tools', async () => {
    const res = createMockRes();
    await createAgentChatCompletion(requestWith({ tools: [WEATHER_TOOL] }), res, deps);

    const runAgent = (createRun.mock.calls[0][0] as { agents: Array<Record<string, unknown>> })
      .agents[0];
    expect(runAgent.toolDefinitions).toEqual([
      {
        name: 'get_weather',
        description: 'Get weather for a city',
        parameters: WEATHER_TOOL.function.parameters,
      },
    ]);
    expect(runAgent.tools).toEqual([]);
  });

  it('returns the tool call to the caller instead of executing it', async () => {
    dispatchToolCall([{ id: 'call_1', name: 'get_weather', args: { city: 'Taipei' } }]);
    const res = createMockRes();

    await createAgentChatCompletion(requestWith({ tools: [WEATHER_TOOL] }), res, deps);

    const body = getResponseMock(res, 'json').mock.calls[0][0] as ChatCompletionResponse;
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Taipei"}' },
      },
    ]);
    expect(getResponseMock(res, 'status')).not.toHaveBeenCalledWith(500);
  });

  it('streams the tool call and closes with a tool_calls finish reason', async () => {
    dispatchToolCall([{ id: 'call_1', name: 'get_weather', args: { city: 'Taipei' } }]);
    const res = createMockRes();

    await createAgentChatCompletion(
      requestWith({ tools: [WEATHER_TOOL], stream: true }),
      res,
      deps,
    );

    const written = (res.write as unknown as jest.Mock).mock.calls.map((call) => String(call[0]));
    const toolChunk = written.find((chunk) => chunk.includes('"tool_calls"'));
    expect(toolChunk).toContain('"name":"get_weather"');
    expect(toolChunk).toContain('{\\"city\\":\\"Taipei\\"}');
    expect(written.some((chunk) => chunk.includes('"finish_reason":"tool_calls"'))).toBe(true);
    expect(written.some((chunk) => chunk.includes('Error:'))).toBe(false);
  });

  it('leaves tools unbound when tool_choice is none', async () => {
    const res = createMockRes();
    await createAgentChatCompletion(
      requestWith({ tools: [WEATHER_TOOL], tool_choice: 'none' }),
      res,
      deps,
    );

    const runAgent = (createRun.mock.calls[0][0] as { agents: Array<Record<string, unknown>> })
      .agents[0];
    expect(runAgent.toolDefinitions).toBeUndefined();
  });

  it('rejects a tool_choice the graph cannot honor rather than downgrading it', async () => {
    const res = createMockRes();
    await createAgentChatCompletion(
      requestWith({ tools: [WEATHER_TOOL], tool_choice: 'required' }),
      res,
      deps,
    );

    expect(getResponseMock(res, 'status')).toHaveBeenCalledWith(400);
    expect(createRun).not.toHaveBeenCalled();
  });

  it('rejects a malformed tool entry', async () => {
    const res = createMockRes();
    await createAgentChatCompletion(
      requestWith({ tools: [{ type: 'function', function: {} }] }),
      res,
      deps,
    );

    expect(getResponseMock(res, 'status')).toHaveBeenCalledWith(400);
    expect(createRun).not.toHaveBeenCalled();
  });

  it('refuses caller tools when the target agent has tools of its own', async () => {
    agentTools = [{ name: 'web_search' }];
    const res = createMockRes();

    await createAgentChatCompletion(requestWith({ tools: [WEATHER_TOOL] }), res, deps);

    expect(getResponseMock(res, 'status')).toHaveBeenCalledWith(400);
    expect(createRun).not.toHaveBeenCalled();
  });
});
