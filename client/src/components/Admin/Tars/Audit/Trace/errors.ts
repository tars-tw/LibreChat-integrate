import type { TTarsAuditErrorBody, TTarsAuditErrorCode } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/**
 * Every way reading a trace or downloading one of its files can fail: the
 * server's own classification (`TTarsAuditErrorCode`) plus what only the
 * browser can see — no answer at all, an expired session, or LibreChat's own
 * admin gate refusing before pwc_tars is asked.
 */
export type TraceErrorKind = TTarsAuditErrorCode | 'network' | 'session_expired' | 'not_admin';

export type TraceErrorInfo = {
  kind: TraceErrorKind;
  titleKey: TranslationKeys;
  hintKey: TranslationKeys;
  /** Worth trying again as is; a setting or permission problem is not. */
  retryable: boolean;
  /** A setting or permission an administrator must fix, rather than a passing fault. */
  needsAdmin: boolean;
  status?: number;
  /** The server's own reason, for the technical details an administrator is handed. */
  detail?: string;
};

type Copy = Omit<TraceErrorInfo, 'kind' | 'status' | 'detail'>;

/** Keys are spelled out so a missing translation fails the typecheck. */
const COPY = new Map<TraceErrorKind, Copy>([
  [
    'network',
    {
      titleKey: 'com_ui_tars_audit_trace_err_network',
      hintKey: 'com_ui_tars_audit_trace_err_network_hint',
      retryable: true,
      needsAdmin: false,
    },
  ],
  [
    'session_expired',
    {
      titleKey: 'com_ui_tars_audit_trace_err_session_expired',
      hintKey: 'com_ui_tars_audit_trace_err_session_expired_hint',
      retryable: false,
      needsAdmin: false,
    },
  ],
  [
    'not_admin',
    {
      titleKey: 'com_ui_tars_audit_trace_err_not_admin',
      hintKey: 'com_ui_tars_audit_trace_err_not_admin_hint',
      retryable: false,
      needsAdmin: true,
    },
  ],
  [
    'secret_missing',
    {
      titleKey: 'com_ui_tars_audit_trace_err_secret_missing',
      hintKey: 'com_ui_tars_audit_trace_err_secret_missing_hint',
      retryable: false,
      needsAdmin: true,
    },
  ],
  [
    'credentials_rejected',
    {
      titleKey: 'com_ui_tars_audit_trace_err_credentials_rejected',
      hintKey: 'com_ui_tars_audit_trace_err_credentials_rejected_hint',
      retryable: false,
      needsAdmin: true,
    },
  ],
  [
    'not_tars_admin',
    {
      titleKey: 'com_ui_tars_audit_trace_err_not_tars_admin',
      hintKey: 'com_ui_tars_audit_trace_err_not_tars_admin_hint',
      retryable: false,
      needsAdmin: true,
    },
  ],
  [
    'not_configured',
    {
      titleKey: 'com_ui_tars_audit_trace_err_not_configured',
      hintKey: 'com_ui_tars_audit_trace_err_not_configured_hint',
      retryable: false,
      needsAdmin: true,
    },
  ],
  [
    'tars_unreachable',
    {
      titleKey: 'com_ui_tars_audit_trace_err_tars_unreachable',
      hintKey: 'com_ui_tars_audit_trace_err_tars_unreachable_hint',
      retryable: true,
      needsAdmin: false,
    },
  ],
  [
    'tars_timeout',
    {
      titleKey: 'com_ui_tars_audit_trace_err_tars_timeout',
      hintKey: 'com_ui_tars_audit_trace_err_tars_timeout_hint',
      retryable: true,
      needsAdmin: false,
    },
  ],
  [
    'tars_failed',
    {
      titleKey: 'com_ui_tars_audit_trace_err_tars_failed',
      hintKey: 'com_ui_tars_audit_trace_err_tars_failed_hint',
      retryable: true,
      needsAdmin: false,
    },
  ],
  [
    'bad_response',
    {
      titleKey: 'com_ui_tars_audit_trace_err_bad_response',
      hintKey: 'com_ui_tars_audit_trace_err_bad_response_hint',
      retryable: false,
      needsAdmin: true,
    },
  ],
  [
    'message_not_found',
    {
      titleKey: 'com_ui_tars_audit_trace_err_message_not_found',
      hintKey: 'com_ui_tars_audit_trace_err_message_not_found_hint',
      retryable: false,
      needsAdmin: false,
    },
  ],
  [
    'document_not_found',
    {
      titleKey: 'com_ui_tars_audit_trace_err_document_not_found',
      hintKey: 'com_ui_tars_audit_trace_err_document_not_found_hint',
      retryable: false,
      needsAdmin: false,
    },
  ],
  [
    'document_unavailable',
    {
      titleKey: 'com_ui_tars_audit_trace_err_document_unavailable',
      hintKey: 'com_ui_tars_audit_trace_err_document_unavailable_hint',
      retryable: false,
      needsAdmin: false,
    },
  ],
  [
    'storage_failed',
    {
      titleKey: 'com_ui_tars_audit_trace_err_storage_failed',
      hintKey: 'com_ui_tars_audit_trace_err_storage_failed_hint',
      retryable: true,
      needsAdmin: false,
    },
  ],
  [
    'request_rejected',
    {
      titleKey: 'com_ui_tars_audit_trace_err_request_rejected',
      hintKey: 'com_ui_tars_audit_trace_err_request_rejected_hint',
      retryable: false,
      needsAdmin: false,
    },
  ],
  [
    'internal',
    {
      titleKey: 'com_ui_tars_audit_trace_err_internal',
      hintKey: 'com_ui_tars_audit_trace_err_internal_hint',
      retryable: true,
      needsAdmin: false,
    },
  ],
]);

