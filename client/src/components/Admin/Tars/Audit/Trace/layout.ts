import { format } from 'date-fns';
import { TARS_TRACE_EVENT, TARS_MESSAGE_STATUS } from 'librechat-data-provider';
import type { TTarsJsonField, TTarsMessageTrace, TTarsTraceRow } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { formatJSON } from '~/utils/json';
import { ownValue } from './values';

/**
 * Pure timeline layout and label helpers for the audit trace view — a port of
 * pwc_tars `AgentTrace/traceTimelineLayout.mjs`. Function names and semantics are
 * kept identical so a change there can be carried over here one for one, the
 * `TYPE_*` / `MESSAGE_STATUS_*` names included; the rest of the view reads
 * `TARS_TRACE_EVENT` / `TARS_MESSAGE_STATUS` directly. LibreChat's own helpers
 * live in the purpose-named files beside this one (`outcome`, `time`,
 * `documents`, `history`, `json`), so this file never mixes in code pwc_tars
 * does not have.
 */

export type Localize = (key: TranslationKeys, options?: Record<string, string | number>) => string;

export type TraceTrack = 'model' | 'tool';

/** A trace row placed on the chart: ms offsets from the trace's earliest timestamp. */
export type ChartRow = TTarsTraceRow & {
  _start: number;
  _end: number;
  _track: TraceTrack;
  _lane?: number;
};

export type StatusMarker = TTarsTraceRow & { _start: number };

export type ChartLayout = {
  rows: ChartRow[];
  total: number;
  baseMs: number;
  requestSentByTurn: Record<number, number>;
  statusMarkers: StatusMarker[];
};

export type WaitRegion = { turn: number; start: number; end: number; lane: number };

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** Port names for the shared `message_execution_trace` contract (data-provider `TARS_TRACE_EVENT`). */
export const TYPE_TOOL_CALL = TARS_TRACE_EVENT.toolCall;
export const TYPE_TOOL_RESULT = TARS_TRACE_EVENT.toolResult;
export const TYPE_THINKING = TARS_TRACE_EVENT.thinking;
export const TYPE_TEXT = TARS_TRACE_EVENT.text;
export const TYPE_TURN = TARS_TRACE_EVENT.turn;
export const TYPE_LANGFLOW_ROUTE = TARS_TRACE_EVENT.langflowRoute;
export const TYPE_RAG_RETRIEVAL = TARS_TRACE_EVENT.ragRetrieval;
export const TYPE_STATUS = TARS_TRACE_EVENT.status;
export const TYPE_PLAN = TARS_TRACE_EVENT.plan;
export const TYPE_CLARIFICATION = TARS_TRACE_EVENT.clarification;
export const TYPE_MESSAGE_STOP = TARS_TRACE_EVENT.messageStop;
export const TYPE_SUGGESTED_QUESTIONS = TARS_TRACE_EVENT.suggestedQuestions;
export const TYPE_REGENERATE_NOT_APPLIED = TARS_TRACE_EVENT.regenerateNotApplied;
/** A fatal error that ended the run (agent_error, stream_stall...). */
export const TYPE_ERROR = TARS_TRACE_EVENT.error;

/** pwc_tars `SysConst.SUCCESS` / `FAILED` / `INTERRUPTED` (data-provider `TARS_MESSAGE_STATUS`). */
export const MESSAGE_STATUS_SUCCESS = TARS_MESSAGE_STATUS.success;
export const MESSAGE_STATUS_FAILED = TARS_MESSAGE_STATUS.failed;
export const MESSAGE_STATUS_INTERRUPTED = TARS_MESSAGE_STATUS.interrupted;
const MESSAGE_STATUS_LABEL_KEY: Record<number, TranslationKeys> = {
  [MESSAGE_STATUS_SUCCESS]: 'com_ui_tars_audit_trace_completed',
  [MESSAGE_STATUS_FAILED]: 'com_ui_tars_audit_trace_status_failed',
  [MESSAGE_STATUS_INTERRUPTED]: 'com_ui_tars_audit_trace_aborted',
};

