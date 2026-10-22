import { logger } from '@librechat/data-schemas';
import {
  Tools,
  Constants,
  ContentTypes,
  TARS_TRACE_EVENT,
  TARS_SWITCH_TOOLS,
} from 'librechat-data-provider';
import type { TTarsToolStep, TEphemeralAgent, TMessageContentParts } from 'librechat-data-provider';
import { isTarsToolFailureOutput, isSdkToolErrorOutput } from './failure';

/**
 * One pwc_tars `message_execution_trace` record, in the shape its events'
 * `to_trace` produce (pwc_tars `agent_core/events.py`). pwc_tars stores the
 * whole record as the row payload and lifts `type`/`id`/`name`/`turn`/`ok`/
 * timing into columns.
 */
export type TarsTraceRecord = {
  type: string;
  started_at?: string;
  ended_at?: string;
  [key: string]: unknown;
};

/** Tags what LibreChat wrote to pwc_tars, so pwc_tars and the audit report can tell it from their own. */
export const TARS_MIRROR_SOURCE = 'librechat';

/** One model call's token usage, as the agents run collects it. */
export interface TarsTraceUsage {
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  /** LibreChat's own count, used because the provider reported no usage. */
  estimated?: boolean;
  /**
   * Set on a side call rather than one of the chat model's own turns:
   * `summarization`, `subagent`, `sequential` (as `ModelEndHandler` tags them).
   */
  usage_type?: string | null;
}

/** A list a caller handed in, or nothing: a non-array is read as empty rather than iterated. */
function asList<T>(value: ReadonlyArray<T> | null | undefined): readonly T[];
function asList(value: unknown): readonly unknown[];
function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object';

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const tokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * The usage to record for a turn. A provider that streams without usage (vLLM
 * unless `stream_options.include_usage` is on) leaves the collected list empty;
 * LibreChat then bills its own count — the prompt it built and the response's
 * `tokenCount` — and that same count stands in here, as one row marked
 * `estimated`. "Has real usage" is decided as `AgentClient` decides it.
 */
export function resolveTarsUsage(
  collected: TarsTraceUsage[] | null | undefined,
  estimate: { promptTokens?: number | null; completionTokens?: number | null } | null | undefined,
): TarsTraceUsage[] {
  const reported = asList(collected).filter(
    (usage) => isObject(usage) && (usage.input_tokens != null || usage.output_tokens != null),
  );
  if (reported.length > 0) {
    return reported;
  }
  const input = tokenCount(estimate?.promptTokens);
  const output = tokenCount(estimate?.completionTokens);
  return input || output ? [{ input_tokens: input, output_tokens: output, estimated: true }] : [];
}

/**
 * Why each model call stopped, keyed by the usage entry `ModelEndHandler`
 * collected for it: upstream keeps no finish reason, and the entry itself is
 * billing data, so the reason is held beside it rather than written onto it.
 */
const finishReasons = new WeakMap<object, string>();

/** Notes the finish reason of the model output a collected usage entry came from. */
export function noteTarsFinishReason(usage: object | null | undefined, output: unknown): void {
  if (!isObject(usage) || !isObject(output)) {
    return;
  }
  /** Runs inside the chat's model-end handler: an odd output loses its reason, never the turn. */
  try {
    const metadata = isObject(output.response_metadata) ? output.response_metadata : {};
    const kwargs = isObject(output.additional_kwargs) ? output.additional_kwargs : {};
    const reason =
      metadata.finish_reason ?? metadata.stop_reason ?? metadata.finishReason ?? kwargs.stop_reason;
    if (nonEmptyString(reason)) {
      finishReasons.set(usage, reason);
    }
  } catch (error) {
    logger.debug('[tars-trace] Could not read a model call’s finish reason', error);
  }
}

/** The finish reason noted for a collected usage entry, if any. */
export function tarsFinishReasonOf(usage: object | null | undefined): string | undefined {
  return usage ? finishReasons.get(usage) : undefined;
}

/**
 * The turn's token totals for the mirrored pwc_tars message, in the meaning
 * pwc_tars gives `message_tokens` / `response_tokens` on its own messages: every
 * model call the run made — each turn plus side calls such as summarization or
 * a subagent — summed (pwc_tars `AgentRunner` `result["token"]`). The trace's
 * usage rows are the same calls, so the report and the timeline agree.
 */
export function sumTarsUsage(usage: TarsTraceUsage[] | null | undefined): {
  messageTokens: number;
  responseTokens: number;
} {
  let messageTokens = 0;
  let responseTokens = 0;
  for (const entry of asList(usage)) {
    if (!isObject(entry)) {
      continue;
    }
    messageTokens += tokenCount(entry?.input_tokens);
    responseTokens += tokenCount(entry?.output_tokens);
  }
  return { messageTokens, responseTokens };
}

