import { TARS_TRACE_EVENT } from 'librechat-data-provider';
import type { TTarsMessageTrace, TTarsTraceRow } from 'librechat-data-provider';
import type { ChartLayout, ChartRow, MessageOutcome, Tone, WaitRegion } from './layout';
import type { HistoryTurnEntry } from './history';
import {
  pct,
  assignLanes,
  groupToolRows,
  toolCallStats,
  buildChartRows,
  buildWaitRegions,
  computeNiceTicks,
  resolveRawRequest,
  styleSpecEntries,
  resolveMessageOutcome,
} from './layout';
import { annotateHistoryTurns } from './history';
import { computeToolWaitDuration } from './time';

/** Only reasons that mean the answer may be incomplete; a normal stop happens every turn. */
const NOTEWORTHY_FINISH_REASONS = new Set(['length', 'content_filter', 'max_tokens']);

/** Web tools put URLs in `sources`, knowledge_search puts file names there. */
const WEB_TOOL_NAMES = new Set(['web_search', 'web_fetch']);

export type TraceSummary = MessageOutcome &
  ReturnType<typeof resolveRawRequest> & {
    trace: TTarsTraceRow[];
    message: TTarsMessageTrace['message'];
    user: TTarsMessageTrace['user'];
    conversationHistory: TTarsMessageTrace['conversation_history'];
    unappliedRegenerateCount: number;
    chart: ChartLayout;
    isLangflowRoute: boolean;
    queryText: string | null | undefined;
    requestRow: TTarsTraceRow | undefined;
    provenanceRow: TTarsTraceRow | undefined;
    memoryRow: TTarsTraceRow | undefined;
    longTermRow: TTarsTraceRow | undefined;
    toolContextRow: TTarsTraceRow | undefined;
    ragRows: TTarsTraceRow[];
    clarificationRow: TTarsTraceRow | undefined;
    planRow: TTarsTraceRow | undefined;
    suggestedRow: TTarsTraceRow | undefined;
    notableStops: TTarsTraceRow[];
    errorRows: TTarsTraceRow[];
    degradationNotes: string[];
    styleEntries: [string, string][];
    webSources: string[];
    totalIn: number;
    totalOut: number;
    generationDurationMs: number;
    tps: number | null;
    promptTps: number | null;
    modelDurationMs: number;
    modelPercent: number | null;
    toolWaitDurationMs: number;
    toolWaitPercent: number | null;
    toolSuccessWaitMs: number;
    toolSuccessPercent: number | null;
    toolFailWaitMs: number;
    toolFailPercent: number | null;
    otherPercent: number | null;
    otherWaitMs: number;
    totalDurationMs: number;
    finishReason: string | null;
    historyTurns: number;
    historyMessageCount: number;
    hasContextCompaction: boolean;
    hasTurnLimit: boolean;
    annotatedHistory: HistoryTurnEntry[];
    modelRows: ChartRow[];
    topToolRows: ChartRow[];
    nestedByParent: Record<string, ChartRow[]>;
    modelLanes: number;
    topToolLanes: number;
    nestedLaneCounts: Record<string, number>;
    waitRegions: WaitRegion[];
    tickStep: number;
    chartTicks: number[];
    toolCallTotal: number;
    toolSuccessCount: number;
    toolFailDisplayCount: number;
    toolCallTone: Tone | null;
  };

/** A share of the run's time as a percentage with one decimal, held to 0–100. */
const percentOf = (partMs: number, totalMs: number): number =>
  Math.min(100, Math.max(0, Number(((partMs / totalMs) * 100).toFixed(1))));

/** The time-breakdown percentages; each is null when that share took no time. */
type TimeShares = Pick<
  TraceSummary,
  'modelPercent' | 'toolWaitPercent' | 'toolSuccessPercent' | 'toolFailPercent' | 'otherPercent'
>;

/**
 * Splits the run's time into model, tool (by outcome) and other. When both
 * outcomes occurred, rounding to one decimal can swallow the smaller one, so a
 * share that took real time is kept at 0.1% or more — as long as the tool share
 * (at least 0.2%) leaves room for both.
 */
