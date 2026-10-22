import { TARS_TRACE_EVENT } from 'librechat-data-provider';
import type { TTarsTraceRow } from 'librechat-data-provider';
import type { ChartRow, Localize } from './layout';
import type { TraceSummary } from './summary';
import {
  fmtMs,
  fmtClock,
  fmtValue,
  labelForRow,
  requestFlag,
  statusLabel,
  fmtJsonInline,
  pairedToolRows,
  planStatusLabel,
  statusKindLabel,
  historyRoleLabel,
  historyContentText,
  reasoningEffortLabel,
} from './layout';
import { memoryDocumentId, labeledMemoryDocuments } from './documents';
import { breakdownShares, formatBreakdownText } from './breakdown';
import { finishReasonLabel } from './outcome';
import { fixedNumber } from './values';
import { fmtTimestamp } from './time';
import { ragStats } from './summary';

/** Suggested-question timing fields, in the order the card lists them. */
export const SUGGEST_TIMING_FIELDS = [
  ['wait_ms', 'com_ui_tars_audit_trace_suggest_wait'],
  ['invoke_ms', 'com_ui_tars_audit_trace_suggest_invoke'],
  ['total_ms', 'com_ui_tars_audit_trace_suggest_total'],
  ['join_ms', 'com_ui_tars_audit_trace_suggest_join'],
] as const;

/** The report's line buffer and the separators and formatters every section writes with. */
type ReportWriter = {
  t: Localize;
  COLON: string;
  SEP: string;
  DOT: string;
  push: (line?: string) => void;
  pushIndented: (text: string, indent: string) => void;
  section: (title: string) => void;
  field: (label: string, value: string | number | null | undefined) => void;
  /** null means unknown (truncated request_raw), which must not print as off. */
  onOff: (on: boolean | null) => string;
  /** A request switch, or null when the truncated request_raw cannot say. */
  flag: (value: unknown) => boolean | null;
  text: () => string;
};

type ReportSection = (w: ReportWriter, summary: TraceSummary) => void;

function createReportWriter(t: Localize, summary: TraceSummary): ReportWriter {
  const COLON = t('com_ui_tars_audit_trace_colon');
  const lines: string[] = [];
  const push = (line = '') => {
    lines.push(line);
  };
  return {
    t,
    COLON,
    SEP: t('com_ui_tars_audit_trace_list_separator'),
    DOT: t('com_ui_tars_audit_trace_inline_separator'),
    push,
    pushIndented: (text, indent) => text.split('\n').forEach((line) => push(`${indent}${line}`)),
    section: (title) => {
      push();
      push(`── ${title} ──`);
    },
    field: (label, value) => push(`${label}${COLON}${value ?? '—'}`),
    onOff: (on) => {
      if (on === null) {
        return '—';
      }
      return on ? t('com_ui_tars_audit_trace_on') : t('com_ui_tars_audit_trace_off');
    },
    flag: (value) => requestFlag(summary.rawTruncated, value),
    text: () => lines.join('\n'),
  };
}

const writeHeader: ReportSection = (w, s) => {
  const { t } = w;
  w.push(`${t('com_ui_tars_audit_trace_download_trace')} — ${s.message.model_name || '—'}`);
  w.field(t('com_ui_tars_audit_trace_message_id'), s.message.id);
  w.field(t('com_ui_tars_audit_trace_conversation_id'), s.message.conversation_id);
  w.field(t('com_ui_tars_audit_trace_export_time'), new Date().toISOString());
  if (s.notAppliedRow) {
    w.push(t('com_ui_tars_audit_trace_regenerate_not_applied_banner'));
  } else if (s.unappliedRegenerateCount > 0) {
    w.push(
      t('com_ui_tars_audit_trace_unapplied_regenerate_count', {
        count: s.unappliedRegenerateCount,
      }),
    );
  }
  if (s.rawTruncated) {
    w.push(
      t('com_ui_tars_audit_trace_request_raw_truncated_banner', {
        chars: s.rawOriginalChars?.toLocaleString() ?? '—',
      }),
    );
  }
};

