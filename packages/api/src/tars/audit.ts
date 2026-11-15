import { Readable } from 'stream';
import { logger } from '@librechat/data-schemas';
import {
  FileSources,
  stripAgentIdSuffix,
  isEphemeralAgentId,
  TARS_AUDIT_NO_AGENT,
  normalizeTarsMessageTrace,
} from 'librechat-data-provider';
import type {
  TTarsAuditQuery,
  TTarsAuditReport,
  TTarsAuditMessage,
  TTarsMessageTrace,
  TTarsAuditSummary,
  TTarsAuditFeedback,
  TTarsAuditAgentStat,
  TTarsAuditErrorBody,
  TTarsAuditErrorCode,
  TTarsAuditOptionsResponse,
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
import { pipeTarsDownload, sendTarsFileStream, tarsAttachmentDisposition } from './files/route';
import { resolveDownloadPath } from '~/storage/path';
import { TARS_MIRROR_SOURCE } from './trace';

/**
 * A message audit row as pwc_tars sends it (`POST /api/settings/query_message_reports`
 * → `data[]`). pwc_tars joins `message`, `conversation`, `sys_user` and the
 * long-term memory tables, folds in the period's feedback, and reads `agent_id`
 * off the mirrored trace; the agent's name lives only in LibreChat.
 */
type RawAuditMessage = Omit<
  TTarsAuditMessage,
  'agent_id' | 'agent_name' | 'conversation_is_deleted'
> & {
  agent_id?: string | null;
  /** Sent by a pwc_tars without the agent column; the conversation flag then falls back to it. */
  conversation_is_deleted?: boolean | null;
  domain_name?: string | null;
};

/** Filters the operator submits. Dates are `YYYY-MM-DD` in Asia/Taipei. */
export type TarsAuditQuery = TTarsAuditQuery;

/** A saved agent as the audit report names it. */
export interface TarsAuditAgentRef {
  id: string;
  name?: string | null;
}

/** Where the report looks agents up; LibreChat's agent store, supplied by the route. */
export interface TarsAuditAgentDirectory {
  /** The agents with these logical ids, or every agent when `ids` is omitted. */
  findAgents: (ids?: string[]) => Promise<TarsAuditAgentRef[]>;
}

interface TarsAuditEnvelope<T> {
  success?: boolean;
  data?: T;
}

interface RawReport {
  total_count?: number;
  data?: RawAuditMessage[];
  feedback_data?: TTarsAuditFeedback[];
}

/** pwc_tars sends numeric ids and, for a few rows, no id at all. */
interface RawOption {
  id?: string | number | null;
  name?: string | null;
  username?: string | null;
}

interface RawFilterOptions {
  users?: RawOption[];
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

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/**
 * The users, agents and knowledge bases the filter bar offers. pwc_tars returns
 * every user regardless of status but only enabled knowledge bases, which
 * matches auditing: a disabled account's past messages still need to be
 * findable. Agents come from LibreChat, read alongside.
 *
 * pwc_tars gates the route behind `@admin_required`, so it is called as the
 * acting admin.
 */
export async function fetchTarsAuditFilterOptions(
  tarsId: string,
  directory: TarsAuditAgentDirectory,
  baseUrl?: string,
): Promise<TTarsAuditOptionsResponse> {
  const [response, agents] = await Promise.all([
    tarsFetch<TarsAuditEnvelope<RawFilterOptions>>('/api/settings/prepare_audit_data', {
      baseUrl,
      asUser: tarsId,
    }),
    directory.findAgents(),
  ]);
  const data = response?.data ?? {};
  return {
    users: toOptions(data.users).map(({ id, label }) => ({ id, username: label })),
    agents: agents
      .filter((agent) => typeof agent.id === 'string' && agent.id !== '')
      .map((agent) => ({ id: agent.id, name: agent.name?.trim() || agent.id }))
      .sort(byName),
    knowledge_bases: toOptions(data.knowledge_bases).map(({ id, label }) => ({ id, name: label })),
  };
}

/** The saved agent a trace names; ephemeral ids and blanks mean none. */
const savedAgentId = (agentId: string | null | undefined): string | null => {
  if (typeof agentId !== 'string' || isEphemeralAgentId(agentId)) {
    return null;
  }
  return stripAgentIdSuffix(agentId);
};

const toAuditMessage = (
  { domain_name: _domain, ...row }: RawAuditMessage,
  names: Map<string, string>,
): TTarsAuditMessage => {
  const agentId = savedAgentId(row.agent_id);
  return {
    ...row,
    agent_id: agentId,
    agent_name: agentId == null ? null : (names.get(agentId) ?? null),
    conversation_is_deleted: row.conversation_is_deleted ?? row.is_deleted === true,
  };
};

/** Keeps the rows whose agent was picked; `TARS_AUDIT_NO_AGENT` stands for none. */
const filterByAgents = (rows: TTarsAuditMessage[], agentIds: string[]): TTarsAuditMessage[] => {
  if (agentIds.length === 0) {
    return rows;
  }
  const picked = new Set(agentIds);
  return rows.filter((row) => picked.has(row.agent_id ?? TARS_AUDIT_NO_AGENT));
};

/**
 * The period totals and the per-agent rollup, in one pass over the rows the
 * report returns, so the statistics always describe exactly what the tables
 * list. The busiest agent leads.
 */
export function summarizeTarsAudit(
  rows: TTarsAuditMessage[],
  query: Pick<TTarsAuditQuery, 'start_date' | 'end_date'>,
): { summary: TTarsAuditSummary; details: TTarsAuditAgentStat[] } {
  const conversations = new Set<string>();
  const agents = new Map<string, TTarsAuditAgentStat & { conversations: Set<string> }>();
  for (const row of rows) {
    const conversationId = row.conversation_id ?? row.message_id;
    conversations.add(conversationId);
    const key = row.agent_id ?? TARS_AUDIT_NO_AGENT;
    const stat = agents.get(key) ?? {
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      conversation_count: 0,
      message_count: 0,
      conversations: new Set<string>(),
    };
    stat.message_count += 1;
    stat.conversations.add(conversationId);
    agents.set(key, stat);
  }
  const details = [...agents.values()]
    .map(({ conversations: seen, ...stat }) => ({ ...stat, conversation_count: seen.size }))
    .sort((a, b) => b.message_count - a.message_count);
  return {
    summary: {
      total_agents: details.filter((detail) => detail.agent_id != null).length,
      total_conversations: conversations.size,
      total_messages: rows.length,
      date_range: { start_date: query.start_date, end_date: query.end_date },
    },
    details,
  };
}

/**
 * Runs the audit query, names each row's agent and applies the agent filter,
 * which pwc_tars cannot: it holds agent ids but not agents. The statistics are
 * then rebuilt from the filtered rows, so pwc_tars's own `chart_data` (grouped
 * by specialized brain) is not read.
 *
 * Only the conversations LibreChat mirrored are audited here; pwc_tars's own
 * chats belong to pwc_tars's report, so `source` asks for the mirror's rows.
 *
 * `user_id` records who ran the query; it never narrows the result. pwc_tars
 * gates the route behind `@admin_required`, so it is called as that admin.
 */
export async function fetchTarsAuditReport(
  tarsId: string,
  query: TarsAuditQuery,
  directory: TarsAuditAgentDirectory,
  baseUrl?: string,
): Promise<TTarsAuditReport> {
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
        knowledge_base_ids: query.knowledge_base_ids ?? [],
        query_filter: query.query_filter ?? '',
        source: TARS_MIRROR_SOURCE,
      },
    },
  );

  const rawRows = response?.data?.data ?? [];
  const agentIds = [
    ...new Set(
      rawRows.map((row) => savedAgentId(row.agent_id)).filter((id): id is string => id != null),
    ),
  ];
  const agents = agentIds.length > 0 ? await directory.findAgents(agentIds) : [];
  /** An agent that exists but was never named reads by its id, as the picker lists it. */
  const names = new Map(agents.map((agent) => [agent.id, agent.name?.trim() || agent.id]));
  const rows = filterByAgents(
    rawRows.map((row) => toAuditMessage(row, names)),
    query.agent_ids ?? [],
  );
  const kept = new Set(rows.map((row) => row.message_id));
  const { summary, details } = summarizeTarsAudit(rows, query);
  return {
    total_count: rows.length,
    data: rows,
    feedback_data: (response?.data?.feedback_data ?? []).filter((entry) =>
      kept.has(entry.message_id),
    ),
    summary,
    details,
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
): Promise<{ stream: Readable; contentType: string; disposition: string | null }> {
  const path = `/api/settings/download_memory_document_for_audit/${encodeURIComponent(documentId)}`;
  const response = await fetch(`${getTarsBaseUrl(baseUrl)}${path}`, {
    headers: bearerHeaders(path, tarsId),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new TarsRequestError(response.status, path, await readTarsErrorMessage(response));
  }
  return {
    stream: response.body
      ? Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0])
      : Readable.from([]),
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

/**
 * Whether the trace names this document: a LibreChat attachment by `file_id`
 * (thread files and the turn's own uploads) or a pwc_tars memory document by `id`.
 */
export function tarsTraceNamesDocument(trace: TTarsMessageTrace, documentId: string): boolean {
  return trace.trace.some(({ payload }) =>
    [...(payload?.documents ?? []), ...(payload?.payload?.upload_files ?? [])].some(
      (document) =>
        document?.file_id === documentId ||
        ('id' in document && document.id != null && String(document.id) === documentId),
    ),
  );
}

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
  /** The audited message's trace, read as the acting admin (defaults to pwc_tars). */
  loadTrace?: (tarsId: string, messageId: string) => Promise<TTarsMessageTrace>;
}

