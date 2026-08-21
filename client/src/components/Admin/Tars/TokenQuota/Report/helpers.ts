import type {
  TTarsTokenConfig,
  TTarsTokenUserQuota,
  TTarsTokenDailyUsage,
  TTarsTokenGroupUsage,
} from 'librechat-data-provider';
import { capOf, isActiveQuota } from '../helpers';

/** The report opens on the last month, the range the pwc_tars page defaulted to. */
export const defaultReportRange = (): { start: string; end: string } => {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setMonth(today.getMonth() - 1);
  return { start: toDateInput(monthAgo), end: toDateInput(today) };
};

/**
 * The trailing 30 days, used by the quota tabs to show recent consumption next
 * to the ceilings they set. Callers must memoize it — a fresh object each render
 * would re-key the query.
 */
export const recentReportRange = (): { start_date: string; end_date: string } => {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(today.getDate() - 30);
  return { start_date: toDateInput(monthAgo), end_date: toDateInput(today) };
};

export const toDateInput = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

export const formatTokens = (value: number | null | undefined): string =>
  (value ?? 0).toLocaleString();

export const percentOf = (value: number, total: number): number =>
  total === 0 ? 0 : Math.round((value / total) * 100);

/** `2026-08-14` → `8/14`, the compact form the trend axis needs. */
export const shortDate = (date: string): string => {
  const parts = date.split('-');
  return parts.length >= 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
};

/** Recent usage keyed by id, for the quota tables' consumption column. */
export const usageByKey = <T>(
  rows: T[],
  keyOf: (row: T) => string,
  valueOf: (row: T) => number,
): Map<string, number> => {
  const usage = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === '') {
      continue;
    }
    usage.set(key, (usage.get(key) ?? 0) + valueOf(row));
  }
  return usage;
};

/** A comma-joined id column, as several pwc_tars tables store them. */
const splitIds = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');

/**
 * A quota ceiling rolled up from the rules that apply to one group or person.
 * `limit` is null for "no ceiling": pwc_tars stores an unlimited rule as a null
 * column, so one unlimited rule makes the whole roll-up unlimited rather than
 * contributing zero.
 */
export interface QuotaCeiling {
  limit: number | null;
  ruleCount: number;
  warningThreshold: number | null;
}

const addToCeiling = (
  ceilings: Map<string, QuotaCeiling>,
  key: string,
  rawLimit: number | null,
  warningThreshold: number | null,
): void => {
  const limit = capOf(rawLimit);
  const current = ceilings.get(key);
  if (current == null) {
    ceilings.set(key, { limit, ruleCount: 1, warningThreshold });
    return;
  }
  ceilings.set(key, {
    limit: current.limit == null || limit == null ? null : current.limit + limit,
    ruleCount: current.ruleCount + 1,
    warningThreshold: current.warningThreshold ?? warningThreshold,
  });
};

/**
 * Group id → ceiling, summed across that group's active rules.
 *
 * A rule is per brain × group × provider while the report totals a group across
 * every brain and provider, so the comparable ceiling is their sum. Inactive
 * rules are skipped — pwc_tars does not enforce them.
 */
export const groupCeilings = (configs: TTarsTokenConfig[]): Map<string, QuotaCeiling> => {
  const ceilings = new Map<string, QuotaCeiling>();
  for (const config of configs) {
    if (!config.is_active) {
      continue;
    }
    for (const groupId of splitIds(config.user_group_id)) {
      addToCeiling(ceilings, groupId, config.system_total_limit, config.warning_threshold);
    }
  }
  return ceilings;
};

/** User id → ceiling, summed across that person's active overrides. */
export const userCeilings = (quotas: TTarsTokenUserQuota[]): Map<string, QuotaCeiling> => {
  const ceilings = new Map<string, QuotaCeiling>();
  for (const quota of quotas) {
    if (!isActiveQuota(quota) || quota.user_id == null) {
      continue;
    }
    addToCeiling(ceilings, String(quota.user_id), quota.custom_limit, null);
  }
  return ceilings;
};

/** What share of a ceiling the period's usage took, or null when uncapped. */
export const ceilingShare = (used: number, ceiling: QuotaCeiling | undefined): number | null => {
  if (ceiling?.limit == null || ceiling.limit <= 0) {
    return null;
  }
  return Math.round((used / ceiling.limit) * 100);
};

/** Past the rule's own warning threshold, defaulting to the pwc_tars 80%. */
export const isOverWarning = (share: number | null, ceiling: QuotaCeiling | undefined): boolean => {
  if (share == null) {
    return false;
  }
  return share >= Math.round((ceiling?.warningThreshold ?? 0.8) * 100);
};

/**
 * The whole period as one series. pwc_tars pre-fills every date per group, so
 * summing the groups keeps the empty days that make a quiet week visible.
 */
export const totalDailyUsage = (groups: TTarsTokenGroupUsage[]): TTarsTokenDailyUsage[] => {
  const days = new Map<string, TTarsTokenDailyUsage>();
  for (const group of groups) {
    for (const day of group.daily_usage ?? []) {
      const current = days.get(day.date);
      if (current == null) {
        days.set(day.date, { ...day });
        continue;
      }
      current.log_count += day.log_count;
      current.total_tokens += day.total_tokens;
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
};

export interface ReportTotals {
  tokens: number;
  logs: number;
  users: number;
}

/** Headline totals. `users` counts the accounts the groups cover, not the logs. */
export const reportTotals = (groups: TTarsTokenGroupUsage[]): ReportTotals =>
  groups.reduce<ReportTotals>(
    (totals, group) => ({
      tokens: totals.tokens + group.total_tokens,
      logs: totals.logs + group.log_count,
      users: totals.users + group.user_count,
    }),
    { tokens: 0, logs: 0, users: 0 },
  );
