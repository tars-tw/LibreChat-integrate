import type { TTarsTicket, TTarsTicketComment, TTarsTicketDetail } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

export type LabelField = 'types' | 'priorities' | 'severities';

export const MAX_FILES = 5;
export const MAX_FILE_MB = 20;

export const ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'zip',
  'log',
];

export const FILE_ACCEPT = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

/**
 * `Dropdown` renders an empty label for `''`, so "not selected" needs a value
 * of its own. It is stripped again before the payload reaches pwc_tars.
 */
export const NO_SELECTION = '__none__';

export const fromSelection = (value: string): string => (value === NO_SELECTION ? '' : value);
export const toSelection = (value: string | null | undefined): string =>
  value != null && value !== '' ? value : NO_SELECTION;

type BadgeTone = 'neutral' | 'info' | 'success' | 'danger' | 'muted';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-tertiary text-text-secondary',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  muted: 'bg-surface-tertiary text-text-tertiary',
};

export const badgeClasses = (tone: BadgeTone): string => TONE_CLASSES[tone];

/** The ticket's real state on the Issue Tracker (`IssueStatus` domain). */
const REMOTE_STATUS: Record<string, { tone: BadgeTone; labelKey: TranslationKeys }> = {
  NEW: { tone: 'neutral', labelKey: 'com_ui_tars_issues_status_new' },
  ASSIGNED: { tone: 'info', labelKey: 'com_ui_tars_issues_status_assigned' },
  ACCEPTED: { tone: 'info', labelKey: 'com_ui_tars_issues_status_accepted' },
  FIXED: { tone: 'success', labelKey: 'com_ui_tars_issues_status_fixed' },
  WONT_FIX: { tone: 'muted', labelKey: 'com_ui_tars_issues_status_wont_fix' },
  DUPLICATE: { tone: 'muted', labelKey: 'com_ui_tars_issues_status_duplicate' },
  OBSOLETE: { tone: 'muted', labelKey: 'com_ui_tars_issues_status_obsolete' },
};

/** Local sync state — the fallback when the Issue Tracker cannot be reached. */
const LOCAL_STATUS: Record<string, { tone: BadgeTone; labelKey: TranslationKeys }> = {
  synced: { tone: 'success', labelKey: 'com_ui_tars_issues_local_synced' },
  pending: { tone: 'neutral', labelKey: 'com_ui_tars_issues_local_pending' },
  failed: { tone: 'danger', labelKey: 'com_ui_tars_issues_local_failed' },
  resolved: { tone: 'info', labelKey: 'com_ui_tars_issues_local_resolved' },
};

/** Statuses that close the discussion; replies are no longer accepted. */
export const CLOSED_STATUSES = ['FIXED', 'WONT_FIX', 'DUPLICATE', 'OBSOLETE'];

export const isClosed = (status: string | null | undefined): boolean =>
  status != null && CLOSED_STATUSES.includes(status);

export interface TicketBadge {
  tone: BadgeTone;
  labelKey?: TranslationKeys;
  /** A status pwc_tars reported that this build has no translation for. */
  rawLabel?: string;
}

/**
 * Prefers the live Issue Tracker status, falls back to the local sync state,
 * and finally shows an unrecognised status verbatim rather than hiding it.
 */
export const ticketBadge = (ticket: TTarsTicket): TicketBadge => {
  const remote = ticket.remote_status != null ? REMOTE_STATUS[ticket.remote_status] : undefined;
  if (remote) {
    return { tone: remote.tone, labelKey: remote.labelKey };
  }
  if (ticket.remote_status) {
    return { tone: 'neutral', rawLabel: ticket.remote_status };
  }
  const local = ticket.status != null ? LOCAL_STATUS[ticket.status] : undefined;
  if (local) {
    return { tone: local.tone, labelKey: local.labelKey };
  }
  return { tone: 'neutral', rawLabel: ticket.status ?? '—' };
};

/** `[客戶] 姓名（email）：\n\n內文`, tolerating the older prefix-less format. */
const CUSTOMER_COMMENT_PREFIX =
  /^(?:\[客戶\]\s*)?(.+?)(?:\s*[（(]\s*([^）)]+?)\s*[）)]\s*)?[：:]\s*\n+\s*([\s\S]*)$/;

/** Service-account display names that would read as noise next to "PwC 團隊". */
const SERVICE_AUTHORS = new Set(['customer service', 'customerservice', 'support']);

