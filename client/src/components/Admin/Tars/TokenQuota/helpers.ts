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

/**
 * pwc_tars stores a personal quota's status as the *string* `'true'` / `'false'`,
 * and its enforcement (`services/token_quota.py`, `status == "true"`) honours no
 * other value — an override saved as `'active'` is silently never applied.
 */
export const QUOTA_STATUS_ON = 'true';
export const QUOTA_STATUS_OFF = 'false';

export const isActiveQuota = (quota: Pick<TTarsTokenUserQuota, 'status'>): boolean =>
  String(quota.status).toLowerCase() === QUOTA_STATUS_ON;

export const BADGE_NEUTRAL =
  'rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary';
export const BADGE_ON =
  'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300';

/**
 * pwc_tars spells "no ceiling" as `-1`, not as null — `_build_quota_result`
 * short-circuits on `limit == -1`, while a null limit means the rule is *unset*
 * and enforcement falls through to the next level (or skips a personal override
 * entirely, via `custom_limit.isnot(None)`). The two must never be conflated.
 */
export const UNLIMITED = -1;

export const isUnlimited = (value: number | null | undefined): boolean => value === UNLIMITED;

/** The enforceable ceiling, or null when there is none to compare usage against. */
export const capOf = (value: number | null | undefined): number | null =>
  value == null || value <= 0 ? null : value;

export const formatLimit = (
  value: number | null | undefined,
  unlimited: string,
  unset = '—',
): string => {
  if (isUnlimited(value)) {
    return unlimited;
  }
  return value == null ? unset : value.toLocaleString();
};

export const formatThreshold = (value: number | null | undefined): string =>
  value == null ? '—' : `${Math.round(value * 100)}%`;

/** How much of a personal quota is spent, capped so an overrun still renders. */
export const quotaUsageShare = (quota: TTarsTokenUserQuota): number => {
  const limit = capOf(quota.custom_limit);
  if (limit == null) {
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

/**
 * pwc_tars often leaves `display_name` unset, or sets it equal to `username`.
 * Rendering both fields naively then repeats the same string on two lines, which
 * is what made the user picker and member lists hard to scan. This picks one
 * bold identity line and a secondary line that never restates it.
 */
export const personIdentity = (
  person: { display_name?: string | null; username?: string | null; email?: string | null },
  fallbackId: string,
): { primary: string; secondary: string | null } => {
  const hasOwnDisplayName =
    person.display_name != null &&
    person.display_name !== '' &&
    person.display_name !== person.username;
  const primary = person.display_name ?? person.username ?? fallbackId;
  const secondary = [hasOwnDisplayName ? person.username : null, person.email]
    .filter((part): part is string => part != null && part !== '')
    .join(' · ');
  return { primary, secondary: secondary === '' ? null : secondary };
};