/** What a finished LibreChat turn knows about itself when it is mirrored. */
export interface TarsTraceInput {
  query: string;
  content?: (TMessageContentParts | null | undefined)[] | null;
  /** Epoch ms the turn started (`req.turnStartedAt`). */
  startedAt?: number | null;
  /** Epoch ms the response was complete. */
  finishedAt: number;
  model?: string | null;
  endpoint?: string | null;
  agentId?: string | null;
  /** The 專用腦 this turn ran under; a conversation can switch brains between turns. */
  domainId?: string | number | null;
  ephemeralAgent?: TEphemeralAgent | null;
  isRegenerate?: boolean;
  /** This message's own attachments; earlier turns' files are in `threadFiles`. */
  turnFiles?: ReadonlyArray<TarsTurnFile | null | undefined> | null;
  modelParameters?: Record<string, unknown> | null;
  /**
   * The tools the agent was equipped with, whether or not it called them: names
   * on a stored agent, tool instances once the run has initialized it.
   */
  availableTools?: Array<string | { name?: string } | null> | null;
  usage?: TarsTraceUsage[] | null;
  /**
   * Audit-only records pwc_tars returned for a tool call (`rag_retrieval`), by
   * the call's id; each is placed after that call's result, under it.
   */
  toolAuditTrace?: ReadonlyMap<string, readonly TarsTraceRecord[]> | null;
  /**
   * Tokens a pwc_tars tool call spent on its own model calls, by the call's id.
   * pwc_tars counts them in a message's totals; each becomes a usage row under
   * its call, so the report's totals include them too.
   */
  toolUsage?: ReadonlyMap<string, TarsTraceUsage> | null;
  /** The turn's calls whose MCP server reported an error (`takeTarsFailedToolCalls`). */
  failedToolCalls?: ReadonlySet<string> | null;
  /** The response's attachments: TARS tool cards, web search results and files tools produced, by tool call. */
  attachments?: ReadonlyArray<TarsTraceAttachment | null | undefined> | null;
  /**
   * The thread's attachments in reach of this turn — LibreChat's counterpart of
   * pwc_tars's memory area (see `primeTarsTurnFiles`).
   */
  threadFiles?: Partial<Record<TarsThreadFileKind, TarsThreadFile[] | null>> | null;
}

/** An attachment of the message being answered, as the message stores it. */
export interface TarsTurnFile {
  file_id?: string | null;
  filename?: string | null;
  type?: string | null;
}

/** A thread attachment, by its LibreChat `file_id` when it has one. */
export interface TarsThreadFile {
  id?: string | null;
  filename: string;
}

/**
 * How each kind of thread file reached the model, as pwc_tars's `injected_as`:
 * text attachments as their text, spreadsheets mounted for the data tools, and
 * three LibreChat additions — documents such as a PDF the provider reads
 * itself, images, and attachments kept out of the prompt — so every file the
 * turn could see is listed and downloadable from the audit report.
 */
const THREAD_FILE_INJECTION = {
  textFiles: 'summary',
  providerFiles: 'provider',
  imageFiles: 'image',
  dataFiles: 'data_file',
  otherFiles: 'attachment',
} as const;

type TarsThreadFileKind = keyof typeof THREAD_FILE_INJECTION;

/** The fields of a response attachment {@link toolDetailsByCall} reads. */
export interface TarsTraceAttachment {
  type?: string;
  toolCallId?: string;
  /** Set on a file the call produced (code output, an image a tool returned). */
  file_id?: string;
  filename?: string;
  [Tools.tars_trace]?: { step?: Partial<TTarsToolStep> | null } | null;
  [Tools.web_search]?: {
    organic?: Array<{ link?: string } | null>;
    topStories?: Array<{ link?: string } | null>;
    news?: Array<{ link?: string } | null>;
  } | null;
}

/** What a tool call's attachments add to its `tool_result` row. */
interface ToolDetails {
  summary?: string;
  sources?: string[];
  ok?: boolean;
}

/** Attachments that describe a call rather than carry a file it produced. */
const NON_FILE_ATTACHMENTS: ReadonlySet<string> = new Set([
  Tools.tars_trace,
  Tools.web_search,
  Tools.ui_resources,
  Tools.memory,
]);

const links = (items: unknown): string[] =>
  asList(items)
    .map((item) => (isObject(item) ? item.link : undefined))
    .filter(nonEmptyString);

/**
 * A TARS tool's card carries pwc_tars's summary (`2 chunks`), the files it read
 * and whether it worked; a web search carries the pages it found. pwc_tars keeps
 * these on `tool_result` as `summary` and `sources` (file names or URLs).
 */