function timeShares(input: {
  totalDurationMs: number;
  modelDurationMs: number;
  toolWaitDurationMs: number;
  toolSuccessWaitMs: number;
  toolFailWaitMs: number;
  hasSuccessfulTools: boolean;
  hasFailedTools: boolean;
}): TimeShares {
  const { totalDurationMs, modelDurationMs, toolWaitDurationMs } = input;
  const shares: TimeShares = {
    modelPercent: null,
    toolWaitPercent: null,
    toolSuccessPercent: null,
    toolFailPercent: null,
    otherPercent: null,
  };
  if (totalDurationMs <= 0) {
    return shares;
  }
  if (modelDurationMs > 0) {
    shares.modelPercent = percentOf(modelDurationMs, totalDurationMs);
  }
  if (toolWaitDurationMs > 0) {
    const toolPercent = percentOf(toolWaitDurationMs, totalDurationMs);
    shares.toolWaitPercent = toolPercent;
    if (!input.hasFailedTools) {
      shares.toolSuccessPercent = toolPercent;
    } else if (!input.hasSuccessfulTools) {
      shares.toolFailPercent = toolPercent;
    } else {
      let success = Number(((input.toolSuccessWaitMs / totalDurationMs) * 100).toFixed(1));
      if (toolPercent >= 0.2) {
        if (input.toolFailWaitMs > 0 && success >= toolPercent) {
          success = Number((toolPercent - 0.1).toFixed(1));
        } else if (input.toolSuccessWaitMs > 0 && success <= 0) {
          success = 0.1;
        }
      }
      shares.toolSuccessPercent = Math.min(toolPercent, Math.max(0, success));
      shares.toolFailPercent = Number(
        Math.max(0, toolPercent - shares.toolSuccessPercent).toFixed(1),
      );
    }
  }
  const remaining = Math.max(0, 100 - (shares.modelPercent ?? 0) - (shares.toolWaitPercent ?? 0));
  shares.otherPercent = Number(remaining.toFixed(1));
  return shares;
}

/**
 * Time to the final reply's first token, from the best evidence the trace has:
 * the wait region before that turn's output, else the request time recorded for
 * its turn, else the request row's timestamp, else the reply's chart offset.
 */
function firstTokenMs(
  finalReplyRow: ChartRow | undefined,
  waitRegions: WaitRegion[],
  requestSentByTurn: ChartLayout['requestSentByTurn'],
  requestRow: TTarsTraceRow | undefined,
): number | null {
  const finalWait =
    (finalReplyRow?.turn != null
      ? waitRegions.find((r) => r.turn === finalReplyRow.turn)
      : undefined) ?? waitRegions[waitRegions.length - 1];
  if (finalWait && finalWait.end > finalWait.start) {
    return Math.round(finalWait.end - finalWait.start);
  }
  if (!finalReplyRow) {
    return null;
  }
  const requestSent =
    finalReplyRow.turn != null ? requestSentByTurn[finalReplyRow.turn] : undefined;
  if (requestSent != null && finalReplyRow._start > requestSent) {
    return Math.round(finalReplyRow._start - requestSent);
  }
  if (requestRow?.started_at && finalReplyRow.started_at) {
    const requestTime = new Date(requestRow.started_at).getTime();
    const replyTime = new Date(finalReplyRow.started_at).getTime();
    if (!Number.isNaN(requestTime) && !Number.isNaN(replyTime) && replyTime >= requestTime) {
      return replyTime - requestTime;
    }
    return null;
  }
  return finalReplyRow._start > 0 ? Math.round(finalReplyRow._start) : null;
}

/** A row's span: its recorded duration, else the gap between its chart offsets. */
const spanMs = (row: ChartRow): number =>
  row.duration_ms ?? Math.max(0, (row._end ?? 0) - (row._start ?? 0));

/** Tokens per second, or null when either side is missing. */
const perSecond = (tokens: number, durationMs: number | null): number | null =>
  tokens > 0 && durationMs != null && durationMs > 0
    ? Number(((tokens / durationMs) * 1000).toFixed(2))
    : null;

/**
 * Everything the card and the plain-text report derive from one trace,
 * computed once in a single pass over the rows (event_type/payload shapes match
 * pwc_tars `events.py`'s `to_trace`).
 */
