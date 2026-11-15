import type { TTarsAuditMessage } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/** A column the operator can show or hide. `locked` columns are always on. */
export interface AuditColumn {
  field: string;
  labelKey: TranslationKeys;
  locked?: boolean;
  /** On until the operator turns it off; locked columns are always on. */
  defaultOn?: boolean;
  /** Rendered specially by the table rather than as plain text. */
  kind?: 'response' | 'boolean' | 'comments' | 'number' | 'agent';
  className?: string;
}

/**
 * The message columns an expanded conversation lists. The conversation row
 * already names the user, agent and conversation, so they are not repeated by
 * default; question, response and time are what identify a message within it.
 * The per-message agent stays on offer for a conversation that switched agents.
 */
export const MESSAGE_COLUMNS: AuditColumn[] = [
  { field: 'user_query', labelKey: 'com_ui_tars_audit_col_query', locked: true },
  { field: 'response', labelKey: 'com_ui_tars_audit_col_response', locked: true, kind: 'response' },
  { field: 'knowledge_base_name', labelKey: 'com_ui_tars_audit_col_kb', defaultOn: true },
  { field: 'model_name', labelKey: 'com_ui_tars_audit_col_model', defaultOn: true },
  { field: 'created_at', labelKey: 'com_ui_tars_audit_col_created_at', locked: true },
  { field: 'upload_files', labelKey: 'com_ui_tars_audit_col_upload' },
  { field: 'memory_document', labelKey: 'com_ui_tars_audit_col_memory_doc' },
  { field: 'memory_website', labelKey: 'com_ui_tars_audit_col_memory_site' },
  { field: 'is_web_search', labelKey: 'com_ui_tars_audit_col_web_search', kind: 'boolean' },
  { field: 'is_sql_agent', labelKey: 'com_ui_tars_audit_col_sql_agent', kind: 'boolean' },
  { field: 'ip_address', labelKey: 'com_ui_tars_audit_col_ip' },
  { field: 'agent_name', labelKey: 'com_ui_tars_audit_col_agent', kind: 'agent' },
];

/**
 * What a conversation row shows. Fixed: these identify the conversation, so the
 * column picker never offers them. Also the leading columns of the report CSV.
 */
export const CONVERSATION_COLUMNS: AuditColumn[] = [
  { field: 'username', labelKey: 'com_ui_tars_audit_col_user', locked: true },
  { field: 'agent_name', labelKey: 'com_ui_tars_audit_col_agent', locked: true, kind: 'agent' },
  { field: 'conversation_name', labelKey: 'com_ui_tars_audit_col_conversation', locked: true },
  {
    field: 'message_count',
    labelKey: 'com_ui_tars_audit_col_message_count',
    locked: true,
    kind: 'number',
  },
  { field: 'is_deleted', labelKey: 'com_ui_tars_audit_col_deleted', locked: true },
];

export const FEEDBACK_COLUMNS: AuditColumn[] = [
  { field: 'username', labelKey: 'com_ui_tars_audit_col_user', locked: true },
  { field: 'agent_name', labelKey: 'com_ui_tars_audit_col_agent', locked: true, kind: 'agent' },
  { field: 'conversation_name', labelKey: 'com_ui_tars_audit_col_conversation', locked: true },
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
  { field: 'created_at', labelKey: 'com_ui_tars_audit_col_message_created_at' },
];

const defaults = (columns: AuditColumn[]): string[] =>
  columns.filter((c) => c.locked === true || c.defaultOn === true).map((c) => c.field);

export const DEFAULT_MESSAGE_COLUMNS = defaults(MESSAGE_COLUMNS);
export const DEFAULT_FEEDBACK_COLUMNS = defaults(FEEDBACK_COLUMNS);

export const PAGE_SIZES = [10, 20, 50, 100];
/** `Dropdown` renders string options, so the sizes are pre-stringified once. */
export const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String);
/** An expanded conversation lists its messages this many at a time. */
export const CONVERSATION_PAGE_SIZE = 10;

export type AuditRow = TTarsAuditMessage;

/** One conversation of the report: its matching messages, newest first. */
export interface AuditConversation {
  id: string;
  username: string | null;
  conversation_name: string | null;
  is_deleted: boolean;
  messages: AuditRow[];
}

/**
 * The rows grouped by conversation, in the order the rows arrive (pwc_tars sends
 * them newest first, so the most recently active conversation leads). A row
 * without a conversation id stands alone rather than merging with others.
 */
