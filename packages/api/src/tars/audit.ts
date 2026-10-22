import { logger } from '@librechat/data-schemas';
import { FileSources, normalizeTarsMessageTrace } from 'librechat-data-provider';
import type {
  TTarsMessageTrace,
  TTarsAuditErrorBody,
  TTarsAuditErrorCode,
} from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { StoredFileRef } from '~/storage/path';
import {
  tarsFetch,
  bearerHeaders,
  getTarsBaseUrl,
  TarsRequestError,
  readTarsErrorMessage,
  TARS_SECRET_MISSING_MESSAGE,
  TARS_NOT_CONFIGURED_MESSAGE,
} from './client';
import { sendTarsFileStream, tarsAttachmentDisposition } from './files/route';
import { resolveDownloadPath } from '~/storage/path';

/**
 * A message audit row (`POST /api/settings/query_message_reports` → `data[]`).
 * pwc_tars assembles it by joining `message`, `conversation`, `sys_user` and the
 * long-term memory tables, then folds in the feedback counted for the period.
 */
export interface TarsAuditMessage {
  message_id: string;
  user_id: string | null;
  username: string | null;
  domain_name: string | null;
  user_query: string | null;
  model_response: string | null;
  conversation_id: string | null;
  conversation_name: string | null;
  knowledge_base_name: string | null;
  model_name: string | null;
  created_at: string | null;
  upload_files: string | null;
  memory_document: string | null;
  memory_website: string | null;
  is_web_search: boolean | null;
  is_sql_agent: boolean | null;
  ip_address: string | null;
  like_counts: number;
  dislike_counts: number;
  comments: string | null;
  is_deleted: boolean;
}

/** One raw feedback record (`MessageFeedback.to_dict()`), sorted newest first. */
export interface TarsAuditFeedback {
  id?: string;
  message_id: string;
  like_count?: number;
  dislike_count?: number;
  feedback?: string | null;
  created_at?: string | null;
  created_by?: string | null;
}

/** Per-specialized-brain rollup used by the statistics tab. */
export interface TarsAuditDomainStat {
  domain_name: string;
  conversation_count: number;
  message_count: number;
  knowledge_bases: { id?: string | number; name: string }[];
}

/** Totals for the queried period. */
export interface TarsAuditSummary {
  total_domains: number;
  total_conversations: number;
  total_messages: number;
  date_range: { start_date: string; end_date: string };
}

/**
 * The whole report. pwc_tars has no server-side paging — it returns every row in
 * the period, response text included — so the client pages what it already has.
 */
export interface TarsAuditReport {
  total_count: number;
  data: TarsAuditMessage[];
  feedback_data: TarsAuditFeedback[];
  summary: TarsAuditSummary | null;
  details: TarsAuditDomainStat[];
}

/** Filters the operator submits. Dates are `YYYY-MM-DD` in Asia/Taipei. */
export interface TarsAuditQuery {
  start_date: string;
  end_date: string;
  filter_user_ids?: string[];
  knowledge_base_ids?: string[];
  domain_id?: string | null;
  query_filter?: string;
}

/** The pickers that drive the filter bar (`GET /api/settings/prepare_audit_data`). */
export interface TarsAuditFilterOptions {
  users: { id: string; username: string }[];
  domains: { id: string; name: string }[];
  knowledge_bases: { id: string; name: string }[];
}

interface TarsAuditEnvelope<T> {
  success?: boolean;
  data?: T;
}

interface RawReport {
  total_count?: number;
  data?: TarsAuditMessage[];
  feedback_data?: TarsAuditFeedback[];
  chart_data?: {
    summary?: TarsAuditSummary;
    /** `conversations` nests every message again; present but never read. */
    details?: TarsAuditDomainStat[];
  };
}

/** pwc_tars sends numeric ids and, for a few rows, no id at all. */
interface RawOption {
  id?: string | number | null;
  name?: string | null;
  username?: string | null;
}

interface RawFilterOptions {
  users?: RawOption[];
  domains?: RawOption[];
  knowledge_bases?: RawOption[];
}

