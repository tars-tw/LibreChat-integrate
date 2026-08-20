import type { TTarsTokenConfig, TTarsTokenUserQuota } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/** The providers pwc_tars meters separately; `system` is its catch-all bucket. */
export const TOKEN_PROVIDERS = ['openai', 'gemini', 'anthropic'] as const;

export type TokenResetType = 'never' | 'daily' | 'monthly' | 'yearly';

export const RESET_TYPES: TokenResetType[] = ['never', 'daily', 'monthly', 'yearly'];

export const RESET_LABEL_KEYS: Record<TokenResetType, TranslationKeys> = {
  never: 'com_ui_tars_quota_reset_never',
  daily: 'com_ui_tars_quota_reset_daily',
  monthly: 'com_ui_tars_quota_reset_monthly',
  yearly: 'com_ui_tars_quota_reset_yearly',
};

/** Only monthly and yearly resets have a day to land on. */
export const usesResetDay = (resetType: string | null): boolean =>
  resetType === 'monthly' || resetType === 'yearly';

export const isActiveQuota = (quota: TTarsTokenUserQuota): boolean => quota.status === 'active';

export const BADGE_NEUTRAL =
  'rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary';
export const BADGE_ON =
  'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300';

/** A null limit is pwc_tars' "no ceiling", which must never render as 0. */
export const formatLimit = (value: number | null | undefined, unlimited: string): string =>
  value == null ? unlimited : value.toLocaleString();

export const formatThreshold = (value: number | null | undefined): string =>
  value == null ? '—' : `${Math.round(value * 100)}%`;

/** How much of a personal quota is spent, capped so an overrun still renders. */
export const quotaUsageShare = (quota: TTarsTokenUserQuota): number => {
  const limit = quota.custom_limit;
  if (limit == null || limit <= 0) {
    return 0;
  }
  return Math.min(Math.round(((quota.used_amount ?? 0) / limit) * 100), 100);
};

/**
 * Rules grouped by user group, the way an administrator reads them: one group's
 * brains sit together, and the group with the most rules leads.
 */
export const groupConfigsByGroup = (
  configs: TTarsTokenConfig[],
): { groupName: string; groupId: string; rows: TTarsTokenConfig[] }[] => {
  const groups = new Map<string, TTarsTokenConfig[]>();
  for (const config of configs) {
    const name = config.group_name ?? '—';
    const rows = groups.get(name);
    if (rows == null) {
      groups.set(name, [config]);
      continue;
    }
    rows.push(config);
  }
  return [...groups.entries()]
    .map(([groupName, rows]) => ({
      groupName,
      groupId: String(rows[0].user_group_id ?? ''),
      rows,
    }))
    .sort((a, b) => b.rows.length - a.rows.length);
};

/** The brains a group's roles grant, as a lookup the forms narrow their picker by. */
export const allowedDomainSet = (allowedDomains: string[] | undefined): Set<string> =>
  new Set(allowedDomains ?? []);