function toolDetailsByCall(attachments: TarsTraceInput['attachments']): Map<string, ToolDetails> {
  const details = new Map<string, ToolDetails>();
  for (const attachment of asList(attachments)) {
    if (!isObject(attachment) || !nonEmptyString(attachment.toolCallId)) {
      continue;
    }
    const toolCallId = attachment.toolCallId;
    const entry = details.get(toolCallId) ?? {};
    const card = attachment[Tools.tars_trace];
    const step = isObject(card) && isObject(card.step) ? card.step : undefined;
    if (attachment.type === Tools.tars_trace && step) {
      if (nonEmptyString(step.summary)) {
        entry.summary = step.summary;
      }
      const files = asList(step.sources)
        .map((source) => (isObject(source) ? source.filename : undefined))
        .filter(nonEmptyString);
      /** Generated charts and files: pwc_tars keeps a tool's artifact URLs in `sources` too. */
      const generated = asList(step.links)
        .map((link) => (isObject(link) ? link.url : undefined))
        .filter(nonEmptyString);
      if (files.length || generated.length) {
        entry.sources = [...(entry.sources ?? []), ...files, ...generated];
      }
      if (step.ok === false) {
        entry.ok = false;
      }
    }
    const search = attachment[Tools.web_search];
    if (attachment.type === Tools.web_search && isObject(search)) {
      const urls = [...links(search.organic), ...links(search.topStories), ...links(search.news)];
      if (urls.length) {
        entry.sources = [...new Set([...(entry.sources ?? []), ...urls])];
      }
    }
    /** A file the call wrote (Python output, a returned image), as pwc_tars lists
     *  its own tools' generated files. Named rather than linked: its LibreChat
     *  download path means nothing from the pwc_tars report. */
    if (
      !NON_FILE_ATTACHMENTS.has(typeof attachment.type === 'string' ? attachment.type : '') &&
      nonEmptyString(attachment.file_id) &&
      nonEmptyString(attachment.filename)
    ) {
      entry.sources = [...new Set([...(entry.sources ?? []), attachment.filename])];
    }
    details.set(toolCallId, entry);
  }
  return details;
}

type ToolCallPart = Extract<TMessageContentParts, { type: ContentTypes.TOOL_CALL }>;
type ModelPart = {
  type: typeof TARS_TRACE_EVENT.thinking | typeof TARS_TRACE_EVENT.text;
  text: string;
  start?: number;
  end?: number;
};

/**
 * When a thinking or text part streamed, stamped by {@link stampTarsStepTiming}.
 * Upstream records step timing only on tool calls (`runStepClosedAt`), so these
 * carry their own names rather than borrowing that field's meaning.
 */
export type TarsStepTiming = {
  /** Epoch ms the step opened: its first chunk arrived. */
  tarsStepStartedAt?: number;
  /** Epoch ms the step closed: the model moved on to the next part. */
  tarsStepClosedAt?: number;
};

/** The part an `on_run_step_closed` event resolves to, as the handlers hold it. */
type ClosablePart = { type?: string } & TarsStepTiming;

/** The `on_run_step_closed` payload fields this reads. */
type StepClosure = { created_at?: number; closed_at?: number };

/**
 * Records when a thinking or answer step streamed, from the SDK's own step
 * closure, so the audit trace can show measured spans instead of inferred ones.
 * Tool calls are left alone — upstream already stamps those. Safe to call at
 * closure: the SDK rebuilds a part on each delta, but a step's deltas all come
 * before it closes.
 *
 * The stamps are non-enumerable, so they live only on the in-memory part the
 * mirror reads: JSON never carries them, which keeps them out of the saved
 * message and, above all, out of the next turn's provider request — the SDK
 * replays text parts as-is, and strict APIs (OpenAI) reject unknown fields.
 */
export function stampTarsStepTiming(
  part: ClosablePart | null | undefined,
  closed: StepClosure | null | undefined,
): void {
  if (part?.type !== ContentTypes.THINK && part?.type !== ContentTypes.TEXT) {
    return;
  }
  const startedAt = closed?.created_at;
  const closedAt = closed?.closed_at;
  if (!validTime(startedAt) || !validTime(closedAt) || closedAt < startedAt) {
    return;
  }
  /** Runs inside the chat's step-closed handler: a part that cannot take the stamp stays inferred. */
  try {
    Object.defineProperties(part, {
      tarsStepStartedAt: {
        value: startedAt,
        enumerable: false,
        configurable: true,
        writable: true,
      },
      tarsStepClosedAt: { value: closedAt, enumerable: false, configurable: true, writable: true },
    });
  } catch (error) {
    logger.debug('[tars-trace] Could not stamp a step’s timing', error);
  }
}

