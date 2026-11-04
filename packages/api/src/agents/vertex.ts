import { isEqual, isPlainObject } from 'lodash';
import { getChatModelClass, Providers } from '@librechat/agents';
import type { AIMessage, BaseMessage, ToolMessage } from '@librechat/agents/langchain/messages';
import type { LCTool } from '@librechat/agents';
import { resolveJsonSchemaRefs, normalizeJsonSchema, sanitizeGeminiSchema } from '~/mcp/zod';
import { toTarsVertexModelId } from '~/tars/vertex';

type Schema = Record<string, unknown>;

/** LangChain's Gemini connection, as far as function responses go. */
interface VertexConnection {
  formatData: (
    input: BaseMessage[] | string,
    parameters: object,
  ) => Promise<{ contents?: Array<{ parts: Array<{ functionResponse?: { name: string } }> }> }>;
}

/** `ChatVertexAI`'s connections, which its types keep protected. */
interface VertexClient {
  connection: VertexConnection;
  streamedConnection: VertexConnection;
}

/** `isGemini3PlusModel` in `@librechat/agents`, which does not export it. */
const GEMINI_3_PLUS_PATTERN = /^gemini-(?:[3-9]|[1-9]\d+)(?:[.-]|$)/;

/**
 * Google's value for a `functionCall` whose thought signature is gone.
 * @see https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures
 */
const SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

const GEMINI_STRUCTURE_KEYS = ['type', 'enum', 'properties', 'items', 'anyOf'];

const isSchema = (value: unknown): value is Schema => isPlainObject(value);

/**
 * What a caller's `tool_calls` replay with on Gemini 3+ on Vertex AI, which 400s a tool loop's
 * next step when its `functionCall` has no thought signature. The OpenAI wire format carries
 * none back to us, and unlike the Gemini API client, the Vertex client fills in no substitute.
 */
export function getVertexToolCallSignature(
  provider?: string,
  model?: string | null,
): string | undefined {
  const modelId =
    toTarsVertexModelId(model ?? '')
      .toLowerCase()
      .split('/')
      .pop() ?? '';
  return provider === Providers.VERTEXAI && GEMINI_3_PLUS_PATTERN.test(modelId)
    ? SKIP_THOUGHT_SIGNATURE
    : undefined;
}

/**
 * Signs the tool calls of already-built messages (see {@link getVertexToolCallSignature}), for a
 * caller whose replay reaches the run through `formatAgentMessages`, as the Responses API's does.
 */
export function signVertexToolCalls(
  messages: BaseMessage[],
  provider?: string,
  model?: string | null,
): void {
  const signature = getVertexToolCallSignature(provider, model);
  if (!signature) {
    return;
  }
  for (const message of messages) {
    const toolCalls = (message as AIMessage).tool_calls;
    if (toolCalls?.length) {
      message.additional_kwargs = {
        ...message.additional_kwargs,
        signatures: toolCalls.map(() => signature),
      };
    }
  }
}

/**
 * Names each `functionResponse` after the call it answers. LangChain's `toolMessageToContent` takes
 * the name from the previous message, so the second and later results of a parallel call go out
 * under the previous tool's name. Each tool message builds one response, in order; a request where
 * that does not hold is left as built.
 */
function nameFunctionResponses(
  contents: NonNullable<Awaited<ReturnType<VertexConnection['formatData']>>['contents']>,
  messages: BaseMessage[],
): void {
  const callNames = new Map<string, string>();
  const names: Array<string | undefined> = [];
  for (const message of messages) {
    for (const { id, name } of (message as AIMessage).tool_calls ?? []) {
      if (id) {
        callNames.set(id, name);
      }
    }
    if (message.getType() === 'tool') {
      names.push(callNames.get((message as ToolMessage).tool_call_id) ?? message.name);
    }
  }
  const responses = contents.flatMap(({ parts }) =>
    parts.flatMap(({ functionResponse }) => functionResponse ?? []),
  );
  if (responses.length !== names.length) {
    return;
  }
  responses.forEach((response, index) => {
    response.name = names[index] ?? response.name;
  });
}

function wrapFormatData(connection: VertexConnection): void {
  const formatData = connection.formatData.bind(connection);
  connection.formatData = async (input, parameters) => {
    const data = await formatData(input, parameters);
    if (data.contents && Array.isArray(input)) {
      nameFunctionResponses(data.contents, input);
    }
    return data;
  };
}

let vertexToolResponsesNamed = false;

/**
 * Applies {@link nameFunctionResponses} to every Vertex client built from here on. Neither the SDK
 * nor LangChain offers a seam for it, so it wraps the connections `buildConnection` creates. Runs
 * at request time, since a module-load patch would break every suite that mocks the SDK.
 */
export function nameVertexToolResponses(): void {
  if (vertexToolResponsesNamed) {
    return;
  }
  vertexToolResponsesNamed = true;
  const { prototype } = getChatModelClass(Providers.VERTEXAI);
  const { buildConnection } = prototype;
  prototype.buildConnection = function (...args: Parameters<typeof buildConnection>) {
    buildConnection.apply(this, args);
    const { connection, streamedConnection } = this as unknown as VertexClient;
    wrapFormatData(connection);
    wrapFormatData(streamedConnection);
  };
}

/** Types an open value as `[scalars, null]`, the one union `zod_to_gemini_parameters` folds. */
function typeOpenValue(schema: Schema): Schema {
  if (GEMINI_STRUCTURE_KEYS.some((key) => key in schema)) {
    return typeNestedValues(schema);
  }
  return {
    ...schema,
    anyOf: [
      { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
      { type: 'null' },
    ],
  };
}

function typeNestedValues(schema: Schema): Schema {
  const { items, properties } = schema;
  return {
    ...schema,
    ...(isSchema(items) && { items: typeOpenValue(items) }),
    ...(isSchema(properties) && {
      properties: Object.fromEntries(
        Object.entries(properties).map(([name, value]) => [
          name,
          isSchema(value) ? typeOpenValue(value) : value,
        ]),
      ),
    }),
  };
}

function reduceToolSchema(tool: LCTool): LCTool {
  if (tool.parameters == null) {
    return tool;
  }
  const parameters = typeNestedValues(
    sanitizeGeminiSchema(normalizeJsonSchema(resolveJsonSchemaRefs(tool.parameters))),
  ) as LCTool['parameters'];
  return isEqual(parameters, tool.parameters) ? tool : { ...tool, parameters };
}

/**
 * Reduces the schemas an agent binds to what Vertex AI accepts, whatever their source (MCP,
 * pwc_tars manifests, Actions, a gateway caller): Vertex 400s on a parameter without a `type`
 * (`{}`, pydantic `Any`, a stripped `$ref`), and its client's converter throws on most unions.
 * Reduce a tool once: `sanitizeGeminiSchema` narrows a typed open value to a single type. Other
 * providers keep their schemas as loaded, and so does `toolRegistry`, which the SDK does not bind.
 */
export function reduceVertexToolSchemas(agent: {
  provider?: string;
  toolDefinitions?: LCTool[];
}): void {
  if (agent.provider === Providers.VERTEXAI) {
    agent.toolDefinitions = agent.toolDefinitions?.map(reduceToolSchema);
  }
}