const writeIdentity: ReportSection = (w, s) => {
  const { t } = w;
  w.section(
    `${t('com_ui_tars_audit_trace_user')} / ${t('com_ui_tars_audit_trace_assistant')} / ${t('com_ui_tars_audit_trace_model_label')}`,
  );
  w.field(
    t('com_ui_tars_audit_trace_user'),
    s.user?.username || t('com_ui_tars_audit_trace_user_deleted'),
  );
  w.field(
    t('com_ui_tars_audit_trace_assistant'),
    s.requestRow?.payload?.domain_name || t('com_ui_tars_audit_trace_general_domain'),
  );
  w.field(t('com_ui_tars_audit_trace_model_label'), s.message.model_name);
  w.field(
    t('com_ui_tars_audit_trace_reasoning_effort'),
    s.rawTruncated ? '—' : reasoningEffortLabel(t, s.rawPayload.reasoning_effort),
  );
};

/** A switch line, followed by what it reached (`→ a、b`) when anything is named. */
const writeSwitch = (
  w: ReportWriter,
  label: string,
  on: boolean | null,
  names?: readonly string[] | null,
) => {
  w.field(label, w.onOff(on));
  if (names?.length) {
    w.push(`  → ${names.join(w.SEP)}`);
  }
};

const writeRequestConfig: ReportSection = (w, s) => {
  const { t } = w;
  const { rawPayload } = s;
  const request = s.requestRow?.payload;
  const provenance = s.provenanceRow?.payload;
  w.section(t('com_ui_tars_audit_trace_request_config'));
  w.field(t('com_ui_tars_audit_trace_upload_file'), rawPayload.upload_filename);
  if (provenance?.data_files?.length) {
    w.field(t('com_ui_tars_audit_trace_data_files'), provenance.data_files.join(w.SEP));
  }
  if ((provenance?.image_input_count ?? 0) > 0) {
    w.field(
      t('com_ui_tars_audit_trace_image_inputs'),
      t('com_ui_tars_audit_trace_records_unit', { count: provenance?.image_input_count ?? 0 }),
    );
  }
  writeSwitch(
    w,
    t('com_ui_tars_audit_trace_database'),
    w.flag(rawPayload.is_database_bound),
    request?.database_names,
  );
  writeSwitch(w, t('com_ui_tars_audit_trace_web_search'), w.flag(rawPayload.is_enable_web_search));
  writeSwitch(
    w,
    t('com_ui_tars_audit_trace_kb_retrieval'),
    !!request?.knowledge_base_names?.length,
    request?.knowledge_base_names,
  );
  const fileType =
    rawPayload.is_file_generate_active && rawPayload.file_generate_type
      ? [String(rawPayload.file_generate_type).toUpperCase()]
      : null;
  writeSwitch(
    w,
    t('com_ui_tars_audit_trace_file_generate'),
    w.flag(rawPayload.is_file_generate_active),
    fileType,
  );
  writeSwitch(
    w,
    t('com_ui_tars_audit_trace_suggested_question'),
    w.flag(rawPayload.is_enable_suggested_questions !== false),
  );
  writeSwitch(
    w,
    'MCP',
    w.flag(rawPayload.is_mcp_enabled),
    provenance?.mcp_servers?.map((server) => server.name),
  );
  writeSwitch(
    w,
    'Langflow',
    s.isLangflowRoute || w.flag(rawPayload.is_enable_langflow),
    request?.langflow_names,
  );
  if (rawPayload.is_regenerate) {
    w.field(t('com_ui_tars_audit_trace_regenerate'), t('com_ui_tars_audit_trace_yes'));
  }
  if (request?.system_version) {
    w.field(t('com_ui_tars_audit_trace_system_version'), request.system_version);
  }
};