/** The measured span of a part, when it was stamped. */
const stampedSpan = (part: TarsStepTiming): { start?: number; end?: number } =>
  validTime(part.tarsStepStartedAt) && validTime(part.tarsStepClosedAt)
    ? { start: part.tarsStepStartedAt, end: part.tarsStepClosedAt }
    : {};
type ToolTiming = { start?: number; end?: number; modelEnd?: number };
type Turn = { model: ModelPart[]; tools: ToolCallPart['tool_call'][] };

/** The largest epoch ms a `Date` can hold; beyond it `toISOString` throws. */
const MAX_DATE_MS = 8.64e15;

const validTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DATE_MS;

/**
 * pwc_tars writes `datetime.isoformat()` of aware UTC times; this matches it.
 * A time derived out of range (e.g. from a nonsense duration) is written as now.
 */
const iso = (ms: number): string => {
  const at = Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS ? ms : Date.now();
  return new Date(at).toISOString().replace('Z', '+00:00');
};

const partText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value != null && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    return typeof inner === 'string' ? inner : '';
  }
  return '';
};

/** Tool args arrive as JSON text while streaming; pwc_tars records `input` as the parsed object. */
const parseArgs = (args: unknown): unknown => {
  if (typeof args !== 'string') {
    return args ?? {};
  }
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
};

/**
 * When the call ran. Dispatch → close are measured by the agents run; the model
 * stops generating when the call's arguments start streaming, which is earlier.
 */
function toolTiming(call: ToolCallPart['tool_call']): ToolTiming {
  const dispatched = validTime(call.toolDispatchedAt) ? call.toolDispatchedAt : undefined;
  const prepared = validTime(call.toolPreparationStartedAt)
    ? call.toolPreparationStartedAt
    : undefined;
  const closed = validTime(call.runStepClosedAt) ? call.runStepClosedAt : undefined;
  let start = dispatched ?? prepared;
  if (start == null && closed != null && validTime(call.runStepDurationMs)) {
    const derived = closed - call.runStepDurationMs;
    start = validTime(derived) ? derived : undefined;
  }
  let end = closed;
  if (end == null && start != null && validTime(call.toolExecutionDurationMs)) {
    const derived = start + call.toolExecutionDurationMs;
    end = validTime(derived) ? derived : undefined;
  }
  return { start, end: end ?? start, modelEnd: prepared ?? start };
}

type ToolCallView = { name: string; args: unknown; output: unknown };

/** The tool call's name, arguments and output, whichever of the call shapes it has. */
function describeCall(call: ToolCallPart['tool_call']): ToolCallView {
  if ('name' in call) {
    return {
      name: typeof call.name === 'string' ? call.name : '',
      args: call.args,
      output: 'output' in call ? call.output : undefined,
    };
  }
  if ('function' in call && isObject(call.function)) {
    return {
      name: typeof call.function.name === 'string' ? call.function.name : '',
      args: call.function.arguments,
      output: call.function.output,
    };
  }
  if ('code_interpreter' in call && isObject(call.code_interpreter)) {
    return {
      name: 'code_interpreter',
      args: call.code_interpreter.input,
      output: call.code_interpreter.outputs,
    };
  }
  return {
    name: typeof call.type === 'string' ? call.type : '',
    args: undefined,
    output: undefined,
  };
}

/** `undefined` when nothing says whether the call worked. */
function toolOk(
  call: ToolCallPart['tool_call'],
  output: unknown,
  failedToolCalls: TarsTraceInput['failedToolCalls'],
): boolean | undefined {
  if (call.runStepStatus === 'failed' || call.runStepStatus === 'cancelled') {
    return false;
  }
  /** A TARS tool answers a failure in text, an MCP server's `isError` is dropped
   *  by LibreChat's client, and the SDK answers a thrown tool in text too, so
   *  each of these steps still closes as completed. */
  if (
    isTarsToolFailureOutput(output) ||
    (call.id != null && failedToolCalls?.has(call.id) === true) ||
    isSdkToolErrorOutput(output)
  ) {
    return false;
  }
  if (call.runStepStatus === 'completed') {
    return true;
  }
  return output != null ? true : undefined;
}

/** pwc_tars stores tool output as text; structured output is kept as its JSON. */
const outputText = (output: unknown): string | null => {
  if (output == null) {
    return null;
  }
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output) ?? String(output);
  } catch {
    return String(output);
  }
};

/** The error parts' messages, in order. */
export function tarsContentErrors(content: TarsTraceInput['content']): string[] {
  return splitTurns(content).errors;
}

