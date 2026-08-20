import {
  Download,
  Eye,
  FileUp,
  Info,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  TTarsJsonField,
  TTarsActionLogModule,
  TTarsActionLogSummary,
} from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';

/**
 * How one action verb is presented.
 *
 * The original page gave each of the nine verbs its own hard-coded colour. Only
 * three of those distinctions carry meaning the theme can express, so the icon
 * does the identifying and the tone is reserved for what an auditor reacts to:
 * a destructive action, a change, or a routine read.
 */
export type ActionTone = 'danger' | 'brand' | 'neutral';

export interface ActionConfig {
  labelKey: TranslationKeys;
  icon: LucideIcon;
  tone: ActionTone;
  /** The matching key in the pwc_tars summary object. */
  summaryKey: keyof TTarsActionLogSummary;
}

const ACTIONS: Record<string, ActionConfig> = {
  CREATE: {
    labelKey: 'com_ui_tars_ops_action_create',
    icon: Plus,
    tone: 'brand',
    summaryKey: 'create',
  },
  UPDATE: {
    labelKey: 'com_ui_tars_ops_action_update',
    icon: Pencil,
    tone: 'brand',
    summaryKey: 'update',
  },
  DELETE: {
    labelKey: 'com_ui_tars_ops_action_delete',
    icon: Trash2,
    tone: 'danger',
    summaryKey: 'delete',
  },
  READ: { labelKey: 'com_ui_tars_ops_action_read', icon: Eye, tone: 'neutral', summaryKey: 'read' },
  EXPORT: {
    labelKey: 'com_ui_tars_ops_action_export',
    icon: FileUp,
    tone: 'neutral',
    summaryKey: 'export',
  },
  DOWNLOAD: {
    labelKey: 'com_ui_tars_ops_action_download',
    icon: Download,
    tone: 'neutral',
    summaryKey: 'download',
  },
  LOGIN: {
    labelKey: 'com_ui_tars_ops_action_login',
    icon: LogIn,
    tone: 'neutral',
    summaryKey: 'login',
  },
  LOGOUT: {
    labelKey: 'com_ui_tars_ops_action_logout',
    icon: LogOut,
    tone: 'neutral',
    summaryKey: 'logout',
  },
  OTHER: {
    labelKey: 'com_ui_tars_ops_action_other',
    icon: MoreHorizontal,
    tone: 'neutral',
    summaryKey: 'other',
  },
};

/** The verbs in the order the summary row and the action picker show them. */
export const ACTION_ORDER = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'READ',
  'EXPORT',
  'DOWNLOAD',
  'LOGIN',
  'LOGOUT',
  'OTHER',
];

/** A verb pwc_tars adds later still renders, as a neutral badge with its raw name. */
export const actionConfig = (action: string | null | undefined): ActionConfig | null =>
  action == null ? null : (ACTIONS[action.toUpperCase()] ?? null);

export const FALLBACK_ACTION: Pick<ActionConfig, 'icon' | 'tone'> = {
  icon: Info,
  tone: 'neutral',
};

export const toneClasses = (tone: ActionTone): string => {
  if (tone === 'danger') {
    return 'bg-pwc-danger/10 text-pwc-danger';
  }
  if (tone === 'brand') {
    return 'bg-brand-primary/10 text-brand-primary';
  }
  return 'bg-surface-tertiary text-text-secondary';
};

export const statusTone = (status: string | null | undefined): string => {
  if (status === 'SUCCESS') {
    return 'text-text-primary';
  }
  return status === 'FAILED' ? 'text-pwc-danger' : 'text-text-secondary';
};

/**
 * Module names come from `sys_menu`. pwc_tars sends a `lang_key` that its own
 * i18n resolves; LibreChat has no such key, so the title it also sends is what
 * actually gets shown.
 */
export const moduleLabel = (
  value: string | null | undefined,
  modules: TTarsActionLogModule[],
): string => {
  if (value == null || value === '') {
    return '—';
  }
  return modules.find((module) => module.value === value)?.title ?? value;
};

/** `<input type="datetime-local">` reads `YYYY-MM-DDTHH:mm` in local time. */
export const toLocalInput = (date: Date): string => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

/** The original page opened on the last month; keep that muscle memory. */
export const defaultWindow = (): { start: string; end: string } => {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 1);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 0, 0);
  return { start: toLocalInput(start), end: toLocalInput(end) };
};

/**
 * Renders one of pwc_tars' JSON columns as readable text.
 *
 * SQLAlchemy returns `db.JSON` already parsed, so the usual case is an object.
 * A string still turns up for rows written before the column became JSON, and
 * that string is not guaranteed to be valid JSON — so it falls back to itself.
 */
export const prettyJson = (value: TTarsJsonField | undefined): string => {
  if (value == null || value === '') {
    return '—';
  }
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
};

/** Whether a JSON column holds anything worth showing a panel for. */
export const hasJsonValue = (value: TTarsJsonField | undefined): boolean =>
  value != null && value !== '';

export const PAGE_SIZES = [10, 20, 50, 100];
export const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

/** One request's worth of rows; the route refuses anything larger. */
export const EXPORT_LIMIT = 1000;
