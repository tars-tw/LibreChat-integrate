import { logger } from '@librechat/data-schemas';
import type { LangflowGeneratedUrl } from '~/tars/langflow/client';
import {
  langflowTimeoutMs,
  langflowServiceFetch,
  langflowServiceStream,
  TARS_CAPABILITY_DEFAULT_TIMEOUT_MS,
  TARS_TABLE_TASK_DEFAULT_TIMEOUT_MS,
} from '~/tars/langflow/client';
import { TarsRequestError } from '~/tars/client';

const SERVICE_TOOLS_PATH = '/api/langflow-service/tools';

/** What pwc_tars binds before it builds the tool; each tool reads only its own fields. */
export interface TarsBuiltinToolContext {
  question?: string;
  model_name?: string;
  /** Comma-separated, for knowledge search and the table task. */
  knowledge_base_ids?: string;
  /** The knowledge base whose database the SQL tools (and charts / excel sheets) query. */
  knowledge_base_id?: string;
  /** Comma-separated memory document ids of the attached spreadsheets. */
  document_ids?: string;
}

export interface TarsBuiltinToolSource {
  filename?: string;
  content?: string;
  type?: string;
}

/** `run_builtin_tool`'s payload: the tool's `ToolResult` plus the chat's source / link lists. */
export interface TarsBuiltinToolResult {
  content: string;
  is_error: boolean;
  summary: string;
  final_text: string;
  title?: string;
  sources: TarsBuiltinToolSource[];
  generated_urls: LangflowGeneratedUrl[];
  tokens?: { total?: number; prompt?: number; completion?: number };
  model_name?: string;
}

/** How one direct pwc_tars tool call is made; shared by built-in and plugin tools. */
export interface TarsServiceToolCallOptions {
  timeoutMs: number;
  /** The account the LLM gateway bills when the tool calls a model itself. */
  librechatUserId?: string;
  /** The linked pwc_tars user; pwc_tars scopes knowledge-base access to it. */
  tarsUserId?: string;
  /** Receives each progress line the tool reports while it runs (e.g. which rows it is on). */
  onProgress?: (message: string) => void;
  /** Stops the tool, e.g. when the chat run that called it is stopped. */
  signal?: AbortSignal;
}

/** One frame of `POST /tools/<name>/stream`. */
type ToolStreamEvent<T> =
  | { type: 'progress'; kind?: string; message?: string }
  | { type: 'result'; data?: T }
  | { type: 'error'; message?: string; error_code?: string; status?: number };

type ToolStreamOutcome<T> =
  | { ok: true; data?: T }
  | { ok: false; status: number; message?: string };

async function streamToolRun<T>(
  path: string,
  body: Record<string, unknown>,
  options: TarsServiceToolCallOptions,
): Promise<ToolStreamOutcome<T>> {
  let outcome: ToolStreamOutcome<T> | undefined;
  await langflowServiceStream<ToolStreamEvent<T>>(
    `${path}/stream`,
    (event) => {
      if (event.type === 'progress' && event.message) {
        options.onProgress?.(event.message);
      } else if (event.type === 'result') {
        outcome = { ok: true, data: event.data };
      } else if (event.type === 'error') {
        outcome = { ok: false, status: event.status ?? 500, message: event.message };
      }
    },
    {
      body,
      timeoutMs: options.timeoutMs,
      librechatUserId: options.librechatUserId,
      tarsUserId: options.tarsUserId,
      signal: options.signal,
    },
  );
  if (!outcome) {
    throw new Error('pwc_tars closed the tool stream without a result.');
  }
  return outcome;
}

/** A pwc_tars without the stream route answers 404 before any frame; it still has the JSON one. */
const lacksStreamRoute = (error: unknown): boolean =>
  error instanceof TarsRequestError && error.status === 404;

/**
 * Runs one tool directly on pwc_tars (`POST /api/langflow-service/tools/<name>`,
 * built-in or plugin), with no agent loop on the pwc_tars side. It streams
 * (`/stream`) so the progress the tool reports reaches `onProgress` while it
 * works, and falls back to the JSON route on a pwc_tars that predates the stream.
 */
export async function runTarsServiceTool<T>(
  toolName: string,
  body: Record<string, unknown>,
  options: TarsServiceToolCallOptions,
): Promise<T | undefined> {
  const path = `${SERVICE_TOOLS_PATH}/${encodeURIComponent(toolName)}`;
  let outcome: ToolStreamOutcome<T>;
  try {
    outcome = await streamToolRun<T>(path, body, options);
  } catch (error) {
    if (!lacksStreamRoute(error)) {
      throw error;
    }
    const legacy = await langflowServiceFetch<T>(path, {
      body,
      timeoutMs: options.timeoutMs,
      librechatUserId: options.librechatUserId,
      tarsUserId: options.tarsUserId,
    });
    outcome = { ok: true, data: legacy };
  }
  if (!outcome.ok) {
    throw new TarsRequestError(outcome.status, path, outcome.message);
  }
  return outcome.data;
}

export interface TarsBuiltinToolRunOptions extends Omit<TarsServiceToolCallOptions, 'timeoutMs'> {
  inputs: Record<string, unknown>;
  context: TarsBuiltinToolContext;
  longRunning?: boolean;
}

/**
 * Runs one pwc_tars built-in tool once: the arguments are the ones the chat
 * model wrote, exactly as pwc_tars's own loop would pass them.
 */
export async function runTarsBuiltinTool(
  toolName: string,
  options: TarsBuiltinToolRunOptions,
): Promise<TarsBuiltinToolResult> {
  const data = await runTarsServiceTool<Partial<TarsBuiltinToolResult>>(
    toolName,
    { inputs: options.inputs, context: options.context },
    {
      timeoutMs: options.longRunning
        ? langflowTimeoutMs('TARS_TABLE_TASK_TIMEOUT_MS', TARS_TABLE_TASK_DEFAULT_TIMEOUT_MS)
        : langflowTimeoutMs('TARS_AGENT_TIMEOUT_MS', TARS_CAPABILITY_DEFAULT_TIMEOUT_MS),
      librechatUserId: options.librechatUserId,
      tarsUserId: options.tarsUserId,
      onProgress: options.onProgress,
      signal: options.signal,
    },
  );
  const result: TarsBuiltinToolResult = {
    content: data?.content ?? '',
    is_error: data?.is_error === true,
    summary: data?.summary ?? '',
    final_text: data?.final_text ?? '',
    title: data?.title,
    sources: data?.sources ?? [],
    generated_urls: data?.generated_urls ?? [],
    tokens: data?.tokens,
    model_name: data?.model_name,
  };
  logger.debug(
    `[tars-tools] tool=${toolName} summary=${result.summary || '(none)'} ` +
      `error=${result.is_error ? 'yes' : 'no'} model=${result.model_name || '(none)'} ` +
      `tokens=${result.tokens?.total ?? 0}`,
  );
  return result;
}