/**
 * Splits the response's parts into model calls: a new call starts whenever the
 * model writes again after having called tools.
 */
function splitTurns(content: TarsTraceInput['content']): { turns: Turn[]; errors: string[] } {
  const turns: Turn[] = [{ model: [], tools: [] }];
  const errors: string[] = [];
  for (const part of asList(content)) {
    if (!isObject(part)) {
      continue;
    }
    if (part.type === ContentTypes.ERROR) {
      errors.push((nonEmptyString(part.error) && part.error) || partText(part.text) || 'error');
      continue;
    }
    let current = turns[turns.length - 1];
    if (part.type === ContentTypes.TOOL_CALL) {
      if (isObject(part.tool_call)) {
        current.tools.push(part.tool_call);
      }
      continue;
    }
    const isThink = part.type === ContentTypes.THINK;
    if (!isThink && part.type !== ContentTypes.TEXT) {
      continue;
    }
    /** Reasoning models (e.g. Qwen on vLLM) open the answer with the newlines that
     *  followed `</think>`; trimmed so the record starts at the text, and a part that
     *  is only whitespace is not recorded at all. */
    const text = (isThink ? partText(part.think) : partText(part.text)).trim();
    if (!text) {
      continue;
    }
    if (current.tools.length > 0) {
      current = { model: [], tools: [] };
      turns.push(current);
    }
    current.model.push({
      type: isThink ? TARS_TRACE_EVENT.thinking : TARS_TRACE_EVENT.text,
      text,
      ...stampedSpan(part as TarsStepTiming),
    });
  }
  return { turns: turns.filter((turn) => turn.model.length || turn.tools.length), errors };
}

/**
 * The model settings worth auditing. The agent's `model_parameters` is the whole
 * client config — API key, headers, the HTTP dispatcher — so only these keys are
 * copied, and only plain values (a nested setting keeps its plain fields).
 */
const AUDITED_MODEL_KWARGS = [
  'model',
  'temperature',
  'top_p',
  'topP',
  'topK',
  'max_tokens',
  'maxTokens',
  'max_completion_tokens',
  'maxOutputTokens',
  'frequency_penalty',
  'presence_penalty',
  'reasoning_effort',
  'reasoningEffort',
  'reasoning',
  'thinking',
  'thinkingBudget',
  'thinkingLevel',
  'verbosity',
  'streaming',
  'streamUsage',
  'useResponsesApi',
] as const;

const SECRET_KEY = /api[_-]?key|secret|access[_-]?token|auth|password|header|cookie/i;

function plainSetting(value: unknown, depth = 0): unknown {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }
  if (depth > 0 || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET_KEY.test(key))
    .map(([key, inner]) => [key, plainSetting(inner, depth + 1)] as const)
    .filter(([, inner]) => inner !== undefined);
  return Object.fromEntries(entries);
}

export function auditedModelKwargs(
  parameters: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {};
  for (const key of AUDITED_MODEL_KWARGS) {
    const value = plainSetting(parameters?.[key]);
    if (value !== undefined) {
      kwargs[key] = value;
    }
  }
  return kwargs;
}

/** The model's base URL without credentials or query, as pwc_tars records `model_endpoint`. */
function modelEndpoint(parameters: Record<string, unknown>): string | null {
  const configuration = parameters.configuration as { baseURL?: unknown } | undefined;
  const baseURL = configuration?.baseURL ?? parameters.baseURL;
  if (typeof baseURL !== 'string' || !baseURL) {
    return null;
  }
  try {
    const url = new URL(baseURL);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/** The configured effort, wherever the provider keeps it; null when none was set. */
function reasoningEffort(parameters: Record<string, unknown>): string | null {
  const reasoning = parameters.reasoning as { effort?: unknown } | undefined;
  const thinking = parameters.thinking as { type?: unknown } | undefined;
  const value =
    parameters.reasoning_effort ??
    parameters.reasoningEffort ??
    reasoning?.effort ??
    parameters.thinkingLevel ??
    (thinking?.type === 'enabled' ? 'enabled' : undefined);
  return typeof value === 'string' && value ? value : null;
}

/**
 * Retrieval settings pwc_tars returned with a tool's audit records (a
 * `provenance` fragment: reranker, embeddings, Milvus, limits), merged into
 * the turn's own provenance as pwc_tars's chat records them there.
 */
function retrievalProvenance(input: TarsTraceInput): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const records of input.toolAuditTrace?.values() ?? []) {
    for (const record of asList(records)) {
      if (!isObject(record) || record.type !== TARS_TRACE_EVENT.provenance) {
        continue;
      }
      for (const [key, value] of Object.entries(record)) {
        if (key !== 'type' && value != null && merged[key] == null) {
          merged[key] = value;
        }
      }
    }
  }
  return merged;
}

