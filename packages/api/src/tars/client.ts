import { logger } from '@librechat/data-schemas';
import { signTarsBearer } from './bearer';

const DEFAULT_TIMEOUT_MS = 15000;

export type TarsQuery = Record<string, string | number | boolean | undefined | null>;

export interface TarsFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: TarsQuery;
  timeoutMs?: number;
  baseUrl?: string;
  /** Extra request headers, merged over the JSON content type (e.g. a service key). */
  headers?: Record<string, string>;
  /**
   * pwc_tars user id to authenticate as, for routes behind pwc_tars's `@admin_required`.
   * Sends a short-lived bearer signed with `TARS_JWT_SECRET`.
   */
  asUser?: string;
}

/**
 * Non-2xx pwc_tars response. `serverMessage` carries the `message` field of the
 * pwc_tars error envelope (`{success: false, message}`) when the body was JSON,
 * so callers can surface the backend's own failure reason (e.g. an MCP tool
 * execution error) instead of a generic status line.
 */
export class TarsRequestError extends Error {
  public readonly status: number;
  public readonly serverMessage?: string;

  constructor(status: number, path: string, serverMessage?: string) {
    super(`pwc_tars request to ${path} returned status ${status}`);
    this.name = 'TarsRequestError';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/** Whether the pwc_tars integration is configured (env `TARS_AUTH_URL` is set). */
export function isTarsConfigured(baseUrl: string | undefined = process.env.TARS_AUTH_URL): boolean {
  return !!baseUrl?.trim();
}

/** Returns the trailing-slash-normalized pwc_tars base URL or throws when unconfigured. */
export function getTarsBaseUrl(baseUrl: string | undefined = process.env.TARS_AUTH_URL): string {
  if (!baseUrl?.trim()) {
    throw new Error('TARS_AUTH_URL is not configured');
  }
  return baseUrl.replace(/\/+$/, '');
}

function buildUrl(base: string, path: string, query?: TarsQuery): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!query) {
    return `${base}${normalizedPath}`;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null) {
      params.append(key, String(value));
    }
  }
  const queryString = params.toString();
  return queryString ? `${base}${normalizedPath}?${queryString}` : `${base}${normalizedPath}`;
}

function bearerHeaders(
  path: string,
  asUser: string | undefined,
  secret: string | undefined = process.env.TARS_JWT_SECRET,
): Record<string, string> {
  if (!asUser) {
    return {};
  }
  if (!secret?.trim()) {
    throw new TarsRequestError(503, path, 'TARS_JWT_SECRET is not configured');
  }
  return { Authorization: `Bearer ${signTarsBearer(asUser, secret)}` };
}

/**
 * Shared JSON fetch helper for pwc_tars Flask endpoints. Mirrors the timeout /
 * logging behavior of `auth/tars.ts` so every pwc_tars integration calls the
 * backend the same way. Throws on connection/timeout failures and on non-2xx
 * responses so callers can surface a 5xx.
 */
export async function tarsFetch<T>(path: string, options: TarsFetchOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseUrl,
    headers,
    asUser,
  } = options;
  const url = buildUrl(getTarsBaseUrl(baseUrl), path, query);
  const authHeaders = bearerHeaders(path, asUser);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders, ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error(`[tarsFetch] Unexpected status ${response.status} from ${method} ${url}`);
      let serverMessage: string | undefined;
      try {
        /** Most pwc_tars blueprints answer `{message}`; the audit-log one uses `{error}`. */
        const errorBody = (await response.json()) as { message?: unknown; error?: unknown };
        if (typeof errorBody?.message === 'string') {
          serverMessage = errorBody.message;
        } else if (typeof errorBody?.error === 'string') {
          serverMessage = errorBody.error;
        }
      } catch {
        /* non-JSON error body */
      }
      throw new TarsRequestError(response.status, path, serverMessage);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error(`[tarsFetch] Request to ${url} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export interface TarsStreamOptions extends Omit<TarsFetchOptions, 'method' | 'query'> {
  /** Ends the request early, e.g. when the chat run that asked for it is stopped. */
  signal?: AbortSignal;
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { message?: unknown; error?: unknown };
    if (typeof body?.message === 'string') {
      return body.message;
    }
    return typeof body?.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
}

/** Splits an SSE buffer into complete `data:` payloads, returning the unfinished tail. */
function takeSseData(buffer: string): { payloads: string[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const payloads: string[] = [];
  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) {
      payloads.push(data);
    }
  }
  return { payloads, rest };
}

/**
 * POSTs to a pwc_tars server-sent-events endpoint and hands each `data:` frame,
 * parsed as JSON, to `onEvent` as it arrives. Comment frames (keepalives) are
 * skipped. Resolves when the stream ends; throws like {@link tarsFetch} on a
 * non-2xx response, on timeout, and when `signal` aborts.
 */
export async function tarsStream<T>(
  path: string,
  onEvent: (event: T) => void,
  options: TarsStreamOptions = {},
): Promise<void> {
  const { body, timeoutMs = DEFAULT_TIMEOUT_MS, baseUrl, headers, asUser, signal } = options;
  const url = buildUrl(getTarsBaseUrl(baseUrl), path);
  const authHeaders = bearerHeaders(path, asUser);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders,
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: combined,
  });
  if (!response.ok || !response.body) {
    logger.error(`[tarsStream] Unexpected status ${response.status} from POST ${url}`);
    throw new TarsRequestError(response.status, path, await readErrorMessage(response));
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const { payloads, rest } = takeSseData(buffer + value.replace(/\r\n/g, '\n'));
      buffer = rest;
      for (const payload of payloads) {
        onEvent(JSON.parse(payload) as T);
      }
    }
  } catch (error) {
    /** Close the connection so pwc_tars sees the caller leave and stops the work. */
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}