/** Tool calls, tokens, status and speed; a Langflow-routed message has none of these. */
const writeRunStats: ReportSection = (w, s) => {
  if (s.isLangflowRoute) {
    return;
  }
  const { t } = w;
  w.section(
    `${t('com_ui_tars_audit_trace_tool_calls')} / ${t('com_ui_tars_audit_trace_token_usage')} / ${t('com_ui_tars_audit_trace_status')}`,
  );
  w.field(
    t('com_ui_tars_audit_trace_tool_calls'),
    t('com_ui_tars_audit_trace_tool_call_breakdown', {
      total: s.toolCallTotal,
      success: s.toolSuccessCount,
      fail: s.toolFailDisplayCount,
    }),
  );
  w.field(
    t('com_ui_tars_audit_trace_token_usage'),
    `${t('com_ui_tars_audit_trace_input')} ${s.totalIn}  ${t('com_ui_tars_audit_trace_output')} ${s.totalOut}`,
  );
  w.field(t('com_ui_tars_audit_trace_status'), statusLabel(t, s.statusCode, s.isAborted));
  w.field(
    t('com_ui_tars_audit_trace_sent_at'),
    fmtTimestamp(s.message.created_at || s.requestRow?.started_at || s.trace?.[0]?.started_at),
  );
  if (s.errorMessage) {
    w.field(t('com_ui_tars_audit_trace_status_reason'), s.errorMessage);
  }
  if ((s.message.response_latency ?? 0) > 0) {
    w.field(
      t('com_ui_tars_audit_trace_response_latency'),
      fmtMs(Math.round((s.message.response_latency ?? 0) * 1000), t),
    );
  }
  if (s.promptTps != null) {
    w.field(
      t('com_ui_tars_audit_trace_prompt_tps'),
      t('com_ui_tars_audit_trace_tokens_per_second', { tps: s.promptTps.toFixed(2) }),
    );
  }
  if (s.tps != null) {
    w.field(
      t('com_ui_tars_audit_trace_tps'),
      t('com_ui_tars_audit_trace_tokens_per_second', { tps: s.tps.toFixed(2) }),
    );
  }
  const shares = breakdownShares(s);
  if (shares.length > 0) {
    w.field(t('com_ui_tars_audit_trace_duration_breakdown'), formatBreakdownText(shares, t));
  }
  if (s.generationDurationMs > 0) {
    w.field(t('com_ui_tars_audit_trace_generation_duration'), fmtMs(s.generationDurationMs, t));
  }
  if (s.toolWaitDurationMs > 0) {
    w.field(t('com_ui_tars_audit_trace_tool_wait_duration'), fmtMs(s.toolWaitDurationMs, t));
  }
};

const writeQuestion: ReportSection = (w, s) => {
  w.section(w.t('com_ui_tars_audit_trace_user_question'));
  w.push(s.queryText || '—');
};

/** A tool step's retry note, input and full output, indented under its timeline line. */
function writeToolStep(w: ReportWriter, trace: TTarsTraceRow[], toolUseId: string) {
  const { t, COLON } = w;
  const { call, result } = pairedToolRows(trace, toolUseId);
  if ((call?.attempt ?? 1) > 1) {
    w.push(
      `    ${t('com_ui_tars_audit_trace_attempt_count')}${t('com_ui_tars_audit_trace_attempt_nth', { n: call?.attempt ?? '' })}${call?.retry_of ? t('com_ui_tars_audit_trace_retry_note') : ''}`,
    );
  }
  if (call?.payload?.input !== undefined) {
    w.push(`    ${t('com_ui_tars_audit_trace_tool_input')}`);
    w.pushIndented(fmtValue(call.payload.input), '      ');
  }
  if (result?.payload?.output === undefined) {
    return;
  }
  w.push(`    ${t('com_ui_tars_audit_trace_tool_output')}`);
  if ((result.payload.model_output_limit ?? 0) > 0) {
    w.push(
      `    ${t('com_ui_tars_audit_trace_model_output_limit')}${COLON}${t('com_ui_tars_audit_trace_char_count', { chars: (result.payload.model_output_limit ?? 0).toLocaleString() })}`,
    );
  }
  if (result.payload.truncated) {
    w.push(
      `    ${t('com_ui_tars_audit_trace_truncated')}${COLON}${t('com_ui_tars_audit_trace_char_count', { chars: result.payload.output_len_chars?.toLocaleString() ?? '—' })}`,
    );
  }
  w.pushIndented(String(result.payload.output || ''), '      ');
}