/**
 * A null `code` falls back to abortedFallback. SUCCESS is ignored when
 * abortedFallback is true (an unapplied regenerate on an empty response);
 * FAILED/INTERRUPTED still win as the more specific label.
 */
export function statusLabel(
  t: Localize,
  code: number | null | undefined,
  abortedFallback: boolean,
): string {
  const key = ownValue(MESSAGE_STATUS_LABEL_KEY, code);
  if (key && !(abortedFallback && code === MESSAGE_STATUS_SUCCESS)) {
    return t(key);
  }
  return abortedFallback
    ? t('com_ui_tars_audit_trace_aborted')
    : t('com_ui_tars_audit_trace_completed');
}

function offsetMs(baseMs: number, iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time - baseMs;
}

/**
 * A status with a parent_id is tool progress: already covered by that tool's
 * own bar, and one tool can emit many, which would just crowd the chart.
 */
function isTimelineStatus(row: TTarsTraceRow): boolean {
  return row.event_type === TYPE_STATUS && !row.parent_id;
}

/**
 * Timeline chart rows, ms offsets from the trace's own earliest timestamp.
 * turn events only mark when each request went out (no bar of their own); one
 * bar per tool_use_id — call+result share a slot, result's span wins when both
 * exist; a langflow_route gets one bar for the whole external flow.
 */
export function buildChartRows(trace: TTarsTraceRow[]): ChartLayout {
  /** An unreadable timestamp would make the base NaN and blank every bar; its row is skipped instead. */
  const times = trace
    .map((row) => (row.started_at ? new Date(row.started_at).getTime() : NaN))
    .filter((time) => !Number.isNaN(time));
  if (times.length === 0) {
    return { rows: [], total: 1, baseMs: 0, requestSentByTurn: {}, statusMarkers: [] };
  }
  /** A loop rather than `Math.min(...times)`, which throws past the engine's argument limit. */
  const baseMs = times.reduce((min, time) => (time < min ? time : min), Infinity);
  const span = (row: TTarsTraceRow) => {
    const start = offsetMs(baseMs, row.started_at);
    return { start, end: offsetMs(baseMs, row.ended_at) ?? start };
  };

  const rows: ChartRow[] = [];
  const requestSentByTurn: Record<number, number> = {};
  const toolCallsById = new Map<string | null, TTarsTraceRow>();
  const toolResultsById = new Map<string | null, TTarsTraceRow>();
  const langflowRows: ChartRow[] = [];
  const statusMarkers: StatusMarker[] = [];

  for (const row of trace) {
    const { start, end } = span(row);
    if (row.event_type === TYPE_THINKING || row.event_type === TYPE_TEXT) {
      if (start != null) {
        rows.push({ ...row, _start: start, _end: end ?? start, _track: 'model' });
      }
    } else if (row.event_type === TYPE_TURN) {
      /** TurnStart.started_at is when the request went out; a model bar starts at its first chunk. */
      if (start != null && row.turn != null) {
        requestSentByTurn[row.turn] = start;
      }
    } else if (row.event_type === TYPE_TOOL_CALL) {
      toolCallsById.set(row.tool_use_id, row);
    } else if (row.event_type === TYPE_TOOL_RESULT) {
      toolResultsById.set(row.tool_use_id, row);
    } else if (row.event_type === TYPE_LANGFLOW_ROUTE) {
      /** A Langflow-routed message has only one span; it sits on the tool track so the chart is not empty. */
      if (start != null) {
        langflowRows.push({ ...row, _start: start, _end: end ?? start, _track: 'tool' });
      }
    } else if (isTimelineStatus(row) && start != null) {
      statusMarkers.push({ ...row, _start: start });
    }
  }

  const toolUseIds = new Set([...toolCallsById.keys(), ...toolResultsById.keys()]);
  for (const id of toolUseIds) {
    const primary = toolResultsById.get(id) ?? toolCallsById.get(id);
    if (!primary) {
      continue;
    }
    const { start, end } = span(primary);
    if (start != null) {
      rows.push({ ...primary, _start: start, _end: end ?? start, _track: 'tool' });
    }
  }
  rows.push(...langflowRows);

  let total = 1;
  for (const row of rows) {
    total = Math.max(total, row._end, row._start);
  }
  for (const marker of statusMarkers) {
    total = Math.max(total, marker._start);
  }
  return { rows, total, baseMs, requestSentByTurn, statusMarkers };
}

