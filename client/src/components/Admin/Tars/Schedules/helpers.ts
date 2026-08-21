import { CircleCheck, CircleX, CirclePause, Loader, CircleHelp } from 'lucide-react';
import type { TTarsSchedule } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';

/**
 * The states `last_status` takes. pwc_tars also rewrites it to `stopped` in the
 * response once `end_time` has passed, so a stored value of `success` can
 * arrive as `stopped` — the response is the truth for display.
 */
export interface StatusMeta {
  labelKey: TranslationKeys;
  icon: LucideIcon;
  className: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  success: {
    labelKey: 'com_ui_tars_sched_status_success',
    icon: CircleCheck,
    className: 'bg-pwc-success/15 text-pwc-success',
  },
  running: {
    labelKey: 'com_ui_tars_sched_status_running',
    icon: Loader,
    className: 'bg-brand-primary/10 text-brand-primary',
  },
  failed: {
    labelKey: 'com_ui_tars_sched_status_failed',
    icon: CircleX,
    className: 'bg-pwc-danger/10 text-pwc-danger',
  },
  stopped: {
    labelKey: 'com_ui_tars_sched_status_stopped',
    icon: CirclePause,
    className: 'bg-surface-tertiary text-text-secondary',
  },
};

/** A schedule that has never run has no status at all. */
export const statusMeta = (status: string | null | undefined): StatusMeta =>
  STATUS_META[status ?? ''] ?? {
    labelKey: 'com_ui_tars_sched_status_idle',
    icon: CircleHelp,
    className: 'bg-surface-tertiary text-text-secondary',
  };

export const isRunning = (schedule: TTarsSchedule): boolean => schedule.last_status === 'running';
export const isStopped = (schedule: TTarsSchedule): boolean => schedule.last_status === 'stopped';

/** Only document-group schedules carry the sync-all flag. */
export const hasSyncAll = (schedule: TTarsSchedule): boolean =>
  schedule.dataset_type === 'file_system';

const DATASET_TYPE_KEYS: Record<string, TranslationKeys> = {
  website: 'com_ui_tars_kb_stat_websites',
  file_system: 'com_ui_tars_kb_stat_file_systems',
  api: 'com_ui_tars_kb_stat_apis',
};

export const datasetTypeKey = (type: string): TranslationKeys | null =>
  DATASET_TYPE_KEYS[type] ?? null;

export const FREQUENCY_UNITS = ['day', 'week', 'month'] as const;
export type FrequencyUnit = (typeof FREQUENCY_UNITS)[number];

const UNIT_KEYS: Record<string, TranslationKeys> = {
  day: 'com_ui_tars_sched_unit_day',
  week: 'com_ui_tars_sched_unit_week',
  month: 'com_ui_tars_sched_unit_month',
};

export const unitKey = (unit: string): TranslationKeys | null => UNIT_KEYS[unit] ?? null;

/**
 * pwc_tars stores these as `YYYY-MM-DDTHH:MM:SS` with no zone, while a
 * `datetime-local` input wants `YYYY-MM-DDTHH:MM`. Trimming beats parsing:
 * feeding the string through `Date` would shift it by the viewer's offset.
 */
export const toLocalInput = (value: string | null | undefined): string =>
  value == null ? '' : value.slice(0, 16);

/** One hour from now, rounded to the minute — a sane default start. */
export const defaultStart = (): string => {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setSeconds(0, 0);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(
    start.getHours(),
  )}:${pad(start.getMinutes())}`;
};
