import { TARS_TRACE_EVENT } from 'librechat-data-provider';
import type { TTarsTraceRow } from 'librechat-data-provider';
import { rowDurationMs } from './time';
import { stringList } from './values';

/** The JSON a step's detail dialog copies. */

function parseJsonIfString(val: unknown): unknown {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

/**
 * Builds a structured, exportable JSON object for a tool call (or generic trace event)
 * displayed in the trace detail dialog card.
 */
export function buildDetailExportJson(
  row: TTarsTraceRow,
  call: TTarsTraceRow | undefined,
  result: TTarsTraceRow | undefined,
): Record<string, unknown> {
  const primary = result ?? call ?? row;
  const isTool = primary.tool_name != null || primary.event_type === TARS_TRACE_EVENT.langflowRoute;

  if (isTool) {
    const data: Record<string, unknown> = {};

    if (primary.tool_name) {
      data.tool_name = primary.tool_name;
    } else if (primary.event_type) {
      data.tool_name = primary.event_type;
    }

    if (primary.tool_use_id) {
      data.tool_use_id = primary.tool_use_id;
    }

    if (primary.ok != null) {
      data.status = primary.ok ? 'success' : 'error';
      data.ok = primary.ok;
    }

    const duration = rowDurationMs(primary);
    if (duration != null) {
      data.duration_ms = duration;
    }

    if (call?.attempt != null && call.attempt > 1) {
      data.attempt = call.attempt;
      if (call.retry_of) {
        data.retry_of = call.retry_of;
      }
    }

    let turnNumber = primary.turn;
    const payloadRecord = row.payload as Record<string, unknown> | null;
    if (turnNumber == null && typeof payloadRecord?.turn === 'number') {
      turnNumber = payloadRecord.turn;
    } else if (turnNumber == null && typeof payloadRecord?.turn_index === 'number') {
      turnNumber = payloadRecord.turn_index;
    }
    if (turnNumber != null) {
      data.turn = turnNumber;
    }

    const startedAt = primary.started_at ?? call?.started_at ?? row.started_at;
    if (startedAt) {
      data.started_at = startedAt;
    }
    const endedAt = primary.ended_at ?? result?.ended_at ?? row.ended_at;
    if (endedAt) {
      data.ended_at = endedAt;
    }

    if (call?.payload?.input !== undefined) {
      data.input = parseJsonIfString(call.payload.input);
    } else if (row.payload?.input !== undefined) {
      data.input = parseJsonIfString(row.payload.input);
    }

    if (result?.payload?.output !== undefined) {
      data.output = parseJsonIfString(result.payload.output);
    } else if (row.payload?.output !== undefined) {
      data.output = parseJsonIfString(row.payload.output);
    }

    const sources = stringList(
      result?.payload?.sources ?? call?.payload?.sources ?? row.payload?.sources,
    );
    if (sources.length > 0) {
      data.sources = sources;
    }

    if (result?.payload?.error_message) {
      data.error_message = result.payload.error_message;
    }
    if (result?.payload?.truncated) {
      data.truncated = true;
      if (result.payload.output_len_chars != null) {
        data.output_len_chars = result.payload.output_len_chars;
      }
    }

    return data;
  }

  // Generic fallback for non-tool event rows
  const data: Record<string, unknown> = {
    event_type: row.event_type,
  };
  if (row.started_at) {
    data.started_at = row.started_at;
  }
  if (row.ended_at) {
    data.ended_at = row.ended_at;
  }
  if (row.duration_ms != null) {
    data.duration_ms = row.duration_ms;
  }
  if (row.ok != null) {
    data.ok = row.ok;
  }
  if (row.payload) {
    data.payload = row.payload;
  }
  return data;
}