/**
 * Asymmetric on purpose: zero padding on the left lines the 0s tick up with the
 * track's own first gridline, while the right keeps the last label inside.
 */
const PAD_LEFT = 0;
const PAD_RIGHT = 5;
export const pct = (ms: number, total: number): number =>
  PAD_LEFT + (Math.max(0, ms) / total) * (100 - PAD_LEFT - PAD_RIGHT);

/**
 * Nice-number tick spacing (1-2-5-10 x 10^n) rather than total/count, which
 * would produce unreadable steps like 0.94s.
 */
function niceResidual(residual: number): number {
  if (residual >= 5) {
    return 10;
  }
  if (residual >= 2) {
    return 5;
  }
  return residual >= 1 ? 2 : 1;
}

export function computeNiceTicks(
  totalMs: number,
  targetTickCount = 5,
): { step: number; ticks: number[] } {
  if (!(totalMs > 0)) {
    return { step: 1, ticks: [0] };
  }
  const rawStep = totalMs / targetTickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  /** Without the 1ms floor a sub-millisecond step rounds to the same label on adjacent ticks. */
  const step = Math.max(1, niceResidual(residual) * magnitude);
  const ticks: number[] = [];
  /** `<= totalMs`: pct() maps totalMs to the lane's right edge, so a later tick would overflow. */
  for (let tick = 0; tick <= totalMs; tick += step) {
    ticks.push(tick);
  }
  return { step, ticks };
}

/** Unit follows the step, not the value: a step >= 1s always lands on whole seconds. */
export function fmtElapsedTick(ms: number, step: number, localize: Localize): string {
  if (step >= 1000) {
    return localize('com_ui_tars_audit_trace_tick_seconds', { value: Math.round(ms / 1000) });
  }
  return localize('com_ui_tars_audit_trace_tick_ms', { value: Math.round(ms) });
}

/**
 * Greedy interval-scheduling lane assignment so concurrent bars (e.g. parallel
 * tool calls) stack into separate rows instead of overlapping. Writes `_lane`
 * onto each item and returns the lane count.
 */
export function assignLanes(items: ChartRow[]): number {
  const sorted = [...items].sort((a, b) => a._start - b._start);
  const laneEnds: number[] = [];
  for (const row of sorted) {
    let lane = laneEnds.findIndex((end) => end <= row._start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(row._end);
    } else {
      laneEnds[lane] = row._end;
    }
    row._lane = lane;
  }
  return Math.max(1, laneEnds.length);
}

/** Per-lane height; a track row's min height is this times its lane count. */
export const LANE_HEIGHT_PX = 40;
export const NESTED_LANE_HEIGHT_PX = 30;
const LANE_INSET_PX = 3;

/** Absolute top/bottom (px) for an item in `lane` of a row `laneCount × laneHeight` tall. */
export function laneBox(
  lane: number | undefined,
  laneCount: number,
  laneHeight: number,
): { top: number; bottom: number } {
  const count = Math.max(1, laneCount);
  const index = Math.min(Math.max(lane ?? 0, 0), count - 1);
  return {
    top: index * laneHeight + LANE_INSET_PX,
    bottom: (count - index - 1) * laneHeight + LANE_INSET_PX,
  };
}

