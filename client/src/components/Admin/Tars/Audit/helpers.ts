import type { TTarsAuditFeedback, TTarsAuditMessage } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/** A column the operator can show or hide. `locked` columns are always on. */
export interface AuditColumn {
  field: string;
  labelKey: TranslationKeys;
  locked?: boolean;
  /** Rendered specially by the table rather than as plain text. */
  kind?: 'response' | 'boolean' | 'deleted' | 'comments' | 'number';
  className?: string;
}

/**
 * The audit columns, in the order the original report showed them. The four
 * locked ones answer "who asked what, and when" — hiding any of them would
 * leave rows that cannot be identified, so the picker keeps them fixed.
 */
export const REPORT_COLUMNS: AuditColumn[] = [
  { field: 'username', labelKey: 'com_ui_tars_audit_col_user', locked: true },
  { field: 'domain_name', labelKey: 'com_ui_tars_audit_col_domain' },
  { field: 'user_query', labelKey: 'com_ui_tars_audit_col_query', locked: true },
  { field: 'response', labelKey: 'com_ui_tars_audit_col_response', locked: true, kind: 'response' },
  { field: 'is_deleted', labelKey: 'com_ui_tars_audit_col_deleted', kind: 'deleted' },
  { field: 'created_at', labelKey: 'com_ui_tars_audit_col_created_at', locked: true },
  { field: 'conversation_name', labelKey: 'com_ui_tars_audit_col_conversation' },
  { field: 'knowledge_base_name', labelKey: 'com_ui_tars_audit_col_kb' },
  { field: 'model_name', labelKey: 'com_ui_tars_audit_col_model' },
  { field: 'upload_files', labelKey: 'com_ui_tars_audit_col_upload' },
  { field: 'memory_document', labelKey: 'com_ui_tars_audit_col_memory_doc' },
  { field: 'memory_website', labelKey: 'com_ui_tars_audit_col_memory_site' },
  { field: 'is_web_search', labelKey: 'com_ui_tars_audit_col_web_search', kind: 'boolean' },
  { field: 'is_sql_agent', labelKey: 'com_ui_tars_audit_col_sql_agent', kind: 'boolean' },
  { field: 'ip_address', labelKey: 'com_ui_tars_audit_col_ip' },
];

export const FEEDBACK_COLUMNS: AuditColumn[] = [
  { field: 'username', labelKey: 'com_ui_tars_audit_col_user', locked: true },
  { field: 'domain_name', labelKey: 'com_ui_tars_audit_col_domain' },
  { field: 'user_query', labelKey: 'com_ui_tars_audit_col_query', locked: true },
  { field: 'response', labelKey: 'com_ui_tars_audit_col_response', locked: true, kind: 'response' },
  { field: 'comments', labelKey: 'com_ui_tars_audit_col_comments', locked: true, kind: 'comments' },
  { field: 'like_counts', labelKey: 'com_ui_tars_audit_col_like', locked: true, kind: 'number' },
  {
    field: 'dislike_counts',
    labelKey: 'com_ui_tars_audit_col_dislike',
    locked: true,
    kind: 'number',
  },
  { field: 'feedback_at', labelKey: 'com_ui_tars_audit_col_feedback_at' },
];

const defaults = (columns: AuditColumn[], extra: string[]): string[] =>
  columns.filter((c) => c.locked === true || extra.includes(c.field)).map((c) => c.field);

export const DEFAULT_REPORT_COLUMNS = defaults(REPORT_COLUMNS, ['domain_name', 'is_deleted']);
export const DEFAULT_FEEDBACK_COLUMNS = defaults(FEEDBACK_COLUMNS, ['domain_name']);

export const PAGE_SIZES = [10, 20, 50, 100];
/** `Dropdown` renders string options, so the sizes are pre-stringified once. */
export const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);

/** Report rows carry the feedback timestamp only after it is joined in. */
export type AuditRow = TTarsAuditMessage & { feedback_at?: string | null };

/**
 * Rows that received a rating or a written comment, one per message.
 *
 * pwc_tars can emit a message more than once when several feedback records fall
 * in the period, so the newest row wins — matching the original report, which
 * showed the latest state rather than a running history.
 */
export const latestFeedbackRows = (
  rows: TTarsAuditMessage[],
  feedback: TTarsAuditFeedback[],
): AuditRow[] => {
  const latestAt = new Map<string, string>();
  for (const entry of feedback) {
    const at = entry.created_at ?? '';
    const current = latestAt.get(entry.message_id);
    if (current == null || at > current) {
      latestAt.set(entry.message_id, at);
    }
  }

  const byMessage = new Map<string, AuditRow>();
  for (const row of rows) {
    const hasFeedback =
      (row.comments != null && row.comments.trim() !== '') ||
      row.like_counts > 0 ||
      row.dislike_counts > 0;
    if (!hasFeedback) {
      continue;
    }
    const existing = byMessage.get(row.message_id);
    if (existing == null || (row.created_at ?? '') > (existing.created_at ?? '')) {
      byMessage.set(row.message_id, { ...row, feedback_at: latestAt.get(row.message_id) ?? null });
    }
  }
  return [...byMessage.values()];
};

export const feedbackTotals = (rows: AuditRow[]): { likes: number; dislikes: number } =>
  rows.reduce(
    (totals, row) => ({
      likes: totals.likes + Number(row.like_counts || 0),
      dislikes: totals.dislikes + Number(row.dislike_counts || 0),
    }),
    { likes: 0, dislikes: 0 },
  );

/** `YYYY-MM-DD` in the browser's own timezone, which is what `<input type="date">` reads. */
export const toDateValue = (date: Date): string => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

/** The original report opened on the last seven days; keep that muscle memory. */
export const defaultDateRange = (): { start: string; end: string } => {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  return { start: toDateValue(weekAgo), end: toDateValue(today) };
};

/** Comments arrive as `- one\n- two`; the leading marker is presentation. */
export const commentLines = (raw: string | null | undefined): string[] =>
  (raw ?? '')
    .split('\n')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter((line) => line !== '');

/**
 * The plain-text value of one cell. Shared by the table and the CSV export so
 * the file always says what the screen said, with no second formatting path.
 */
export const cellText = (
  row: AuditRow,
  column: AuditColumn,
  formatDate: (value: string | null | undefined) => string,
): string => {
  switch (column.kind) {
    case 'response':
      return row.model_response ?? '';
    case 'boolean':
      return row[column.field as 'is_web_search' | 'is_sql_agent'] === true ? 'V' : '';
    case 'deleted':
      return row.is_deleted ? 'V' : '';
    case 'comments':
      return commentLines(row.comments).join('\n');
    case 'number':
      return String(row[column.field as 'like_counts' | 'dislike_counts'] ?? 0);
    default:
      break;
  }
  if (column.field === 'created_at' || column.field === 'feedback_at') {
    return formatDate(row[column.field]);
  }
  const value = row[column.field as keyof AuditRow];
  return value == null ? '' : String(value);
};