/**
 * A whole audit query can scan weeks of messages, so it gets far longer than the
 * shared default before the request is abandoned.
 */
const REPORT_TIMEOUT_MS = 120000;

/**
 * pwc_tars ids are numeric here but every picker compares them as strings.
 *
 * The name columns are nullable strings, so an unset one can arrive as `''`
 * rather than `null`; falling back only on nullish would leave a blank entry
 * sorting to the top of the picker.
 */
const toOptions = (rows: RawOption[] | undefined): { id: string; label: string }[] =>
  (rows ?? [])
    .filter((row) => row?.id != null)
    .map((row) => {
      const label = [row.name, row.username, String(row.id)].find(
        (candidate) => candidate != null && candidate.trim() !== '',
      );
      return { id: String(row.id), label: label ?? '' };
    });

/**
 * The users, specialized brains and knowledge bases the filter bar offers.
 * pwc_tars returns every user regardless of status but only enabled brains and
 * knowledge bases, which matches auditing: a disabled account's past messages
 * still need to be findable.
 *
 * pwc_tars gates the route behind `@admin_required`, so it is called as the
 * acting admin.
 */
export async function fetchTarsAuditFilterOptions(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsAuditFilterOptions> {
  const response = await tarsFetch<TarsAuditEnvelope<RawFilterOptions>>(
    '/api/settings/prepare_audit_data',
    { baseUrl, asUser: tarsId },
  );
  const data = response?.data ?? {};
  return {
    users: toOptions(data.users).map(({ id, label }) => ({ id, username: label })),
    domains: toOptions(data.domains).map(({ id, label }) => ({ id, name: label })),
    knowledge_bases: toOptions(data.knowledge_bases).map(({ id, label }) => ({ id, name: label })),
  };
}

/**
 * Runs the audit query. `chart_data` is flattened to the two parts the UI shows
 * — the period summary and the per-brain rollup — and its `bar_chart`/`pie_chart`
 * arrays are dropped, since they only restate `details` in plotting order.
 *
 * `user_id` records who ran the query; it never narrows the result. pwc_tars
 * gates the route behind `@admin_required`, so it is called as that admin.
 */
export async function fetchTarsAuditReport(
  tarsId: string,
  query: TarsAuditQuery,
  baseUrl?: string,
): Promise<TarsAuditReport> {
  const response = await tarsFetch<TarsAuditEnvelope<RawReport>>(
    '/api/settings/query_message_reports',
    {
      method: 'POST',
      timeoutMs: REPORT_TIMEOUT_MS,
      baseUrl,
      asUser: tarsId,
      body: {
        user_id: tarsId,
        filter_user_ids: query.filter_user_ids ?? [],
        start_date: query.start_date,
        end_date: query.end_date,
        domain_id: query.domain_id ?? '',
        knowledge_base_ids: query.knowledge_base_ids ?? [],
        query_filter: query.query_filter ?? '',
      },
    },
  );

  const data = response?.data ?? {};
  const rows = data.data ?? [];
  return {
    total_count: data.total_count ?? rows.length,
    data: rows,
    feedback_data: data.feedback_data ?? [],
    summary: data.chart_data?.summary ?? null,
    /** `conversations` nests every message again; dropped so the payload stays sane. */
    details: (data.chart_data?.details ?? []).map((detail) => ({
      domain_name: detail.domain_name,
      conversation_count: detail.conversation_count,
      message_count: detail.message_count,
      knowledge_bases: detail.knowledge_bases ?? [],
    })),
  };
}

/**
 * One message's execution trace (`GET /api/settings/get_message_execution_trace/<id>`).
 * pwc_tars picks the batch that produced the stored answer and strips the system
 * prompt; a 404 means the message itself is gone.
 */
export async function fetchTarsMessageTrace(
  tarsId: string,
  messageId: string,
  baseUrl?: string,
): Promise<TTarsMessageTrace> {
  const response = await tarsFetch<TarsAuditEnvelope<unknown>>(
    `/api/settings/get_message_execution_trace/${encodeURIComponent(messageId)}`,
    { baseUrl, asUser: tarsId },
  );
  /** Held to its declared types here, once, so no reader re-checks pwc_tars's values. */
  const trace = normalizeTarsMessageTrace(response?.data);
  if (!trace) {
    throw new TarsRequestError(502, 'get_message_execution_trace', MALFORMED_TRACE);
  }
  return trace;
}

/**
 * A long-term-memory file referenced by a trace. Unlike the owner-only memory
 * download, pwc_tars serves this one to any admin, since auditing reads other
 * people's files.
 */
export async function downloadTarsAuditMemoryDocument(
  tarsId: string,
  documentId: string,
  baseUrl?: string,
): Promise<{ buffer: Buffer; contentType: string; disposition: string | null }> {
  const path = `/api/settings/download_memory_document_for_audit/${encodeURIComponent(documentId)}`;
  const response = await fetch(`${getTarsBaseUrl(baseUrl)}${path}`, {
    headers: bearerHeaders(path, tarsId),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new TarsRequestError(response.status, path, await readTarsErrorMessage(response));
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    disposition: response.headers.get('content-disposition'),
  };
}

/** Thrown by {@link fetchTarsMessageTrace} when pwc_tars answers 2xx without a message. */
const MALFORMED_TRACE = 'Malformed trace response';

/** A failed trace or file request, classified for the audit panel (see `TTarsAuditErrorCode`). */
export interface TarsAuditErrorReply extends TTarsAuditErrorBody {
  status: number;
}

const reply = (
  status: number,
  code: TTarsAuditErrorCode,
  error: string,
  detail?: string,
): TarsAuditErrorReply => ({ status, code, error, ...(detail && { detail }) });

/** A connection-level failure (refused, reset, DNS) that `fetch` reports as a TypeError. */
const isNetworkError = (error: unknown): boolean =>
  error instanceof TypeError && /fetch failed|network/i.test(error.message);

/**
 * Classifies a failed trace read or document download. pwc_tars's own 401 is
 * answered as a 502, never relayed: the browser would take a 401 for an expired
 * LibreChat session and refresh it, when the signed admin bearer was refused.
 */
export function tarsAuditErrorReply(
  error: unknown,
  notFound: Extract<TTarsAuditErrorCode, 'message_not_found' | 'document_not_found'>,
): TarsAuditErrorReply {
  if (error instanceof TarsRequestError) {
    const detail = error.serverMessage;
    /** pwc_tars (or a proxy in front of it) can answer 503 too; only our own refusal names the secret. */
    if (error.status === 503 && detail === TARS_SECRET_MISSING_MESSAGE) {
      return reply(503, 'secret_missing', TARS_SECRET_MISSING_MESSAGE);
    }
    if (error.status === 401) {
      return reply(
        502,
        'credentials_rejected',
        'The server rejected the signed admin request',
        detail,
      );
    }
    if (error.status === 403) {
      return reply(
        403,
        'not_tars_admin',
        'The server does not grant this account admin access',
        detail,
      );
    }
    if (error.status === 404) {
      return reply(404, notFound, 'Not found on the server', detail);
    }
    if (error.status === 502 && detail === MALFORMED_TRACE) {
      return reply(502, 'bad_response', 'The server answered in an unexpected shape', detail);
    }
    if (error.status >= 400 && error.status < 500) {
      return reply(error.status, 'request_rejected', 'The server rejected the request', detail);
    }
    return reply(502, 'tars_failed', `The server failed with status ${error.status}`, detail);
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return reply(504, 'tars_timeout', 'The server did not answer in time');
  }
  if (error instanceof SyntaxError) {
    return reply(502, 'bad_response', 'The server answered in an unexpected shape', error.message);
  }
  if (error instanceof Error && error.message === TARS_NOT_CONFIGURED_MESSAGE) {
    return reply(503, 'not_configured', TARS_NOT_CONFIGURED_MESSAGE);
  }
  if (isNetworkError(error)) {
    const cause = (error as { cause?: { code?: unknown } }).cause?.code;
    return reply(502, 'tars_unreachable', 'The server could not be reached', String(cause ?? ''));
  }
  return reply(500, 'internal', 'Unexpected error');
}

/** Sends a classified failure, unless the response already started streaming. */
export function sendTarsAuditError(
  res: Response,
  error: unknown,
  notFound: Parameters<typeof tarsAuditErrorReply>[1],
): void {
  if (res.headersSent) {
    return;
  }
  const { status, ...body } = tarsAuditErrorReply(error, notFound);
  res.status(status).json(body);
}

/** A LibreChat file a mirrored trace names, as its download reads it. */
export interface TarsAuditStoredFile extends StoredFileRef {
  file_id: string;
  filename: string;
  source?: string | null;
}

type TarsAuditDocumentRequest = Request<{ documentId: string }> & { user?: { tarsId?: string } };

type OpenDownloadStream = (
  req: TarsAuditDocumentRequest,
  filepath: string,
) => Promise<NodeJS.ReadableStream>;

export interface TarsAuditDocumentDeps<TFile extends TarsAuditStoredFile> {
  /** The LibreChat file with this `file_id`, whoever owns it, or null. */
  findFile: (fileId: string) => Promise<TFile | null>;
  /** The text of a file kept only as text (`source: 'text'`). */
  readText: (file: TFile) => Promise<string | null | undefined>;
  /** The stream opener of the storage a file source names; null when it cannot stream. */
  getDownloadStream: (source: string) => OpenDownloadStream | null | undefined;
}

const DOCUMENT_LOG_TAG = '[tars-audit] document';

/**
 * Downloads a file a traced message names. A mirrored LibreChat chat names its
 * attachments by LibreChat `file_id`, so those come from LibreChat's own
 * storage; any other id is a pwc_tars long-term-memory document. Like pwc_tars's
 * audit download it serves any user's file, which is why the route is admin-only.
 */
export function createTarsAuditDocumentHandler<TFile extends TarsAuditStoredFile>(
  deps: TarsAuditDocumentDeps<TFile>,
) {
  return async function sendTarsAuditDocument(
    req: TarsAuditDocumentRequest,
    res: Response,
  ): Promise<void> {
    const { documentId } = req.params;
    try {
      const file = await deps.findFile(documentId);
      if (file?.source === FileSources.text) {
        const text = await deps.readText(file);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', tarsAttachmentDisposition(file.filename));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(typeof text === 'string' ? text : '');
        return;
      }
      if (file) {
        const source =
          typeof file.source === 'string' && file.source ? file.source : FileSources.local;
        const openStream = deps.getDownloadStream(source);
        if (!openStream) {
          const { status, ...body } = reply(
            404,
            'document_unavailable',
            'This file cannot be downloaded from its storage',
            source,
          );
          res.status(status).json(body);
          return;
        }
        let stream: NodeJS.ReadableStream;
        try {
          stream = await openStream(req, resolveDownloadPath(file));
        } catch (error) {
          logger.error(`${DOCUMENT_LOG_TAG} Storage could not open the file`, error);
          const { status, ...body } = reply(
            500,
            'storage_failed',
            'The file storage could not be read',
            error instanceof Error ? error.message : undefined,
          );
          res.status(status).json(body);
          return;
        }
        sendTarsFileStream(res, stream, file.filename, DOCUMENT_LOG_TAG);
        return;
      }
      const document = await downloadTarsAuditMemoryDocument(req.user?.tarsId ?? '', documentId);
      /** pwc_tars's type is relayed but never sniffed, so its bytes cannot render as a page here. */
      res.setHeader('Content-Type', document.contentType);
      if (document.disposition) {
        /** Node refuses a header with characters it cannot send; the file still downloads, by its id. */
        try {
          res.setHeader('Content-Disposition', document.disposition);
        } catch {
          res.setHeader('Content-Disposition', tarsAttachmentDisposition(documentId));
        }
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(document.buffer);
    } catch (error) {
      logger.error(`${DOCUMENT_LOG_TAG} Download failed`, error);
      sendTarsAuditError(res, error, 'document_not_found');
    }
  };
}