const DOCUMENT_LOG_TAG = '[tars-audit] document';

/**
 * Downloads a file a traced message names. A mirrored LibreChat chat names its
 * attachments by LibreChat `file_id`, so those come from LibreChat's own
 * storage; any other id is a pwc_tars long-term-memory document. It serves any
 * user's file, so the request names the audited message: reading its trace
 * re-checks admin access in pwc_tars, and only a file that trace names is sent.
 */
export function createTarsAuditDocumentHandler<TFile extends TarsAuditStoredFile>(
  deps: TarsAuditDocumentDeps<TFile>,
) {
  return async function sendTarsAuditDocument(
    req: TarsAuditDocumentRequest,
    res: Response,
  ): Promise<void> {
    const { documentId } = req.params;
    const messageId = typeof req.query?.messageId === 'string' ? req.query.messageId : '';
    const tarsId = req.user?.tarsId ?? '';
    if (!messageId) {
      const { status, ...body } = reply(400, 'request_rejected', 'messageId is required');
      res.status(status).json(body);
      return;
    }
    try {
      const trace = await (deps.loadTrace ?? fetchTarsMessageTrace)(tarsId, messageId);
      if (!tarsTraceNamesDocument(trace, documentId)) {
        const { status, ...body } = reply(404, 'document_not_found', 'Not found on the server');
        res.status(status).json(body);
        return;
      }
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
      const document = await downloadTarsAuditMemoryDocument(tarsId, documentId);
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
      pipeTarsDownload(res, document.stream, DOCUMENT_LOG_TAG);
    } catch (error) {
      logger.error(`${DOCUMENT_LOG_TAG} Download failed`, error);
      sendTarsAuditError(res, error, 'document_not_found');
    }
  };
}