export function summarizeTrace(data: TTarsMessageTrace): TraceSummary {
  const { trace, message } = data;
  const firsts = new Map<string, TTarsTraceRow>();
  const ragRows: TTarsTraceRow[] = [];
  const usageRows: TTarsTraceRow[] = [];
  const notableStops: TTarsTraceRow[] = [];
  const errorRows: TTarsTraceRow[] = [];
  const webSourceSet = new Set<string>();
  let lastStopRow: TTarsTraceRow | undefined;
  let planRow: TTarsTraceRow | undefined;
  let isLangflowRoute = false;
  let hasContextCompaction = false;
  let hasTurnLimit = false;
  let totalIn = 0;
  let totalOut = 0;

  for (const row of trace) {
    if (!firsts.has(row.event_type)) {
      firsts.set(row.event_type, row);
    }
    switch (row.event_type) {
      case TARS_TRACE_EVENT.usage:
        usageRows.push(row);
        totalIn += row.payload?.input_tokens ?? 0;
        totalOut += row.payload?.output_tokens ?? 0;
        break;
      case TARS_TRACE_EVENT.ragRetrieval:
        ragRows.push(row);
        break;
      /** todo_write emits a Plan per update; only the last one is the final list. */
      case TARS_TRACE_EVENT.plan:
        planRow = row;
        break;
      case TARS_TRACE_EVENT.messageStop:
        lastStopRow = row;
        if (NOTEWORTHY_FINISH_REASONS.has(row.payload?.finish_reason ?? '')) {
          notableStops.push(row);
        }
        break;
      case TARS_TRACE_EVENT.error:
        errorRows.push(row);
        break;
      case TARS_TRACE_EVENT.langflowRoute:
        isLangflowRoute = true;
        break;
      case TARS_TRACE_EVENT.status:
        hasContextCompaction ||= row.payload?.kind === 'compact';
        hasTurnLimit ||= row.payload?.kind === 'limit';
        break;
      case TARS_TRACE_EVENT.toolResult:
        /** The same URL can be hit by more than one call, hence the set. */
        if (row.tool_name && WEB_TOOL_NAMES.has(row.tool_name)) {
          row.payload?.sources?.forEach((url) => webSourceSet.add(url));
        }
        break;
      default:
        break;
    }
  }

  const raw = resolveRawRequest(firsts.get(TARS_TRACE_EVENT.requestRaw));
  const requestRow = firsts.get(TARS_TRACE_EVENT.request);
  const provenanceRow = firsts.get(TARS_TRACE_EVENT.provenance);
  const chart = buildChartRows(trace);
  const { topToolRows, nestedByParent } = groupToolRows(trace, chart.rows);
  const modelRows = chart.rows.filter((row) => row._track === 'model');
  const modelLanes = assignLanes(modelRows);
  const topToolLanes = assignLanes(topToolRows);
  const nestedLaneCounts: Record<string, number> = {};
  for (const [parentId, rows] of Object.entries(nestedByParent)) {
    nestedLaneCounts[parentId] = assignLanes(rows);
  }
  const { step: tickStep, ticks: chartTicks } = computeNiceTicks(chart.total);

  /** Speeds describe the final reply: its own turn's usage, else the last one recorded. */
  const textRows = modelRows.filter((row) => row.event_type === TARS_TRACE_EVENT.text);
  const finalReplyRow = textRows[textRows.length - 1] ?? modelRows[modelRows.length - 1];
  const finalUsageRow =
    (finalReplyRow?.turn != null
      ? usageRows.find((row) => row.turn === finalReplyRow.turn)
      : undefined) ?? usageRows[usageRows.length - 1];
  const finalReplyOut = finalUsageRow?.payload?.output_tokens ?? totalOut;
  const finalPromptIn = finalUsageRow?.payload?.input_tokens ?? totalIn;

  const modelExecDurationMs = modelRows.reduce((sum, row) => sum + spanMs(row), 0);
  const latencyMs = Math.round((message.response_latency ?? 0) * 1000);
  let generationDurationMs = finalReplyRow ? spanMs(finalReplyRow) : 0;
  if (generationDurationMs <= 0) {
    generationDurationMs = modelExecDurationMs > 0 ? modelExecDurationMs : latencyMs;
  }

  const waitRegions = buildWaitRegions(modelRows, chart.requestSentByTurn);
  const ttftMs = firstTokenMs(finalReplyRow, waitRegions, chart.requestSentByTurn, requestRow);

  const history = data.conversation_history ?? [];
  const historyTurns = history.filter((m) => m.role === 'user').length;
  const historyMessageCount = history.length;
  const annotatedHistory = annotateHistoryTurns(history);

  const totalWaitRegionsMs = waitRegions.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0);
  const modelWaitDurationMs = totalWaitRegionsMs > 0 ? totalWaitRegionsMs : (ttftMs ?? 0);
  const modelDurationMs = modelExecDurationMs + modelWaitDurationMs;

  const toolWaitDurationMs = computeToolWaitDuration(topToolRows);
  const successToolRows = topToolRows.filter((r) => r.ok !== false);
  const failedToolRows = topToolRows.filter((r) => r.ok === false);
  const toolSuccessWaitMs = computeToolWaitDuration(successToolRows);
  const toolFailWaitMs = computeToolWaitDuration(failedToolRows);
  /** The recorded latency, else the chart's span; never less than the time accounted for. */
  let totalDurationMs = latencyMs;
  if (totalDurationMs <= 0 && chart.total > 1) {
    totalDurationMs = chart.total;
  }
  totalDurationMs = Math.max(totalDurationMs, modelDurationMs + toolWaitDurationMs);

  return {
    ...resolveMessageOutcome(trace, message),
    ...raw,
    ...toolCallStats(topToolRows),
    ...timeShares({
      totalDurationMs,
      modelDurationMs,
      toolWaitDurationMs,
      toolSuccessWaitMs,
      toolFailWaitMs,
      hasSuccessfulTools: successToolRows.length > 0,
      hasFailedTools: failedToolRows.length > 0,
    }),
    trace,
    message,
    user: data.user,
    conversationHistory: history,
    unappliedRegenerateCount: data.unapplied_regenerate_count ?? 0,
    chart,
    isLangflowRoute,
    queryText: message.query || requestRow?.payload?.query,
    requestRow,
    provenanceRow,
    memoryRow: firsts.get(TARS_TRACE_EVENT.memoryContext),
    longTermRow: firsts.get(TARS_TRACE_EVENT.longTermMemory),
    toolContextRow: firsts.get(TARS_TRACE_EVENT.toolContextReplay),
    ragRows,
    clarificationRow: firsts.get(TARS_TRACE_EVENT.clarification),
    planRow,
    suggestedRow: firsts.get(TARS_TRACE_EVENT.suggestedQuestions),
    notableStops,
    errorRows,
    degradationNotes: provenanceRow?.payload?.degradation_notes ?? [],
    styleEntries: styleSpecEntries(raw.rawPayload.file_generate_style_spec),
    webSources: [...webSourceSet],
    totalIn,
    totalOut,
    generationDurationMs,
    tps: perSecond(finalReplyOut, generationDurationMs),
    promptTps: perSecond(finalPromptIn, ttftMs),
    modelDurationMs,
    toolWaitDurationMs,
    toolSuccessWaitMs,
    toolFailWaitMs,
    otherWaitMs: Math.max(0, totalDurationMs - modelDurationMs - toolWaitDurationMs),
    totalDurationMs,
    finishReason: lastStopRow?.payload?.finish_reason ?? null,
    historyTurns,
    historyMessageCount,
    hasContextCompaction,
    hasTurnLimit,
    annotatedHistory,
    modelRows,
    topToolRows,
    nestedByParent,
    modelLanes,
    topToolLanes,
    nestedLaneCounts,
    waitRegions,
    tickStep,
    chartTicks,
  };
}

/** Left offset and width (in %) of a span on the chart; never narrower than 2%. */
export function barGeometry(start: number, end: number, total: number) {
  const left = pct(start, total);
  return { left, width: Math.max(pct(end, total) - left, 2) };
}

/** A retrieval row's candidate/kept counts and the ids behind them. */
export function ragStats(row: TTarsTraceRow) {
  const payload = row.payload ?? {};
  const kept = payload.total_documents ?? payload.documents?.length ?? 0;
  const candidates = (payload.rerank_by_kb ?? []).reduce(
    (sum, kb) => sum + (kb.candidates_in ?? 0),
    0,
  );
  /** doc_id/chunk_id are synthetic; milvus_pk is the real key. A multi-channel hit repeats. */
  const candidateIds = [
    ...new Set((payload.channel_hits ?? []).map((hit) => hit.milvus_pk).filter((id) => id != null)),
  ];
  const keptIds = (payload.documents ?? []).map((doc) => doc.milvus_pk).filter((id) => id != null);
  return {
    kept,
    candidates,
    backend: payload.rerank_by_kb?.[0]?.backend,
    floor: payload.floor_filter?.threshold,
    weights: Object.entries(payload.channel_weights ?? {}),
    candidateIds,
    keptIds,
  };
}