/** A tool's name: a stored agent lists names, an initialized run holds tool instances. */
const toolName = (tool: unknown): unknown => (isObject(tool) ? tool.name : tool);

const toolNames = (tools: TarsTraceInput['availableTools']): string[] =>
  asList(tools).map(toolName).filter(nonEmptyString);

/** The switches a turn ran with, as pwc_tars's request records them. */
export interface TarsTurnSwitches {
  knowledge: boolean;
  database: boolean;
  webSearch: boolean;
  fileGenerate: boolean;
  mcpServers: string[];
}

/**
 * The chat's switches live on `ephemeralAgent`; a saved agent has none and
 * carries the same capabilities as tools instead, so a switch also counts as on
 * when its tool was equipped. MCP servers are read off `<tool>_mcp_<server>`.
 */
export function resolveTarsTurnSwitches(
  ephemeralAgent: TEphemeralAgent | null | undefined,
  availableTools: TarsTraceInput['availableTools'],
): TarsTurnSwitches {
  const switches = isObject(ephemeralAgent) ? ephemeralAgent : {};
  const tools = new Set(toolNames(availableTools));
  const has = (names: readonly string[]) => names.some((name) => tools.has(name));
  const mcpServers = new Set(asList(switches.mcp).filter(nonEmptyString));
  for (const name of tools) {
    const at = name.lastIndexOf(Constants.mcp_delimiter);
    if (at > 0) {
      mcpServers.add(name.slice(at + Constants.mcp_delimiter.length));
    }
  }
  return {
    knowledge: switches.rag_agent === true || has(TARS_SWITCH_TOOLS.rag_agent),
    database: switches.sql_agent === true || has(TARS_SWITCH_TOOLS.sql_agent),
    webSearch: switches.web_search === true || tools.has(Tools.web_search),
    fileGenerate: switches.file_agent === true || has(TARS_SWITCH_TOOLS.file_agent),
    mcpServers: [...mcpServers],
  };
}

function requestRecords(input: TarsTraceInput, at: string): TarsTraceRecord[] {
  const switches = isObject(input.ephemeralAgent) ? input.ephemeralAgent : {};
  const turnSwitches = resolveTarsTurnSwitches(input.ephemeralAgent, input.availableTools);
  const mcpServers = turnSwitches.mcpServers;
  const parameters = isObject(input.modelParameters) ? input.modelParameters : {};
  const temperature = typeof parameters.temperature === 'number' ? parameters.temperature : null;
  /** A model that thinks by default (e.g. Qwen on vLLM) did think without an effort
   *  being set; "off" would misreport that turn, so it is recorded as `default`. */
  const thought = asList(input.content).some(
    (part) =>
      isObject(part) && part.type === ContentTypes.THINK && partText(part.think).trim() !== '',
  );
  const reasoning = reasoningEffort(parameters) ?? (thought ? 'default' : null);
  const dataFiles = asList(input.threadFiles?.dataFiles)
    .map((file) => (isObject(file) ? file.filename : undefined))
    .filter(nonEmptyString);
  const availableTools = toolNames(input.availableTools);
  const turnFiles = asList(input.turnFiles).filter(
    (file): file is TarsTurnFile & { filename: string } =>
      isObject(file) && nonEmptyString(file.filename),
  );
  const imageInputCount = turnFiles.filter(
    (file) => typeof file.type === 'string' && file.type.startsWith('image/'),
  ).length;
  return [
    {
      type: TARS_TRACE_EVENT.request,
      started_at: at,
      source: TARS_MIRROR_SOURCE,
      query: input.query,
      endpoint: input.endpoint ?? null,
      agent_id: input.agentId ?? null,
      domain_id: input.domainId != null && input.domainId !== '' ? String(input.domainId) : null,
      /** 知識庫檢索 searches the brain's knowledge bases; pwc_tars fills in their names. */
      ...(turnSwitches.knowledge && { uses_brain_knowledge_bases: true }),
    },
    {
      type: TARS_TRACE_EVENT.requestRaw,
      started_at: at,
      payload: {
        source: TARS_MIRROR_SOURCE,
        reasoning_effort: reasoning,
        upload_filename: turnFiles.length
          ? turnFiles.map((file) => file.filename).join(', ')
          : null,
        /** A LibreChat addition: the same files with the ids the audit report downloads them by. */
        upload_files: turnFiles
          .filter((file) => nonEmptyString(file.file_id))
          .map((file) => ({ file_id: file.file_id, filename: file.filename })),
        is_database_bound: turnSwitches.database,
        is_enable_web_search: turnSwitches.webSearch,
        is_file_generate_active: turnSwitches.fileGenerate,
        is_enable_suggested_questions: false,
        is_mcp_enabled: mcpServers.length > 0,
        is_enable_langflow: false,
        is_regenerate: input.isRegenerate === true,
        endpoint: input.endpoint ?? null,
        model: input.model ?? null,
        agent_id: input.agentId ?? null,
        ephemeral_agent: switches,
      },
    },
    {
      type: TARS_TRACE_EVENT.provenance,
      started_at: at,
      model_name: input.model ?? null,
      model_endpoint: modelEndpoint(parameters),
      temperature,
      model_kwargs: auditedModelKwargs(parameters),
      mcp_servers: mcpServers.map((name) => ({ name })),
      ...(availableTools.length && { available_tools: availableTools }),
      ...(dataFiles.length && { data_files: dataFiles }),
      ...(imageInputCount && { image_input_count: imageInputCount }),
      ...retrievalProvenance(input),
    },
    ...threadFileRecords(input, at),
  ];
}