export interface DisplayComment {
  id: string;
  body: string;
  author: string | null;
  isCustomer: boolean;
  created_at?: string | null;
  edited_at?: string | null;
}

/**
 * pwc_tars posts customer replies through a shared service account, so the
 * author on the Issue Tracker is always that account. The `[客戶]` body prefix
 * is what distinguishes the two sides when reading back.
 */
export const toDisplayComment = (comment: TTarsTicketComment): DisplayComment => {
  const match = comment.body.trim().match(CUSTOMER_COMMENT_PREFIX);
  if (comment.side === 'customer' || match) {
    const author = match ? match[1].trim() : (comment.author ?? comment.author_email ?? null);
    return {
      id: comment.id,
      body: match ? match[3] : comment.body,
      author: author || null,
      isCustomer: true,
      created_at: comment.created_at,
      edited_at: comment.edited_at,
    };
  }
  const author = (comment.author ?? '').trim();
  return {
    id: comment.id,
    body: comment.body,
    author: author && !SERVICE_AUTHORS.has(author.toLowerCase()) ? author : null,
    isCustomer: false,
    created_at: comment.created_at,
    edited_at: comment.edited_at,
  };
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export type FileRejection = 'type' | 'size' | 'count';

export interface FileSelection {
  files: File[];
  rejected: { name: string; reason: FileRejection }[];
}

/**
 * Merges a new pick into the current selection under the pwc_tars limits,
 * reporting what it dropped so the caller can tell the user why.
 */
export const mergeFiles = (current: File[], picked: File[]): FileSelection => {
  const rejected: { name: string; reason: FileRejection }[] = [];
  const accepted: File[] = [];
  const seen = new Set(current.map((file) => file.name));

  for (const file of current) {
    accepted.push(file);
  }

  for (const file of picked) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      rejected.push({ name: file.name, reason: 'type' });
      continue;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      rejected.push({ name: file.name, reason: 'size' });
      continue;
    }
    if (seen.has(file.name)) {
      continue;
    }
    if (accepted.length >= MAX_FILES) {
      rejected.push({ name: file.name, reason: 'count' });
      continue;
    }
    seen.add(file.name);
    accepted.push(file);
  }

  return { files: accepted, rejected };
};

/** The values that pre-fill the form: the Issue Tracker's, then the local copy's. */
export const ticketFormValues = (
  ticket: TTarsTicket | TTarsTicketDetail | null,
): {
  title: string;
  description: string;
  type: string;
  priority: string;
  severity: string;
  component_id: string;
} => {
  const remote = (ticket as TTarsTicketDetail | null)?.remote_fields ?? {};
  return {
    title: ticket?.title ?? '',
    description: ticket?.description ?? '',
    type: toSelection(ticket?.category ?? remote.type),
    priority: toSelection(ticket?.priority ?? remote.priority),
    severity: toSelection(remote.severity),
    component_id: toSelection(remote.component_id != null ? String(remote.component_id) : ''),
  };
};

/**
 * The Issue Tracker value domains this build ships labels for. Anything the
 * provider adds later falls through to its raw value rather than disappearing
 * from the form, which is how the pwc_tars page behaved.
 */
export const DOMAIN_LABELS: Record<LabelField, Record<string, TranslationKeys>> = {
  types: {
    bug: 'com_ui_tars_issues_type_bug',
    feature_request: 'com_ui_tars_issues_type_feature_request',
    task: 'com_ui_tars_issues_type_task',
    process: 'com_ui_tars_issues_type_process',
    vulnerability: 'com_ui_tars_issues_type_vulnerability',
  },
  priorities: {
    p0: 'com_ui_tars_issues_priority_p0',
    p1: 'com_ui_tars_issues_priority_p1',
    p2: 'com_ui_tars_issues_priority_p2',
    p3: 'com_ui_tars_issues_priority_p3',
    p4: 'com_ui_tars_issues_priority_p4',
  },
  severities: {
    s0: 'com_ui_tars_issues_severity_s0',
    s1: 'com_ui_tars_issues_severity_s1',
    s2: 'com_ui_tars_issues_severity_s2',
    s3: 'com_ui_tars_issues_severity_s3',
    s4: 'com_ui_tars_issues_severity_s4',
  },
};

export const domainLabelKey = (field: LabelField, value: string): TranslationKeys | undefined =>
  DOMAIN_LABELS[field][value.toLowerCase()];