/** One timeline step: its track, span and outcome, then its full content. */
function writeTimelineStep(
  w: ReportWriter,
  trace: TTarsTraceRow[],
  row: ChartRow,
  nestedRows: ReadonlySet<ChartRow>,
) {
  const { t, COLON } = w;
  let track = t('com_ui_tars_audit_trace_tool_label');
  if (row._track === 'model') {
    track = t('com_ui_tars_audit_trace_model_label');
  } else if (nestedRows.has(row)) {
    track = t('com_ui_tars_audit_trace_subtask');
  }
  const duration = row.duration_ms ?? row._end - row._start;
  const hasOutcome =
    row.event_type === TARS_TRACE_EVENT.toolResult ||
    row.event_type === TARS_TRACE_EVENT.langflowRoute;
  let outcome = '';
  if (hasOutcome) {
    outcome =
      row.ok === false ? t('com_ui_tars_audit_trace_fail') : t('com_ui_tars_audit_trace_success');
  }
  w.push(
    `[${track}] ${labelForRow(t, row)} | ${fmtClock(row.started_at)} → ${fmtClock(row.ended_at)} | ${fmtMs(duration, t)}${outcome ? ` | ${outcome}` : ''}`,
  );
  if (row.event_type === TARS_TRACE_EVENT.langflowRoute) {
    if (row.payload?.error_message) {
      w.push(
        `    ${t('com_ui_tars_audit_trace_status_reason')}${COLON}${row.payload.error_message}`,
      );
    }
    return;
  }
  if (row._track === 'tool' && row.tool_use_id) {
    writeToolStep(w, trace, row.tool_use_id);
  } else if (row.payload?.text !== undefined) {
    w.push(`    ${labelForRow(t, row)}${COLON}`);
    w.pushIndented(String(row.payload.text || ''), '      ');
  }
}

/** Markers are merged into the ordering so a compaction or retry shows between its steps. */
const writeTimeline: ReportSection = (w, s) => {
  const { t } = w;
  const nestedRows = new Set(Object.values(s.nestedByParent).flat());
  const timelineRows = [
    ...s.modelRows,
    ...s.topToolRows,
    ...nestedRows,
    ...s.chart.statusMarkers,
  ].sort((a, b) => a._start - b._start);
  if (timelineRows.length) {
    w.section(t('com_ui_tars_audit_trace_timeline'));
  }
  for (const row of timelineRows) {
    if (row.event_type === TARS_TRACE_EVENT.status) {
      w.push(
        `[${t('com_ui_tars_audit_trace_status_marker_label')}] ${statusKindLabel(t, row.payload?.kind)} | ${fmtClock(row.started_at)}`,
      );
      w.push(`    ${row.payload?.message || '—'}`);
      continue;
    }
    writeTimelineStep(w, s.trace, row as ChartRow, nestedRows);
  }
};

const writeResponse: ReportSection = (w, s) => {
  const { t } = w;
  w.section(t('com_ui_tars_audit_trace_system_response'));
  w.push(
    s.message.response ||
      (s.isLangflowRoute
        ? t('com_ui_tars_audit_trace_langflow_no_response')
        : t('com_ui_tars_audit_trace_aborted_no_response')),
  );
};

const writeSuggestedQuestions = (w: ReportWriter, row: TTarsTraceRow) => {
  const { t, COLON } = w;
  w.push(`${t('com_ui_tars_audit_trace_suggested_question')}${COLON}`);
  w.push(
    `  ${t('com_ui_tars_audit_trace_generated_count')}${COLON}${t('com_ui_tars_audit_trace_records_unit', { count: row.payload?.count ?? 0 })}`,
  );
  const timings = SUGGEST_TIMING_FIELDS.filter(([key]) => row.payload?.[key] != null);
  if (timings.length) {
    w.push(`  ${t('com_ui_tars_audit_trace_duration')}${COLON}`);
    timings.forEach(([key, labelKey]) =>
      w.push(`    ${t(labelKey)}${COLON}${fmtMs(row.payload?.[key], t)}`),
    );
  }
};