/**
 * pwc_tars's `long_term_memory` row, one document per thread file by how it
 * reached the model. The LibreChat id rides as `file_id`, which the audit report
 * downloads it by: pwc_tars clears `id` on traces it did not build, since there
 * `id` means one of its own memory-area documents.
 */
function threadFileRecords(input: TarsTraceInput, at: string): TarsTraceRecord[] {
  const kinds = Object.entries(THREAD_FILE_INJECTION) as [TarsThreadFileKind, string][];
  const documents = kinds.flatMap(([kind, injectedAs]) =>
    asList(input.threadFiles?.[kind])
      .filter((file): file is TarsThreadFile => isObject(file) && nonEmptyString(file.filename))
      .map((file) => ({
        id: null,
        file_id: nonEmptyString(file.id) ? file.id : null,
        filename: file.filename,
        injected_as: injectedAs,
      })),
  );
  return documents.length
    ? [{ type: TARS_TRACE_EVENT.longTermMemory, started_at: at, documents, websites: [] }]
    : [];
}

/**
 * Rebuilds a pwc_tars-style execution trace from a finished LibreChat agent
 * response, so the audit report's timeline can show mirrored chats too.
 *
 * Tool calls carry real timestamps (dispatch → close), and so do thinking and
 * answer text stamped by {@link stampTarsStepTiming}. Every pwc_tars row needs a
 * start time, so a text part that somehow lacks a stamp (a step the SDK opened
 * without a time) is placed in the gap between the previous call's tools
 * finishing and its own tools starting (or the response ending), split evenly in
 * order. Its `timing: 'inferred'` marker stays in the stored payload only.
 */
