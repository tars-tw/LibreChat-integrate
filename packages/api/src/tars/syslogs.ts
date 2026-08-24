import { tarsFetch, TarsRequestError } from './client';

/** The action verbs pwc_tars records (`ActionType`). Order drives the summary row. */
export const TARS_ACTION_TYPES = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'READ',
  'EXPORT',
  'DOWNLOAD',
  'LOGIN',
  'LOGOUT',
  'OTHER',
] as const;

export type TarsActionType = (typeof TARS_ACTION_TYPES)[number];

/**
 * A value from one of pwc_tars' `db.JSON` columns, handed back already parsed.
 * Rows written before the column became JSON still hold a raw string.
 */
export type TarsJsonField =
  | string
  | number
  | boolean
  | null
  | TarsJsonField[]
  | { [key: string]: TarsJsonField };

/** One recorded operation (`SysActionLog.to_dict()`). */
export interface TarsActionLog {
  id: string;
  sys_domain_id: string | null;
  user_id: string | null;
  username: string | null;
  user_email: string | null;
  role_id: string | null;
  action_type: string | null;
  module: string | null;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  description: string | null;
  page_url: string | null;
  menu_id: string | null;
  http_method: string | null;
  api_endpoint: string | null;
  before_data: TarsJsonField;
  after_data: TarsJsonField;
  extra: TarsJsonField;
  status: string | null;
  error_message: string | null;
  ip_address: string | null;
  user_agent: string | null;
  trace_id: string | null;
  created_at: string | null;
}

/**
 * Counts per action verb for the whole filtered set, not just the page —
 * pwc_tars recomputes them against the same filters on every request.
 */
export interface TarsActionLogSummary {
  total: number;
  create: number;
  update: number;
  delete: number;
  read: number;
  export: number;
  download: number;
  login: number;
  logout: number;
  other: number;
}

/** One page of logs. Unlike the message report, pwc_tars pages this server-side. */
export interface TarsActionLogPage {
  logs: TarsActionLog[];
  total: number;
  page: number;
  page_size: number;
  summary: TarsActionLogSummary;
}

/** A module the logs can be filtered by, resolved from `sys_menu`. */
export interface TarsActionLogModule {
  value: string;
  title: string;
  lang_key: string | null;
}

export interface TarsActionLogFilterOptions {
  users: { user_id: string; username: string | null; user_email: string | null }[];
  action_types: string[];
  modules: TarsActionLogModule[];
}

export interface TarsActionLogQuery {
  start_date?: string;
  end_date?: string;
  user_ids?: string[];
  action_types?: string[];
  modules?: string[];
  keyword?: string;
  page?: number;
  page_size?: number;
}

const EMPTY_SUMMARY: TarsActionLogSummary = {
  total: 0,
  create: 0,
  update: 0,
  delete: 0,
  read: 0,
  export: 0,
  download: 0,
  login: 0,
  logout: 0,
  other: 0,
};

/**
 * pwc_tars parses `YYYY-MM-DD HH:MM:SS`, falling back to a bare `YYYY-MM-DD`
 * that it widens to the whole day. `<input type="datetime-local">` produces
 * `YYYY-MM-DDTHH:MM`, so the separator is swapped and the seconds filled in.
 */
export const toTarsDateTime = (value: string | undefined): string | undefined => {
  if (value == null || value.trim() === '') {
    return undefined;
  }
  const normalized = value.trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
};

/** Empty arrays must not reach the query string: pwc_tars reads `''` as "no filter". */
const toCsv = (values: string[] | undefined): string | undefined =>
  values != null && values.length > 0 ? values.join(',') : undefined;

/**
 * A page of the system operation audit trail
 * (`GET /api/system_action_log/audit_logs`).
 */
export async function fetchTarsActionLogs(
  query: TarsActionLogQuery,
  baseUrl?: string,
): Promise<TarsActionLogPage> {
  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 20;
  const data = await tarsFetch<Partial<TarsActionLogPage>>('/api/system_action_log/audit_logs', {
    baseUrl,
    query: {
      start_date: toTarsDateTime(query.start_date),
      end_date: toTarsDateTime(query.end_date),
      user_ids: toCsv(query.user_ids),
      action_types: toCsv(query.action_types),
      modules: toCsv(query.modules),
      keyword: query.keyword != null && query.keyword !== '' ? query.keyword : undefined,
      page,
      page_size: pageSize,
    },
  });

  return {
    logs: data?.logs ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? page,
    page_size: data?.page_size ?? pageSize,
    summary: { ...EMPTY_SUMMARY, ...data?.summary },
  };
}

/**
 * The pickers for the filter bar. The users are those that actually appear in
 * the trail, so a selection can never come back empty by construction.
 */
export async function fetchTarsActionLogFilterOptions(
  baseUrl?: string,
): Promise<TarsActionLogFilterOptions> {
  const data = await tarsFetch<Partial<TarsActionLogFilterOptions>>(
    '/api/system_action_log/audit_logs/filter_options',
    { baseUrl },
  );
  return {
    users: (data?.users ?? []).filter((user) => user?.user_id != null),
    action_types: data?.action_types ?? [],
    modules: data?.modules ?? [],
  };
}

/** The fields `POST /api/system_action_log/record` accepts from a caller. */
export interface TarsActionLogEntry {
  action_type: TarsActionType;
  module: string;
  target_type?: string;
  target_name?: string;
  description?: string;
  page_url?: string;
}

/**
 * Writes one audit row for an action LibreChat performed itself
 * (`POST /api/system_action_log/record`).
 *
 * Only for work that never reaches pwc_tars — a client-side export, say. Every
 * proxied mutation is already recorded by the pwc_tars route that ran it, so
 * calling this alongside one would double-count the operation.
 *
 * pwc_tars stamps the row's IP and user agent from this request, so they name
 * the LibreChat server rather than the operator's browser.
 */
export async function recordTarsActionLog(
  tarsId: string,
  entry: TarsActionLogEntry,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/system_action_log/record', {
    method: 'POST',
    body: { ...entry, user_id: tarsId },
    baseUrl,
  });
}

/**
 * One recorded operation in full (`GET /api/system_action_log/audit_logs/<id>`).
 *
 * The list endpoint already returns every column, but pwc_tars is free to widen
 * a row after the fact (`before_data` / `after_data` / `extra` are written by
 * the module that acted), so the detail view reads the row back by id.
 * A row that has since been purged answers 404, which surfaces as null.
 */
export async function fetchTarsActionLogDetail(
  logId: string,
  baseUrl?: string,
): Promise<TarsActionLog | null> {
  try {
    const data = await tarsFetch<{ log?: TarsActionLog }>(
      `/api/system_action_log/audit_logs/${encodeURIComponent(logId)}`,
      { baseUrl },
    );
    return data?.log ?? null;
  } catch (error) {
    if (error instanceof TarsRequestError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Every action one user took in the window, newest first and unpaged — the
 * timeline shows the whole sequence rather than a slice of it.
 */
export async function fetchTarsUserActionLogs(
  userId: string,
  query: { start_date?: string; end_date?: string },
  baseUrl?: string,
): Promise<TarsActionLog[]> {
  const data = await tarsFetch<{ logs?: TarsActionLog[] }>(
    `/api/system_action_log/audit_logs/user/${encodeURIComponent(userId)}`,
    {
      baseUrl,
      query: {
        start_date: toTarsDateTime(query.start_date),
        end_date: toTarsDateTime(query.end_date),
      },
    },
  );
  return data?.logs ?? [];
}
