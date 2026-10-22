import { TARS_MESSAGE_STATUS } from 'librechat-data-provider';
import type { TTarsTraceRow } from 'librechat-data-provider';
import type { Localize, Tone } from './layout';
import { pairedToolRows } from './layout';

/** How a run or a tool call ended: its tone, its finish reason and why a retried attempt failed. */

/**
 * The light for how the run ended. Only a failure is red; a run that stopped
 * short without failing (a user stop, or an outcome the trace cannot name) is
 * amber, as LibreChat colors a cancelled run.
 */
export function outcomeTone(code: number | null | undefined, aborted: boolean): Tone {
  if (!aborted) {
    return 'good';
  }
  return code === TARS_MESSAGE_STATUS.failed ? 'bad' : 'warn';
}

export function finishReasonLabel(
  t: Localize,
  reason: string | null | undefined,
): { label: string; tone: Tone } | null {
  if (!reason) {
    return null;
  }
  const normalized = reason.toLowerCase().trim();
  if (normalized === 'stop') {
    return { label: t('com_ui_tars_audit_trace_finish_stop'), tone: 'good' };
  }
  if (normalized === 'length' || normalized === 'max_tokens') {
    return { label: t('com_ui_tars_audit_trace_finish_length'), tone: 'warn' };
  }
  if (normalized === 'content_filter') {
    return {
      label: t('com_ui_tars_audit_trace_finish_content_filter'),
      tone: 'bad',
    };
  }
  return { label: reason, tone: 'neutral' };
}

export const RETRY_REASON_MAX_CHARS = 120;

/** Why the attempt named by retry_of failed — retry_of itself is only a call id. */
export function retryFailureReason(trace: TTarsTraceRow[], retryOfId: string | null): string {
  if (!retryOfId) {
    return '—';
  }
  const prior = pairedToolRows(trace, retryOfId).result;
  const text = (prior?.payload?.summary || prior?.payload?.output || '').trim();
  if (!text) {
    return '—';
  }
  return text.length > RETRY_REASON_MAX_CHARS ? `${text.slice(0, RETRY_REASON_MAX_CHARS)}…` : text;
}