export function buildTarsTraceRecords(input: TarsTraceInput): TarsTraceRecord[] {
  const { turns, errors } = splitTurns(input.content);
  const details = toolDetailsByCall(input.attachments);
  const timings = turns.map((turn) => turn.tools.map(toolTiming));
  const earliest = [
    ...turns.flatMap((turn) => turn.model.map((part) => part.start)),
    ...timings.flat().map((timing) => timing.modelEnd),
  ].filter(validTime);
  let t0 = earliest.length ? earliest.reduce((min, time) => Math.min(min, time)) : input.finishedAt;
  if (validTime(input.startedAt)) {
    t0 = input.startedAt;
  }
  const records: TarsTraceRecord[] = requestRecords(input, iso(t0));

  let cursor = t0;
  turns.forEach((turn, index) => {
    const turnNumber = index + 1;
    const turnTimings = timings[index];
    const toolStarts = turnTimings.map((timing) => timing.modelEnd).filter(validTime);
    /** The model writes until its first tool call starts streaming, or until the response ends. */
    let modelEnd = index === turns.length - 1 ? input.finishedAt : cursor;
    if (toolStarts.length) {
      modelEnd = toolStarts.reduce((min, time) => Math.min(min, time));
    }
    modelEnd = Math.max(cursor, modelEnd);
    records.push({ type: TARS_TRACE_EVENT.turn, turn: turnNumber, started_at: iso(cursor) });

    let turnEnd = modelEnd;
    const slice = turn.model.length ? (modelEnd - cursor) / turn.model.length : 0;
    turn.model.forEach((part, partIndex) => {
      const measured = part.start != null && part.end != null;
      const start = part.start ?? Math.round(cursor + slice * partIndex);
      const end = part.end ?? Math.round(cursor + slice * (partIndex + 1));
      turnEnd = Math.max(turnEnd, end);
      records.push({
        type: part.type,
        turn: turnNumber,
        text: part.text,
        started_at: iso(start),
        ended_at: iso(end),
        ...(!measured && { timing: 'inferred' }),
      });
    });

    turn.tools.forEach((call, callIndex) => {
      const timing = turnTimings[callIndex];
      const view = describeCall(call);
      const inferred = timing.start == null;
      const start = timing.start ?? modelEnd;
      const end = Math.max(start, timing.end ?? start);
      turnEnd = Math.max(turnEnd, end);
      const shared = {
        id: call.id ?? `librechat-${turnNumber}-${callIndex}`,
        name: view.name || 'tool',
        turn: turnNumber,
        attempt: 1,
        ...(inferred && { timing: 'inferred' }),
      };
      records.push({
        ...shared,
        type: TARS_TRACE_EVENT.toolCall,
        input: parseArgs(view.args),
        started_at: iso(start),
      });
      const detail = (call.id && details.get(call.id)) || {};
      records.push({
        ...shared,
        type: TARS_TRACE_EVENT.toolResult,
        ok: detail.ok ?? toolOk(call, view.output, input.failedToolCalls) ?? null,
        output: outputText(view.output),
        ...(detail.summary && { summary: detail.summary }),
        ...(detail.sources?.length && { sources: detail.sources }),
        started_at: iso(start),
        ended_at: iso(end),
        duration_ms: Math.round(end - start),
      });
      for (const record of asList(call.id ? input.toolAuditTrace?.get(call.id) : undefined)) {
        if (
          isObject(record) &&
          nonEmptyString(record.type) &&
          record.type !== TARS_TRACE_EVENT.provenance
        ) {
          records.push({ ...record, parent_id: shared.id, turn: turnNumber, started_at: iso(end) });
        }
      }
      const toolUsage = call.id ? input.toolUsage?.get(call.id) : undefined;
      if (toolUsage) {
        records.push({
          type: TARS_TRACE_EVENT.usage,
          parent_id: shared.id,
          turn: turnNumber,
          started_at: iso(end),
          input_tokens: tokenCount(toolUsage.input_tokens),
          output_tokens: tokenCount(toolUsage.output_tokens),
          source: 'tool',
        });
      }
    });
    cursor = turnEnd;
  });

  /** Turns count the chat model's own calls only; a side call (summarization, a
   *  subagent) is labeled by its kind and kept under the turn it ran in. */
  let modelTurn = 0;
  for (const usage of asList(input.usage)) {
    if (!isObject(usage)) {
      continue;
    }
    const sideCall = typeof usage.usage_type === 'string' && usage.usage_type !== '';
    if (!sideCall) {
      modelTurn += 1;
    }
    const turn = Math.max(modelTurn, 1);
    records.push({
      type: TARS_TRACE_EVENT.usage,
      turn,
      started_at: iso(t0),
      input_tokens: tokenCount(usage.input_tokens),
      output_tokens: tokenCount(usage.output_tokens),
      ...(nonEmptyString(usage.model) && { model: usage.model }),
      ...(usage.estimated === true && { estimated: true }),
      ...(sideCall && { source: usage.usage_type }),
    });
    const finishReason = tarsFinishReasonOf(usage);
    if (finishReason && !sideCall) {
      records.push({
        type: TARS_TRACE_EVENT.messageStop,
        turn,
        started_at: iso(input.finishedAt),
        finish_reason: finishReason,
      });
    }
  }
  /** A message the user sent while the run was going (LibreChat's steer) reached
   *  the model mid-turn; pwc_tars has no such event, so it is a `status` row. */
  for (const part of asList(input.content)) {
    if (!isObject(part) || part.type !== ContentTypes.STEER) {
      continue;
    }
    const steer = part as { steer?: unknown; createdAt?: unknown };
    const message = typeof steer.steer === 'string' ? steer.steer.trim() : '';
    if (!message) {
      continue;
    }
    const createdAt =
      typeof steer.createdAt === 'number' ? steer.createdAt : Date.parse(String(steer.createdAt));
    records.push({
      type: TARS_TRACE_EVENT.status,
      kind: 'steer',
      message,
      started_at: iso(validTime(createdAt) ? createdAt : input.finishedAt),
    });
  }
  errors.forEach((message) => {
    records.push({
      type: TARS_TRACE_EVENT.error,
      started_at: iso(input.finishedAt),
      error_code: 'librechat_error',
      message,
    });
  });
  return records;
}

/**
 * {@link buildTarsTraceRecords} for the mirror: a trace that cannot be built is
 * logged and left out, so the message itself is still mirrored.
 */
export function buildTarsMirrorTrace(input: TarsTraceInput): TarsTraceRecord[] | undefined {
  try {
    return buildTarsTraceRecords(input);
  } catch (error) {
    logger.warn('[tars-trace] Could not build the execution trace for a mirrored turn', error);
    return undefined;
  }
}
