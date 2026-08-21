import { tarsFetch } from './client';

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
 */
export async function fetchTarsAuditFilterOptions(
  baseUrl?: string,
): Promise<TarsAuditFilterOptions> {
  const response = await tarsFetch<TarsAuditEnvelope<RawFilterOptions>>(
    '/api/settings/prepare_audit_data',
    { baseUrl },
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
 * `user_id` records who ran the query; it never narrows the result.
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
