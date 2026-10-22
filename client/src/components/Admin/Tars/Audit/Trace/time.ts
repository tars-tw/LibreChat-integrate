import { format } from 'date-fns';
import type { TTarsTraceRow } from 'librechat-data-provider';
import type { ChartRow } from './layout';

/** Timestamps and durations the overview and the report print. */

/**
 * Format timestamp as YYYY-MM-DD HH:mm:ss, preserving sub-second decimal
 * precision if present in the source record (e.g. .123 or .123456).
 */
export function fmtTimestamp(raw: string | Date | number | null | undefined): string {
  if (!raw) {
    return '—';
  }
  try {
    let fractional: string | null = null;
    let dateInput: string | Date | number = raw;
    if (typeof raw === 'string') {
      const match = raw.match(/:\d{2}\.(\d+)/);
      if (match) {
        fractional = match[1];
      }
      dateInput = raw.replace(' ', 'T');
    } else if (raw instanceof Date) {
      const ms = raw.getMilliseconds();
      if (ms > 0) {
        fractional = String(ms).padStart(3, '0');
      }
    } else if (typeof raw === 'number') {
      const d = new Date(raw);
      const ms = d.getMilliseconds();
      if (ms > 0) {
        fractional = String(ms).padStart(3, '0');
      }
    }
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    const base = format(date, 'yyyy-MM-dd HH:mm:ss');
    return fractional ? `${base}.${fractional}` : base;
  } catch {
    return '—';
  }
}

/**
 * Total wall-clock time spent waiting for tool executions (ms).
 * Overlapping/concurrent tool calls are merged so parallel execution
 * does not exceed actual elapsed waiting time.
 */
export function computeToolWaitDuration(topToolRows: ChartRow[]): number {
  if (topToolRows.length === 0) {
    return 0;
  }
  const intervals: { start: number; end: number }[] = [];
  for (const row of topToolRows) {
    const start = row._start ?? 0;
    const dur = row.duration_ms ?? Math.max(0, (row._end ?? 0) - start);
    const end = Math.max(row._end ?? 0, start + dur);
    if (end > start) {
      intervals.push({ start, end });
    }
  }
  if (intervals.length === 0) {
    const sumDur = topToolRows.reduce((acc, r) => acc + (r.duration_ms ?? 0), 0);
    return Math.round(sumDur);
  }
  intervals.sort((a, b) => a.start - b.start);
  let totalWaitMs = 0;
  let curStart = intervals[0].start;
  let curEnd = intervals[0].end;
  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i];
    if (next.start <= curEnd) {
      curEnd = Math.max(curEnd, next.end);
    } else {
      totalWaitMs += curEnd - curStart;
      curStart = next.start;
      curEnd = next.end;
    }
  }
  totalWaitMs += curEnd - curStart;
  return Math.round(totalWaitMs);
}

/** A row's recorded duration, else the span between its timestamps; null when neither is readable. */
export function rowDurationMs(
  row: Pick<TTarsTraceRow, 'duration_ms' | 'started_at' | 'ended_at'>,
): number | null {
  if (row.duration_ms != null) {
    return row.duration_ms;
  }
  if (!row.started_at || !row.ended_at) {
    return null;
  }
  const span = new Date(row.ended_at).getTime() - new Date(row.started_at).getTime();
  return Number.isFinite(span) && span >= 0 ? span : null;
}
