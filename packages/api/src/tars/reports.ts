import { tarsFetch } from './client';

/** One day of a series; pwc_tars pre-fills every date in the range, gaps included. */
export interface TarsTokenDailyUsage {
  date: string;
  log_count: number;
  total_tokens: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** A user group's usage for the period (`cal_group_overview`). */
export interface TarsTokenGroupUsage {
  user_group_id: string | number | null;
  user_group_name: string | null;
  user_count: number;
  log_count: number;
  total_tokens: number;
  daily_usage: TarsTokenDailyUsage[];
}

export interface TarsTokenDomainUsage {
  domain_id: string | null;
  domain_name: string | null;
  total_tokens: number;
}

/** `usage_rate` is already a percentage of the period's model tokens. */
export interface TarsTokenModelUsage {
  model_name: string;
  total_tokens: number;
  usage_rate: number;
}

export interface TarsTokenReportOverview {
  group_overview: TarsTokenGroupUsage[];
  domain_usage: TarsTokenDomainUsage[];
  model_usage: TarsTokenModelUsage[];
  date_range: { start_date: string; end_date: string };
}

/** One member's usage inside the selected groups (`cal_user_group_all_users_usage`). */
export interface TarsTokenUserUsage {
  user_id: string | number | null;
  username: string | null;
  display_name: string | null;
  user_group_ids: string[];
  log_count: number;
  total_tokens: number;
}

/** One person's period totals plus the day-by-day series behind them. */
export interface TarsTokenUserUsageDetail {
  user_id: string;
  log_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  daily_usage: TarsTokenDailyUsage[];
}

/** A row of the raw `token_usage_log` dump, used only by the export. */
export interface TarsTokenUsageLogRow {
  id: string;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  domain_id: string | null;
  user_group_id: string | null;
  user_group_name: string | null;
  provider: string | null;
  model_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  ref_type: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string | null;
}

/** Every account's period totals, group-agnostic (`cal_all_user_usage`). */
export interface TarsTokenAccountUsage {
  user_id: string | number | null;
  username: string | null;
  display_name: string | null;
  log_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface TarsTokenReportExport {
  group_usage: TarsTokenGroupUsage[];
  usage_summary: TarsTokenAccountUsage[];
  user_usage_log: TarsTokenUsageLogRow[];
  date_range: { start_date: string; end_date: string };
}

/** Dates are `YYYY-MM-DD`; pwc_tars reads them as whole days in Asia/Taipei. */
export interface TarsTokenReportRange {
  start_date: string;
  end_date: string;
}

interface TarsReportEnvelope<T> {
  success?: boolean;
  status?: string;
  data: T;
}

const REPORTS_BASE = '/api/reports';

/**
 * These scan `token_usage_log` for the whole range and, for the export, dump
 * every row — well past the shared 15s default on a busy month.
 */
const REPORT_TIMEOUT_MS = 60_000;

async function postReport<T>(path: string, body: unknown, baseUrl?: string): Promise<T> {
  const response = await tarsFetch<TarsReportEnvelope<T>>(`${REPORTS_BASE}${path}`, {
    method: 'POST',
    body,
    timeoutMs: REPORT_TIMEOUT_MS,
    baseUrl,
  });
  return response.data;
}

/** Group totals, plus the specialized-brain and model splits for the period. */
export async function fetchTarsTokenReportOverview(
  range: TarsTokenReportRange,
  baseUrl?: string,
): Promise<TarsTokenReportOverview> {
  const data = await postReport<TarsTokenReportOverview>(
    '/get_group_token_overview',
    range,
    baseUrl,
  );
  return {
    group_overview: data?.group_overview ?? [],
    domain_usage: data?.domain_usage ?? [],
    model_usage: data?.model_usage ?? [],
    date_range: data?.date_range ?? range,
  };
}

/**
 * Member totals for the given groups. pwc_tars also returns every underlying
 * usage-log id per member; that is dropped here — nothing renders it, and on a
 * busy month it is by far the largest part of the payload.
 */
export async function fetchTarsTokenReportMembers(
  range: TarsTokenReportRange,
  userGroupIds: string[],
  baseUrl?: string,
): Promise<TarsTokenUserUsage[]> {
  const data = await postReport<{ user_usage?: TarsTokenUserUsage[] }>(
    '/get_group_users_token_overview',
    { ...range, user_group_ids: userGroupIds },
    baseUrl,
  );
  return (data?.user_usage ?? []).map((user) => ({
    user_id: user.user_id,
    username: user.username,
    display_name: user.display_name,
    user_group_ids: user.user_group_ids ?? [],
    log_count: user.log_count,
    total_tokens: user.total_tokens,
  }));
}

/** One person's period totals and daily series. */
export async function fetchTarsTokenReportUser(
  range: TarsTokenReportRange,
  userId: string,
  baseUrl?: string,
): Promise<TarsTokenUserUsageDetail | null> {
  const data = await postReport<{ usage_summary?: TarsTokenUserUsageDetail }>(
    '/get_user_token_usage_detail',
    { ...range, user_id: userId },
    baseUrl,
  );
  return data?.usage_summary ?? null;
}

/** The three datasets behind the export: groups, every account, and raw logs. */
export async function fetchTarsTokenReportExport(
  range: TarsTokenReportRange,
  baseUrl?: string,
): Promise<TarsTokenReportExport> {
  const data = await postReport<TarsTokenReportExport>(
    '/export_token_usage_detail',
    range,
    baseUrl,
  );
  return {
    group_usage: data?.group_usage ?? [],
    usage_summary: data?.usage_summary ?? [],
    user_usage_log: data?.user_usage_log ?? [],
    date_range: data?.date_range ?? range,
  };
}
