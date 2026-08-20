import type { TarsUploadFile } from './knowledge';
import { tarsFetch, getTarsBaseUrl, TarsRequestError } from './client';

/** Attachment limits enforced by pwc_tars (`support_ticket.py`). */
export const TARS_TICKET_MAX_FILES = 5;
export const TARS_TICKET_MAX_FILE_MB = 20;
export const TARS_TICKET_ALLOWED_EXTENSIONS = [
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
] as const;

/** A local attachment copy pwc_tars keeps alongside the remote ticket. */
export interface TarsTicketAttachment {
  id?: string;
  filename?: string;
  original_name?: string;
  size?: number | null;
  uploader?: string | null;
}

/** One comment on the Issue Tracker ticket, as pwc_tars relays it. */
export interface TarsTicketComment {
  id: string;
  body: string;
  author?: string | null;
  author_email?: string | null;
  side?: string | null;
  created_at?: string | null;
  edited_at?: string | null;
}

/** A pwc_tars support ticket (`SysSupportTicket.to_dict()`). */
export interface TarsTicket {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  priority?: string | null;
  attachments?: TarsTicketAttachment[] | null;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  jira_ticket_key?: string | null;
  jira_sync_at?: string | null;
  status?: string | null;
  error_message?: string | null;
  source?: string | null;
  is_resolved?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Only present on the list route when `with_remote_status` was requested. */
  remote_status?: string | null;
  /** Only present on the create/update routes when attachment upload degraded. */
  attach_warning?: string | null;
}

/**
 * A single ticket enriched with everything pwc_tars reads back from the Issue
 * Tracker. Each remote lookup fails independently, so a directory outage
 * degrades one section rather than the whole page.
 */
export interface TarsTicketDetail extends TarsTicket {
  editable: boolean;
  remote_error?: string | null;
  comments: TarsTicketComment[];
  comments_error?: string | null;
  remote_attachments?: TarsTicketAttachment[] | null;
  attachments_error?: string | null;
  remote_fields?: {
    title?: string | null;
    description?: string | null;
    type?: string | null;
    priority?: string | null;
    severity?: string | null;
    component_id?: string | number | null;
  } | null;
}

/** The `type` / `priority` / `severity` value domains, read from Issue Tracker. */
export interface TarsTicketFieldOptions {
  types: string[];
  priorities: string[];
  severities: string[];
  /** Set when pwc_tars fell back to its built-in domains; the form still works. */
  warning?: string | null;
}

/** An Issue Tracker component the ticket can be filed against. */
export interface TarsTicketComponent {
  id: string;
  name: string;
}

/** Editable ticket fields. All but `title` / `description` are optional upstream. */
export interface TarsTicketInput {
  title: string;
  description: string;
  type?: string;
  priority?: string;
  severity?: string;
  component_id?: string;
}

interface TarsEnvelope<T> {
  success?: boolean;
  data?: T;
}

const unwrap = <T>(response: TarsEnvelope<T> | null | undefined, fallback: T): T =>
  response?.data ?? fallback;

/**
 * Ticket routes answer with the pwc_tars envelope, but the Issue Tracker calls
 * behind them are slow enough that the shared 15s budget is not enough.
 */
const REMOTE_TIMEOUT_MS = 45000;

export async function fetchTarsTickets(tarsId: string, baseUrl?: string): Promise<TarsTicket[]> {
  const response = await tarsFetch<TarsEnvelope<TarsTicket[]>>('/api/settings/support_tickets', {
    query: { user_id: tarsId, with_remote_status: true },
    baseUrl,
    timeoutMs: REMOTE_TIMEOUT_MS,
  });
  return unwrap(response, []);
}

export async function fetchTarsTicketDetail(
  ticketId: string,
  baseUrl?: string,
): Promise<TarsTicketDetail | null> {
  const response = await tarsFetch<TarsEnvelope<TarsTicketDetail>>(
    `/api/settings/support_tickets/${encodeURIComponent(ticketId)}`,
    { baseUrl, timeoutMs: REMOTE_TIMEOUT_MS },
  );
  return response?.data ?? null;
}

/**
 * pwc_tars derives the value domains from the Issue Tracker OpenAPI document
 * and answers 200 with a `warning` when it had to fall back to its built-in
 * lists, so a degraded lookup still yields a usable form.
 */
export async function fetchTarsTicketFieldOptions(
  baseUrl?: string,
): Promise<TarsTicketFieldOptions> {
  const response = await tarsFetch<TarsEnvelope<Partial<TarsTicketFieldOptions>>>(
    '/api/settings/ticket_field_options',
    { baseUrl, timeoutMs: REMOTE_TIMEOUT_MS },
  );
  const data = unwrap(response, {});
  return {
    types: data.types ?? [],
    priorities: data.priorities ?? [],
    severities: data.severities ?? [],
    warning: data.warning ?? null,
  };
}