const writeClarification = (w: ReportWriter, row: TTarsTraceRow) => {
  const { t, COLON } = w;
  w.push(`${t('com_ui_tars_audit_trace_clarification')}${COLON}`);
  w.push(
    `  ${t('com_ui_tars_audit_trace_clarification_question')}${COLON}${row.payload?.question || '—'}`,
  );
  if (row.payload?.options?.length) {
    w.push(
      `  ${t('com_ui_tars_audit_trace_clarification_options')}${COLON}${row.payload.options.map((option) => option.label).join(w.SEP)}`,
    );
  }
};

const writeNotices: ReportSection = (w, s) => {
  const { t, COLON } = w;
  const { errorRows, degradationNotes, clarificationRow, planRow, notableStops, suggestedRow } = s;
  if (
    !errorRows.length &&
    !degradationNotes.length &&
    !clarificationRow &&
    !planRow &&
    !notableStops.length &&
    !suggestedRow
  ) {
    return;
  }
  w.section(t('com_ui_tars_audit_trace_execution_notices'));
  if (errorRows.length) {
    w.push(`${t('com_ui_tars_audit_trace_errors')}${COLON}`);
    errorRows.forEach((row) =>
      w.push(`  [${row.payload?.error_code || '—'}] ${row.payload?.message || '—'}`),
    );
  }
  if (notableStops.length) {
    w.push(`${t('com_ui_tars_audit_trace_finish_reason')}${COLON}`);
    notableStops.forEach((row) =>
      w.push(
        `  [${t('com_ui_tars_audit_trace_turn_n', { turn: row.turn ?? '' })}] ${finishReasonLabel(t, row.payload?.finish_reason)?.label ?? '—'}`,
      ),
    );
  }
  if (suggestedRow) {
    writeSuggestedQuestions(w, suggestedRow);
  }
  if (degradationNotes.length) {
    w.push(`${t('com_ui_tars_audit_trace_degradation_notes')}${COLON}`);
    degradationNotes.forEach((note, index) => w.push(`  ${index + 1}. ${note}`));
  }
  if (clarificationRow) {
    writeClarification(w, clarificationRow);
  }
  if (planRow?.payload?.items?.length) {
    w.push(`${t('com_ui_tars_audit_trace_plan')}${COLON}`);
    planRow.payload.items.forEach((item) =>
      w.push(`  [${planStatusLabel(t, item.status)}] ${item.content}`),
    );
  }
};

const writeUserInfo: ReportSection = (w, s) => {
  const { t, SEP } = w;
  w.section(t('com_ui_tars_audit_trace_more_user_info'));
  w.field('Email', s.user?.email);
  w.field(
    t('com_ui_tars_audit_trace_user_groups'),
    s.user?.user_groups?.length ? s.user.user_groups.map((group) => group.name).join(SEP) : null,
  );
  w.field(t('com_ui_tars_audit_trace_ip_address'), s.message.ip_addr);
  w.field(t('com_ui_tars_audit_trace_conversation_id'), s.message.conversation_id);
};

const writeUserMemory: ReportSection = (w, s) => {
  const { t, COLON, DOT } = w;
  w.push(`${t('com_ui_tars_audit_trace_user_memory')}${COLON}`);
  const memory = s.memoryRow?.payload;
  if (memory && (memory.retrieval_ms != null || memory.context_available === false)) {
    const recall = memory.retrieval_ms != null ? fmtMs(Math.round(memory.retrieval_ms), t) : '—';
    const unavailable =
      memory.context_available === false
        ? `${DOT}${t('com_ui_tars_audit_trace_memory_not_available')}`
        : '';
    w.push(`  ${t('com_ui_tars_audit_trace_memory_recall')}${COLON}${recall}${unavailable}`);
  }
  if (!memory?.records?.length) {
    w.push(`  ${t('com_ui_tars_audit_trace_not_triggered')}`);
    return;
  }
  memory.records.forEach((record) => {
    const score = typeof record.score === 'number' ? record.score.toFixed(4) : record.score;
    w.push(
      `  [${record.memory_type}]${DOT}${t('com_ui_tars_audit_trace_similarity')} ${score}${DOT}${t('com_ui_tars_audit_trace_created_at')} ${(record.created_at || '').slice(0, 10)}`,
    );
    w.pushIndented(String(record.content || ''), '    ');
  });
};

