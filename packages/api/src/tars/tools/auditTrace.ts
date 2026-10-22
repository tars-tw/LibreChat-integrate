import type { TarsTraceRecord } from '~/tars/trace';
import { createTarsRequestStore } from './store';

/**
 * Trace records a pwc_tars built-in tool returned for the audit report only
 * (`rag_retrieval`), kept per request until the turn is mirrored. They live in
 * memory alone: never in the LibreChat message, never streamed to the browser,
 * since the retrieval detail can run to thousands of entries.
 */
const auditRecords = createTarsRequestStore<TarsTraceRecord[]>((previous, next) => [
  ...(previous ?? []),
  ...next,
]);

export function recordTarsToolAuditTrace(
  owner: object,
  toolCallId: string,
  records: readonly TarsTraceRecord[],
): void {
  auditRecords.record(owner, toolCallId, [...records]);
}

/** The records kept for this request, by the id of the tool call that produced them. */
export function getTarsToolAuditTrace(
  owner: object | null | undefined,
): Map<string, TarsTraceRecord[]> {
  return auditRecords.get(owner);
}