function fmtJsonValue(value: TTarsJsonField | undefined): string {
  if (Array.isArray(value)) {
    return `[${value.map(fmtJsonValue).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${fmtJsonValue(entry)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * One-line JSON with a space after every colon and comma, nested values
 * included. undefined renders as null; anything but a plain object renders as {}.
 */
export function fmtJsonInline(obj: TTarsJsonField | undefined): string {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return '{}';
  }
  return fmtJsonValue(obj);
}

/** Under a second in milliseconds, otherwise in seconds to two places. */
export function fmtMs(ms: number | null | undefined, localize: Localize): string {
  if (ms == null) {
    return '—';
  }
  if (ms < 1000) {
    return localize('com_ui_tars_audit_trace_duration_ms', { value: ms });
  }
  return localize('com_ui_tars_audit_trace_duration_seconds', { value: (ms / 1000).toFixed(2) });
}

/** HH:mm:ss.SSS of an ISO timestamp or epoch ms; '—' for anything a Date cannot hold. */
export function fmtClock(value: string | number | null | undefined): string {
  if (value == null || value === '') {
    return '—';
  }
  try {
    return format(new Date(value), 'HH:mm:ss.SSS');
  } catch {
    return '—';
  }
}

export function fmtValue(value: TTarsJsonField | undefined): string {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  const str = String(value ?? '');
  return formatJSON(str);
}

const HISTORY_ROLE_LABEL_KEY: Record<string, TranslationKeys> = {
  user: 'com_ui_tars_audit_trace_role_user',
  assistant: 'com_ui_tars_audit_trace_role_assistant',
  system: 'com_ui_tars_audit_trace_role_system',
  tool: 'com_ui_tars_audit_trace_role_tool',
};
export function historyRoleLabel(t: Localize, role: string | null | undefined): string {
  const key = ownValue(HISTORY_ROLE_LABEL_KEY, role);
  return key ? t(key) : role || t('com_ui_tars_audit_trace_role_unknown');
}

/** Each backend emit site picks its own Status.kind, so an unknown kind shows raw. */
const STATUS_KIND_LABEL_KEY: Record<string, TranslationKeys> = {
  limit: 'com_ui_tars_audit_trace_status_kind_limit',
  retry: 'com_ui_tars_audit_trace_status_kind_retry',
  compact: 'com_ui_tars_audit_trace_status_kind_compact',
  warning: 'com_ui_tars_audit_trace_status_kind_warning',
  /** A message the user sent mid-run in LibreChat (steer). */
  steer: 'com_ui_tars_audit_trace_status_kind_steer',
};
export function statusKindLabel(t: Localize, kind: string | null | undefined): string {
  const key = ownValue(STATUS_KIND_LABEL_KEY, kind);
  return key ? t(key) : kind || '—';
}

const PLAN_STATUS_LABEL_KEY: Record<string, TranslationKeys> = {
  pending: 'com_ui_tars_audit_trace_plan_pending',
  in_progress: 'com_ui_tars_audit_trace_plan_in_progress',
  completed: 'com_ui_tars_audit_trace_plan_completed',
};
export function planStatusLabel(t: Localize, status: string | null | undefined): string {
  const key = ownValue(PLAN_STATUS_LABEL_KEY, status);
  return key ? t(key) : status || '—';
}

/**
 * The vLLM message format allows `content` to be a list of parts (text mixed
 * with image_url), so it is flattened for reading rather than reconstructed.
 */
export function historyContentText(content: TTarsJsonField | undefined): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && !Array.isArray(part)) {
          if (typeof part.text === 'string') {
            return part.text;
          }
          if (typeof part.type === 'string') {
            return `[${part.type}]`;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : String(content);
}

/** Pairs a tool_call with its tool_result by shared tool_use_id. */
export function pairedToolRows(
  trace: TTarsTraceRow[],
  toolUseId: string | null | undefined,
): { call: TTarsTraceRow | undefined; result: TTarsTraceRow | undefined } {
  let call: TTarsTraceRow | undefined;
  let result: TTarsTraceRow | undefined;
  for (const row of trace) {
    if (row.tool_use_id !== toolUseId) {
      continue;
    }
    if (row.event_type === TYPE_TOOL_CALL && !call) {
      call = row;
    } else if (row.event_type === TYPE_TOOL_RESULT && !result) {
      result = row;
    }
  }
  return { call, result };
}

const REASONING_EFFORT_KEY_MAP: Record<string, TranslationKeys> = {
  default: 'com_ui_tars_audit_trace_default_value',
  auto: 'com_ui_auto',
  none: 'com_ui_none',
  minimal: 'com_ui_minimal',
  low: 'com_ui_low',
  medium: 'com_ui_medium',
  high: 'com_ui_high',
  xhigh: 'com_ui_xhigh',
  max: 'com_ui_max',
  off: 'com_ui_tars_audit_trace_off',
};

/**
 * Maps reasoning effort to localized display copy. Unset or 'off' maps to
 * 'off', 'default' to '預設值' / 'Default', and standard levels to LibreChat's
 * parameter options ('低', '中', '高', etc.).
 */
export function reasoningEffortLabel(t: Localize, value: string | null | undefined): string {
  if (!value) {
    return t('com_ui_tars_audit_trace_off');
  }
  const key = ownValue(REASONING_EFFORT_KEY_MAP, value.toLowerCase().trim());
  if (key) {
    return t(key);
  }
  return value;
}

export function labelForRow(t: Localize, row: TTarsTraceRow): string {
  if (row.tool_name) {
    return row.tool_name;
  }
  if (row.event_type === TYPE_THINKING) {
    return t('com_ui_tars_audit_trace_thinking');
  }
  if (row.event_type === TYPE_TEXT) {
    return t('com_ui_tars_audit_trace_generate_answer');
  }
  if (row.event_type === TYPE_TURN) {
    return t('com_ui_tars_audit_trace_turn_n', { turn: row.turn ?? '' });
  }
  if (row.event_type === TYPE_LANGFLOW_ROUTE) {
    return 'Langflow';
  }
  return row.event_type;
}

export type MessageOutcome = {
  notAppliedRow: TTarsTraceRow | undefined;
  statusCode: number | null | undefined;
  errorMessage: string | null | undefined;
  isAborted: boolean;
};

/**
 * Which run the status/error shown on the card describes. When the API had
 * nothing but unapplied regenerates to serve, message.status/error_message
 * describe an earlier run, so the marker's own outcome wins — and that attempt
 * never produced the stored answer, even with status SUCCESS. Otherwise
 * message.status is authoritative; "no response means aborted" is only a
 * fallback, and it cannot tell a user stop from a fatal error.
 */
export function resolveMessageOutcome(
  trace: TTarsTraceRow[],
  message: TTarsMessageTrace['message'],
): MessageOutcome {
  const notAppliedRow = trace.find((row) => row.event_type === TYPE_REGENERATE_NOT_APPLIED);
  if (notAppliedRow) {
    return {
      notAppliedRow,
      statusCode: notAppliedRow.payload?.aborted
        ? MESSAGE_STATUS_INTERRUPTED
        : notAppliedRow.payload?.status,
      errorMessage: notAppliedRow.payload?.error_message,
      isAborted: true,
    };
  }
  return {
    notAppliedRow: undefined,
    statusCode: message.status,
    errorMessage: message.error_message,
    isAborted:
      message.status != null ? message.status !== MESSAGE_STATUS_SUCCESS : !message.response,
  };
}

/**
 * Tool chart rows split into top-level calls and delegate sub-calls keyed by
 * parent. Nesting is decided from the raw trace, not the chart rows: a merged
 * row there may already carry the tool_result event_type instead of the call's.
 */
export function groupToolRows(
  trace: TTarsTraceRow[],
  rows: ChartRow[],
): { topToolRows: ChartRow[]; nestedByParent: Record<string, ChartRow[]> } {
  const allToolUseIds = new Set(
    trace
      .filter((row) => row.event_type === TYPE_TOOL_CALL || row.event_type === TYPE_TOOL_RESULT)
      .map((row) => row.tool_use_id),
  );
  const topToolRows: ChartRow[] = [];
  const nestedByParent: Record<string, ChartRow[]> = {};
  for (const row of rows) {
    if (row._track !== 'tool') {
      continue;
    }
    if (row.parent_id && allToolUseIds.has(row.parent_id)) {
      (nestedByParent[row.parent_id] ??= []).push(row);
    } else {
      topToolRows.push(row);
    }
  }
  return { topToolRows, nestedByParent };
}

/**
 * Top-level call count plus a success/fail split that always sums to it. A call
 * with no failure counts as success, including one aborted before its result
 * arrived — a deliberate simplification. A delegate's own sub-calls failing does
 * not make the delegate call itself a failure.
 */
export function toolCallStats(topToolRows: ChartRow[]): {
  toolCallTotal: number;
  toolSuccessCount: number;
  toolFailDisplayCount: number;
  toolCallTone: Tone | null;
} {
  const failCount = topToolRows.filter((row) => row.ok === false).length;
  const toolCallTotal = topToolRows.length;
  const toolSuccessCount = toolCallTotal - failCount;
  return {
    toolCallTotal,
    toolSuccessCount,
    toolFailDisplayCount: failCount,
    toolCallTone: toolCallTone(toolCallTotal, failCount),
  };
}

function toolCallTone(total: number, failCount: number): Tone | null {
  if (total === 0) {
    return null;
  }
  if (failCount === 0) {
    return 'good';
  }
  return failCount === total ? 'bad' : 'warn';
}

/**
 * request_raw over AGENT_TRACE_OUTPUT_MAX_CHARS is stored as payload: null +
 * payload_truncated: true. Its switches are then unknown, not off: reading {}
 * would show every switch as off, and suggested questions (off only when
 * explicitly false) as on. Callers show requestFlag's null as "—".
 */
export function resolveRawRequest(requestRawRow: TTarsTraceRow | undefined) {
  const rawTruncated = requestRawRow?.payload?.payload_truncated === true;
  return {
    rawPayload: requestRawRow?.payload?.payload ?? {},
    rawTruncated,
    rawOriginalChars: rawTruncated
      ? (requestRawRow?.payload?.payload_original_chars ?? null)
      : null,
  };
}

/** true / false, or null when the raw request was truncated and the value is unknown. */
export function requestFlag(rawTruncated: boolean, value: unknown): boolean | null {
  return rawTruncated ? null : !!value;
}

/**
 * file_generate_style_spec as [key, value] pairs with empty values dropped. The
 * client may send it as a JSON string; the backend parses that the same way and
 * ignores anything that is not an object, so so does this.
 */
export function styleSpecEntries(spec: TTarsJsonField | undefined): [string, string][] {
  let parsed: TTarsJsonField | undefined = spec;
  if (typeof spec === 'string') {
    try {
      parsed = JSON.parse(spec) as TTarsJsonField;
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }
  return Object.entries(parsed)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => [
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    ]);
}

/**
 * The gap between each turn's request going out and its first model bar, placed
 * on that bar's lane, so assignLanes must already have run. A turn that goes
 * straight to a tool has no model bar to close the region against, so it gets
 * none — a known limit of needing two endpoints.
 */
export function buildWaitRegions(
  modelRows: ChartRow[],
  requestSentByTurn: Record<number, number>,
): WaitRegion[] {
  const earliestModelRowByTurn = new Map<number | null, ChartRow>();
  for (const row of modelRows) {
    const current = earliestModelRowByTurn.get(row.turn);
    if (!current || row._start < current._start) {
      earliestModelRowByTurn.set(row.turn, row);
    }
  }
  const regions: WaitRegion[] = [];
  for (const [turnKey, waitStart] of Object.entries(requestSentByTurn)) {
    const turn = Number(turnKey);
    const firstRow = earliestModelRowByTurn.get(turn);
    if (firstRow && firstRow._start > waitStart) {
      regions.push({ turn, start: waitStart, end: firstRow._start, lane: firstRow._lane ?? 0 });
    }
  }
  return regions;
}