const writeLongTermMemory: ReportSection = (w, s) => {
  const { t, COLON } = w;
  w.push(`${t('com_ui_tars_audit_trace_long_term_memory')}${COLON}`);
  const documents = s.longTermRow?.payload?.documents ?? [];
  const websites = s.longTermRow?.payload?.websites ?? [];
  if (documents.some((doc) => memoryDocumentId(doc))) {
    w.push(`  ${t('com_ui_tars_audit_trace_download_in_panel')}`);
  }
  if (!documents.length && !websites.length) {
    w.push(`  ${t('com_ui_tars_audit_trace_not_uploaded')}`);
    return;
  }
  labeledMemoryDocuments(documents).forEach(({ labelKey, document }) => {
    w.push(`  [${t(labelKey)}] ${document.filename}`);
    const id = memoryDocumentId(document);
    if (id) {
      w.push(`    ${document.file_id ? 'file_id' : 'id'}: ${id}`);
    }
  });
  websites.forEach((site) => w.push(`  [${t('com_ui_tars_audit_trace_webpage')}] ${site.name}`));
};

const writeKnowledgeRetrieval: ReportSection = (w, s) => {
  const { t, COLON, SEP } = w;
  w.push(`${t('com_ui_tars_audit_trace_kb_retrieval')}${COLON}`);
  if (!s.ragRows.length) {
    w.push(`  ${t('com_ui_tars_audit_trace_not_enabled')}`);
    return;
  }
  s.ragRows.forEach((row) => {
    const stats = ragStats(row);
    w.push(
      `  ${row.payload?.query || t('com_ui_tars_audit_trace_retrieval_fallback')} — ${t('com_ui_tars_audit_trace_candidates_kept', { candidates: stats.candidates, kept: stats.kept })}` +
        (stats.backend
          ? t('com_ui_tars_audit_trace_reranker_note', { backend: stats.backend })
          : '') +
        (stats.floor != null
          ? t('com_ui_tars_audit_trace_score_floor_note', { floor: fixedNumber(stats.floor, 4) })
          : ''),
    );
    if (stats.weights.length) {
      w.push(
        `    ${t('com_ui_tars_audit_trace_channel_weights')}${stats.weights.map(([name, weight]) => `${name} ${weight}`).join(SEP)}`,
      );
    }
    if (stats.candidateIds.length) {
      w.push(
        `    ${t('com_ui_tars_audit_trace_candidate_milvus_ids')}${stats.candidateIds.join(SEP)}`,
      );
    }
    if (stats.keptIds.length) {
      w.push(`    ${t('com_ui_tars_audit_trace_kept_milvus_ids')}${stats.keptIds.join(SEP)}`);
    }
  });
};

/** Earlier tool results replayed into the prompt, the web pages read and the schema injected. */
const writeInjectedContext: ReportSection = (w, s) => {
  const { t, COLON } = w;
  w.push(`${t('com_ui_tars_audit_trace_prior_tool_context')}${COLON}`);
  const replay = s.toolContextRow?.payload;
  if (replay?.text) {
    w.push(`  ${t('com_ui_tars_audit_trace_records_unit', { count: replay.entry_count || 0 })}`);
    w.pushIndented(replay.text, '  ');
  } else {
    w.push(`  ${t('com_ui_tars_audit_trace_not_triggered')}`);
  }
  if (s.webSources.length) {
    w.push(`${t('com_ui_tars_audit_trace_web_sources')}${COLON}`);
    s.webSources.forEach((url, index) => w.push(`  ${index + 1}. ${url}`));
  }
  const schema = s.requestRow?.payload?.sql_schema_injected;
  if (schema) {
    w.push(`${t('com_ui_tars_audit_trace_sql_schema_injected')}${COLON}`);
    w.pushIndented(schema, '  ');
  }
};