type FailedRequest = { response?: { status?: number; data?: unknown } };

const isErrorBody = (data: unknown): data is Partial<TTarsAuditErrorBody> =>
  data != null && typeof data === 'object' && !(data instanceof Blob);

/** The kind for a response that carries no server classification. */
function kindOfStatus(status: number | undefined): TraceErrorKind {
  if (status == null) {
    return 'network';
  }
  if (status === 401) {
    return 'session_expired';
  }
  if (status === 403) {
    return 'not_admin';
  }
  return 'internal';
}

/** Classifies a failed trace request from its JSON error body. */
export function traceErrorInfo(error: unknown): TraceErrorInfo {
  const response = (error as FailedRequest | null)?.response;
  const body = isErrorBody(response?.data) ? response?.data : undefined;
  const status = response?.status;
  const kind =
    body?.code && COPY.has(body.code as TraceErrorKind)
      ? (body.code as TraceErrorKind)
      : kindOfStatus(status);
  const detail = body?.detail || body?.error || undefined;
  return {
    kind,
    ...(COPY.get(kind) as Copy),
    ...(status != null && { status }),
    ...(detail && { detail }),
  };
}

/** A Blob's text; through FileReader where `Blob.text` is missing (older engines, jsdom). */
const readBlobText = (blob: Blob): Promise<string> =>
  typeof blob.text === 'function'
    ? blob.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });

/**
 * {@link traceErrorInfo} for a download: a request made for a Blob receives its
 * JSON error body as a Blob too, so the body is read before classifying.
 */
export async function readTraceError(error: unknown): Promise<TraceErrorInfo> {
  const response = (error as FailedRequest | null)?.response;
  if (!(response?.data instanceof Blob)) {
    return traceErrorInfo(error);
  }
  try {
    const data: unknown = JSON.parse(await readBlobText(response.data));
    return traceErrorInfo({ response: { ...response, data } });
  } catch {
    return traceErrorInfo({ response: { status: response.status } });
  }
}

/** One line for an administrator: what failed, with the status, kind and server reason. */
export function traceErrorDetails(info: TraceErrorInfo, context?: string): string {
  return [context, info.status != null ? `HTTP ${info.status}` : null, info.kind, info.detail]
    .filter(Boolean)
    .join(' · ');
}