export const groupConversations = (rows: AuditRow[]): AuditConversation[] => {
  const groups = new Map<string, AuditConversation>();
  for (const row of rows) {
    const id = row.conversation_id ?? `message:${row.message_id}`;
    const group = groups.get(id);
    if (group != null) {
      group.messages.push(row);
      group.is_deleted ||= row.conversation_is_deleted;
      continue;
    }
    groups.set(id, {
      id,
      username: row.username,
      conversation_name: row.conversation_name,
      is_deleted: row.conversation_is_deleted,
      messages: [row],
    });
  }
  return [...groups.values()];
};

type Localize = (key: TranslationKeys, values?: Record<string, string>) => string;

/**
 * How a row's agent reads: its name, or why it has none. An agent that no
 * longer exists keeps its id, so two of them stay apart in the report.
 */
export const agentLabel = (
  row: Pick<AuditRow, 'agent_id' | 'agent_name'>,
  localize: Localize,
): string => {
  if (row.agent_name != null && row.agent_name !== '') {
    return row.agent_name;
  }
  if (row.agent_id == null) {
    return localize('com_ui_tars_audit_no_agent');
  }
  return localize('com_ui_tars_audit_agent_deleted', { 0: row.agent_id });
};

/**
 * Every distinct agent a conversation's messages ran, joined; nearly always one.
 * Told apart by id, so two agents that share a name are both listed.
 */
export const conversationAgentLabel = (
  conversation: AuditConversation,
  localize: Localize,
): string => {
  const labels = new Map<string, string>();
  for (const row of conversation.messages) {
    const key = row.agent_id ?? '';
    if (!labels.has(key)) {
      labels.set(key, agentLabel(row, localize));
    }
  }
  return [...labels.values()].join(localize('com_ui_tars_audit_trace_list_separator'));
};

/**
 * Labels that stay unique: a name two items share gets each item's id appended,
 * so a picker entry or a statistics row always points at one agent.
 */
export const distinctLabels = <T extends { id: string; label: string }>(items: T[]): T[] => {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  }
  return items.map((item) =>
    (counts.get(item.label) ?? 0) > 1 ? { ...item, label: `${item.label} (${item.id})` } : item,
  );
};

/**
 * Rows that received a rating or a written comment, one per message.
 *
 * pwc_tars can emit a message more than once when several feedback records fall
 * in the period, so the newest row wins — matching the original report, which
 * showed the latest state rather than a running history.
 */
export const latestFeedbackRows = (rows: AuditRow[]): AuditRow[] => {
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
      byMessage.set(row.message_id, row);
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

/** How a cell turns values into text; supplied by the table, which knows the locale. */
export interface CellFormat {
  date: (value: string | null | undefined) => string;
  agent: (row: AuditRow) => string;
  /** What a hard-deleted account reads as; its messages stay in the report. */
  deletedUser: string;
}

/**
 * The plain-text value of one cell. Shared by the table and the CSV export so
 * the file always says what the screen said, with no second formatting path.
 */
export const cellText = (row: AuditRow, column: AuditColumn, format: CellFormat): string => {
  switch (column.kind) {
    case 'response':
      return row.model_response ?? '';
    case 'boolean':
      return row[column.field as 'is_web_search' | 'is_sql_agent'] === true ? 'V' : '';
    case 'comments':
      return commentLines(row.comments).join('\n');
    case 'number':
      return String(row[column.field as 'like_counts' | 'dislike_counts'] ?? 0);
    case 'agent':
      return format.agent(row);
    default:
      break;
  }
  if (column.field === 'created_at') {
    return format.date(row.created_at);
  }
  if (column.field === 'username') {
    return row.username ?? format.deletedUser;
  }
  const value = row[column.field as keyof AuditRow];
  return value == null ? '' : String(value);
};

/** The text of one conversation-row cell, for the screen and the CSV alike. */
export const conversationCellText = (
  conversation: AuditConversation,
  column: AuditColumn,
  localize: Localize,
): string => {
  switch (column.field) {
    case 'username':
      return conversation.username ?? localize('com_ui_tars_audit_trace_user_deleted');
    case 'agent_name':
      return conversationAgentLabel(conversation, localize);
    case 'conversation_name':
      return conversation.conversation_name || localize('com_ui_tars_audit_untitled_conversation');
    case 'message_count':
      return String(conversation.messages.length);
    case 'is_deleted':
      return conversation.is_deleted ? 'V' : '';
    default:
      return '';
  }
};