const writeHistory: ReportSection = (w, s) => {
  const { t, COLON, DOT } = w;
  w.push(`${t('com_ui_tars_audit_trace_conversation_history')}${COLON}`);
  if (s.hasContextCompaction) {
    w.push(`  ! ${t('com_ui_tars_audit_trace_history_compacted_note')}`);
  }
  if (s.hasTurnLimit) {
    w.push(`  ! ${t('com_ui_tars_audit_trace_history_turn_limit_note')}`);
  }
  if (!s.annotatedHistory.length) {
    w.push(`  ${t('com_ui_tars_audit_trace_no_history_initial')}`);
    return;
  }
  w.push(
    `  [${t('com_ui_tars_audit_trace_history_turn_summary', {
      turns: s.historyTurns,
      messages: s.historyMessageCount,
    })}]`,
  );
  s.annotatedHistory.forEach((entry) => {
    w.push(
      `  [${t('com_ui_tars_audit_trace_turn_n', { turn: entry.turnIndex })}${DOT}${historyRoleLabel(t, entry.role)}]`,
    );
    w.pushIndented(historyContentText(entry.content), '    ');
  });
};

/** What the model saw besides the question, in the order the card's 參考資料來源 lists it. */
const writeReferences: ReportSection = (w, s) => {
  w.section(w.t('com_ui_tars_audit_trace_references'));
  writeUserMemory(w, s);
  writeLongTermMemory(w, s);
  writeKnowledgeRetrieval(w, s);
  writeInjectedContext(w, s);
  writeHistory(w, s);
};

type Provenance = NonNullable<TTarsTraceRow['payload']>;

const writeRetrievalSettings = (w: ReportWriter, provenance: Provenance) => {
  const { t, COLON } = w;
  w.push(`Embedding${COLON}`);
  if (provenance.embedding_profiles?.length) {
    provenance.embedding_profiles.forEach((profile) => {
      const dims =
        profile.embedding_dims != null
          ? `  ${t('com_ui_tars_audit_trace_vector_dims')}${COLON}${profile.embedding_dims}`
          : '';
      w.push(
        `  [${profile.kb_name || profile.kb_id || t('com_ui_tars_audit_trace_kb_name_unknown')}] ${t('com_ui_tars_audit_trace_model_label')}${COLON}${profile.embedding_model_name}${dims}`,
      );
    });
  } else {
    w.push(`  ${t('com_ui_tars_audit_trace_rag_not_enabled')}`);
  }
  if (provenance.milvus_url) {
    w.push(
      `  ${t('com_ui_tars_audit_trace_vector_db')}${COLON}${provenance.milvus_url}${provenance.milvus_port ? `:${provenance.milvus_port}` : ''}`,
    );
  }
  const params = provenance.retrieval_params;
  if (provenance.rerank_backend) {
    w.push(`Rerank${COLON}`);
    w.push(`  ${t('com_ui_tars_audit_trace_engine')}${COLON}${provenance.rerank_backend}`);
    if (provenance.rerank_model_name) {
      w.push(
        `  ${t('com_ui_tars_audit_trace_model_label')}${COLON}${provenance.rerank_model_name}`,
      );
    }
    if (params?.rerank_floor_ratio != null) {
      w.push(
        `  ${t('com_ui_tars_audit_trace_score_floor_ratio')}${COLON}${params.rerank_floor_ratio} ${t('com_ui_tars_audit_trace_score_floor_ratio_hint')}`,
      );
    }
  }
  if (!params) {
    return;
  }
  w.push(`${t('com_ui_tars_audit_trace_retrieval_params')}${COLON}`);
  if (params.score_threshold != null) {
    w.push(
      `  ${t('com_ui_tars_audit_trace_similarity_threshold')}${COLON}${params.score_threshold}`,
    );
  }
  if (params.default_limit != null) {
    w.push(
      `  ${t('com_ui_tars_audit_trace_kb_limit')}${COLON}${t('com_ui_tars_audit_trace_records_unit', { count: params.default_limit })}`,
    );
  }
};