/**
 * The Issue Tracker component list. pwc_tars 400s when the integration is not
 * configured; the form treats that as "no components" rather than a page error
 * because the rest of the ticket history is still readable.
 */
export async function fetchTarsTicketComponents(baseUrl?: string): Promise<TarsTicketComponent[]> {
  const response = await tarsFetch<TarsEnvelope<TarsTicketComponent[]>>(
    '/api/settings/issue_tracker_components',
    { baseUrl, timeoutMs: REMOTE_TIMEOUT_MS },
  );
  return unwrap(response, []).map((component) => ({
    id: String(component.id),
    name: component.name,
  }));
}

const appendTicketFields = (form: FormData, input: TarsTicketInput, tarsId: string): void => {
  form.append('title', input.title);
  form.append('description', input.description);
  form.append('type', input.type ?? '');
  form.append('priority', input.priority ?? '');
  form.append('severity', input.severity ?? '');
  form.append('component_id', input.component_id ?? '');
  form.append('user_id', tarsId);
};

const appendAttachments = (form: FormData, files: TarsUploadFile[]): void => {
  for (const file of files) {
    form.append(
      'attachments',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.filename,
    );
  }
};

/**
 * pwc_tars only accepts the ticket fields as `multipart/form-data` when files
 * ride along, and uses the same parser either way, so both create and update
 * post a form. `tarsFetch` is JSON-only, hence the direct fetch here.
 */
async function postTicketForm<T>(
  path: string,
  method: 'POST' | 'PUT',
  form: FormData,
  baseUrl?: string,
): Promise<T> {
  const url = `${getTarsBaseUrl(baseUrl)}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method, body: form, signal: controller.signal });
    if (!response.ok) {
      let serverMessage: string | undefined;
      try {
        const body = (await response.json()) as { message?: unknown; error?: unknown };
        const detail = body?.message ?? body?.error;
        if (typeof detail === 'string') {
          serverMessage = detail;
        }
      } catch {
        /* non-JSON error body */
      }
      throw new TarsRequestError(response.status, path, serverMessage);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Files a new ticket. pwc_tars creates the Issue Tracker issue first and only
 * writes its local copy once the remote call succeeded, so a returned ticket
 * always carries a `jira_ticket_key`.
 */
export async function createTarsTicket(
  reporter: { tarsId: string; name?: string; email?: string },
  input: TarsTicketInput,
  files: TarsUploadFile[] = [],
  baseUrl?: string,
): Promise<TarsTicket | null> {
  const form = new FormData();
  appendTicketFields(form, input, reporter.tarsId);
  form.append('user_name', reporter.name ?? '');
  form.append('user_email', reporter.email ?? '');
  appendAttachments(form, files);
  const response = await postTicketForm<TarsEnvelope<TarsTicket>>(
    '/api/settings/support_tickets',
    'POST',
    form,
    baseUrl,
  );
  return response?.data ?? null;
}

/**
 * Edits a ticket that the Issue Tracker still reports as editable. Attachments
 * are additive upstream — pwc_tars never removes the ones already on the issue.
 */
export async function updateTarsTicket(
  tarsId: string,
  ticketId: string,
  input: TarsTicketInput,
  files: TarsUploadFile[] = [],
  baseUrl?: string,
): Promise<TarsTicket | null> {
  const form = new FormData();
  appendTicketFields(form, input, tarsId);
  appendAttachments(form, files);
  const response = await postTicketForm<TarsEnvelope<TarsTicket>>(
    `/api/settings/support_tickets/${encodeURIComponent(ticketId)}`,
    'PUT',
    form,
    baseUrl,
  );
  return response?.data ?? null;
}

/**
 * Posts a reply onto the ticket. pwc_tars sends it through the shared service
 * account and prefixes the body so the reply reads back as the customer's.
 */
export async function createTarsTicketComment(
  tarsId: string,
  ticketId: string,
  body: string,
  baseUrl?: string,
): Promise<string | null> {
  const response = await tarsFetch<TarsEnvelope<{ id?: string }>>(
    `/api/settings/support_tickets/${encodeURIComponent(ticketId)}/comments`,
    { method: 'POST', body: { body, user_id: tarsId }, baseUrl, timeoutMs: REMOTE_TIMEOUT_MS },
  );
  return unwrap(response, {}).id ?? null;
}