const writeGenerationSettings = (w: ReportWriter, provenance: Provenance) => {
  const { t, COLON, SEP } = w;
  w.push(`${t('com_ui_tars_audit_trace_generation')}${COLON}`);
  w.push(`  ${t('com_ui_tars_audit_trace_model_label')}${COLON}${provenance.model_name || '—'}`);
  const temperature = provenance.temperature;
  w.push(
    `  ${t('com_ui_tars_audit_trace_sampling_params')}${COLON}${temperature != null ? fmtJsonInline({ temperature }) : '—'}`,
  );
  if (Object.keys(provenance.model_kwargs ?? {}).length) {
    w.push(
      `  ${t('com_ui_tars_audit_trace_model_call_params')}${COLON}${fmtJsonInline(provenance.model_kwargs)}`,
    );
  }
  if (provenance.available_tools?.length) {
    w.push(
      `  ${t('com_ui_tars_audit_trace_available_tools')}${COLON}${provenance.available_tools.join(SEP)}`,
    );
  }
  if (provenance.native_tool_calling != null) {
    const mode = provenance.native_tool_calling
      ? t('com_ui_tars_audit_trace_native_tool_calling_native')
      : t('com_ui_tars_audit_trace_native_tool_calling_json');
    w.push(`  ${t('com_ui_tars_audit_trace_native_tool_calling')}${COLON}${mode}`);
  }
  if (provenance.model_endpoint) {
    w.push(`  ${t('com_ui_tars_audit_trace_model_endpoint')}${COLON}${provenance.model_endpoint}`);
  }
};

const writeModelParams: ReportSection = (w, s) => {
  w.section(w.t('com_ui_tars_audit_trace_model_params'));
  const provenance = s.provenanceRow?.payload;
  if (!provenance) {
    w.push(w.t('com_ui_tars_audit_trace_no_record'));
    return;
  }
  writeRetrievalSettings(w, provenance);
  writeGenerationSettings(w, provenance);
};

const writeFileGenerate: ReportSection = (w, s) => {
  const { t, COLON } = w;
  const { rawPayload, styleEntries } = s;
  w.section(t('com_ui_tars_audit_trace_file_generate_settings'));
  if (s.rawTruncated) {
    w.push('—');
    return;
  }
  if (!rawPayload.is_file_generate_active) {
    w.push(t('com_ui_tars_audit_trace_file_generate_not_active'));
    return;
  }
  if (rawPayload.file_generate_extra_prompt) {
    w.field(
      t('com_ui_tars_audit_trace_file_generate_extra_prompt'),
      rawPayload.file_generate_extra_prompt,
    );
  }
  if (rawPayload.file_generate_footer_text) {
    w.field(
      t('com_ui_tars_audit_trace_file_generate_footer_text'),
      rawPayload.file_generate_footer_text,
    );
  }
  if (styleEntries.length) {
    w.push(`${t('com_ui_tars_audit_trace_file_generate_style')}${COLON}`);
    styleEntries.forEach(([key, value]) => w.push(`  ${key}${COLON}${value}`));
  }
  if (
    !rawPayload.file_generate_extra_prompt &&
    !rawPayload.file_generate_footer_text &&
    !styleEntries.length
  ) {
    w.push(t('com_ui_tars_audit_trace_no_record'));
  }
};

/** The report's sections in print order, one per block of the trace card. */
const REPORT_SECTIONS: readonly ReportSection[] = [
  writeHeader,
  writeIdentity,
  writeRequestConfig,
  writeRunStats,
  writeQuestion,
  writeTimeline,
  writeResponse,
  writeNotices,
  writeUserInfo,
  writeReferences,
  writeModelParams,
  writeFileGenerate,
];

/**
 * Plain-text report mirroring what the trace card renders — a port of pwc_tars
 * `AgentTrace/traceDownloadText.mjs`. Every step carries its full content, not a
 * summary line: the report is meant to reproduce the run.
 *
 * Files are listed by name and `file_id` only: their download route needs the
 * admin's session, so a printed address would not open from the text file.
 */
export function buildTraceDownloadText(t: Localize, summary: TraceSummary): string {
  const writer = createReportWriter(t, summary);
  REPORT_SECTIONS.forEach((writeSection) => writeSection(writer, summary));
  return writer.text();
}
