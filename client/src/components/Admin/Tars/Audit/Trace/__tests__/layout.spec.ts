import type { TTarsMessageTrace, TTarsTraceRow } from 'librechat-data-provider';
import type { ChartRow } from '../layout';
import {
  pct,
  laneBox,
  assignLanes,
  requestFlag,
  statusLabel,
  fmtJsonInline,
  groupToolRows,
  toolCallStats,
  buildChartRows,
  fmtElapsedTick,
  buildWaitRegions,
  computeNiceTicks,
  styleSpecEntries,
  resolveRawRequest,
  historyContentText,
  reasoningEffortLabel,
  resolveMessageOutcome,
  fmtMs,
} from '../layout';
import {
  outcomeTone,
  finishReasonLabel,
  retryFailureReason,
  RETRY_REASON_MAX_CHARS,
} from '../outcome';
import { memoryDocumentId, overviewAttachments, labeledMemoryDocuments } from '../documents';
import { fmtTimestamp, computeToolWaitDuration } from '../time';
import zh from '~/locales/zh-Hant/translation.json';
import { buildTraceDownloadText } from '../report';
import { annotateHistoryTurns } from '../history';
import { buildDetailExportJson } from '../json';
import en from '~/locales/en/translation.json';
import { summarizeTrace } from '../summary';

const t = (key: string) => key;

/** A shipped catalog with i18next's `{{name}}` interpolation, so units are the real strings. */
const localizeFrom =
  (catalog: Record<string, string>) => (key: string, options?: Record<string, string | number>) =>
    (catalog[key] ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ''));
const tEn = localizeFrom(en);
const tZh = localizeFrom(zh);

let seq = 0;
const row = (event_type: string, fields: Partial<TTarsTraceRow> = {}): TTarsTraceRow => ({
  id: `r-${++seq}`,
  seq,
  message_id: 'm-1',
  event_type,
  turn: 1,
  tool_name: null,
  tool_use_id: null,
  parent_id: null,
  attempt: 1,
  retry_of: null,
  started_at: null,
  ended_at: null,
  duration_ms: null,
  ok: null,
  payload: null,
  ...fields,
});

const at = (ms: number) => new Date(Date.UTC(2026, 8, 1, 2, 0, 0, ms)).toISOString();

const message: TTarsMessageTrace['message'] = {
  id: 'm-1',
  conversation_id: 'c-1',
  model_name: 'gpt-5.4-mini',
  created_at: null,
  ip_addr: null,
  query: 'q',
  response: 'a',
  status: 1,
  error_message: null,
  response_latency: null,
};

describe('computeNiceTicks', () => {
  /** total/count would give unreadable steps like 0.94s. */
  it('steps on 1-2-5-10 multiples and never past the total', () => {
    expect(computeNiceTicks(4700)).toEqual({ step: 1000, ticks: [0, 1000, 2000, 3000, 4000] });
    expect(computeNiceTicks(6000)).toEqual({ step: 2000, ticks: [0, 2000, 4000, 6000] });
  });

  it('floors the step at 1ms and handles an empty span', () => {
    expect(computeNiceTicks(2).step).toBe(1);
    expect(computeNiceTicks(0)).toEqual({ step: 1, ticks: [0] });
  });

  it('labels ticks in the step unit, not the value unit', () => {
    expect(fmtElapsedTick(2000, 1000, tEn)).toBe('2s');
    expect(fmtElapsedTick(2000, 1000, tZh)).toBe('2 秒');
    expect(fmtElapsedTick(1500, 500, tEn)).toBe('1500ms');
    expect(fmtElapsedTick(500, 500, tZh)).toBe('500 毫秒');
  });

  it('formats ms duration in seconds or milliseconds with spacing and localization', () => {
    expect(fmtMs(null, tEn)).toBe('—');
    expect(fmtMs(250, tZh)).toBe('250 毫秒');
    expect(fmtMs(250, tEn)).toBe('250 ms');
    expect(fmtMs(2500, tZh)).toBe('2.50 秒');
    expect(fmtMs(2500, tEn)).toBe('2.50 seconds');
  });

  it('maps the total to the right edge minus its padding', () => {
    expect(pct(0, 100)).toBe(0);
    expect(pct(100, 100)).toBe(95);
    expect(pct(-5, 100)).toBe(0);
  });
});

describe('assignLanes / laneBox', () => {
  const bar = (start: number, end: number) =>
    ({ ...row('tool_result'), _start: start, _end: end, _track: 'tool' }) as ChartRow;

  it('stacks overlapping bars and reuses a lane once it frees up', () => {
    const a = bar(0, 100);
    const b = bar(50, 150);
    const c = bar(100, 200);
    expect(assignLanes([a, b, c])).toBe(2);
    expect([a._lane, b._lane, c._lane]).toEqual([0, 1, 0]);
  });

  it('gives each lane its own band of the row', () => {
    expect(laneBox(0, 2, 40)).toEqual({ top: 3, bottom: 43 });
    expect(laneBox(1, 2, 40)).toEqual({ top: 43, bottom: 3 });
    expect(laneBox(9, 2, 40)).toEqual({ top: 43, bottom: 3 });
  });
});

describe('buildChartRows', () => {
  it('merges a call and its result into one bar timed by the result', () => {
    const trace = [
      row('turn', { started_at: at(0) }),
      row('thinking', { started_at: at(200), ended_at: at(400) }),
      row('tool_call', { tool_use_id: 'c1', tool_name: 'web_search', started_at: at(500) }),
      row('tool_result', {
        tool_use_id: 'c1',
        tool_name: 'web_search',
        started_at: at(500),
        ended_at: at(900),
        ok: true,
      }),
    ];
    const chart = buildChartRows(trace);
    expect(chart.total).toBe(900);
    expect(chart.requestSentByTurn).toEqual({ 1: 0 });
    expect(chart.rows.map((r) => [r.event_type, r._track, r._start, r._end])).toEqual([
      ['thinking', 'model', 200, 400],
      ['tool_result', 'tool', 500, 900],
    ]);
  });

  it('skips a row with an unreadable timestamp instead of blanking the chart', () => {
    const chart = buildChartRows([
      row('thinking', { started_at: 'not-a-time', ended_at: at(100) }),
      row('text', { started_at: at(200), ended_at: at(500) }),
    ]);
    expect(Number.isNaN(chart.baseMs)).toBe(false);
    expect(chart.rows.map((r) => [r.event_type, r._start, r._end])).toEqual([['text', 0, 300]]);
  });

  /** A status with a parent is tool progress, already covered by that tool's bar. */
  it('marks only top-level status events', () => {
    const chart = buildChartRows([
      row('status', { started_at: at(0), payload: { kind: 'retry' } }),
      row('status', { started_at: at(10), parent_id: 'c1' }),
    ]);
    expect(chart.statusMarkers).toHaveLength(1);
  });

  it('returns an empty layout when nothing is timed', () => {
    expect(buildChartRows([row('request')]).rows).toEqual([]);
  });

  it('opens a wait region from the request to the turn’s first model bar', () => {
    const trace = [
      row('turn', { started_at: at(0) }),
      row('text', { started_at: at(300), ended_at: at(500) }),
    ];
    const chart = buildChartRows(trace);
    const modelRows = chart.rows.filter((r) => r._track === 'model');
    assignLanes(modelRows);
    expect(buildWaitRegions(modelRows, chart.requestSentByTurn)).toEqual([
      { turn: 1, start: 0, end: 300, lane: 0 },
    ]);
  });
});

describe('groupToolRows / toolCallStats', () => {
  it('nests a delegate’s sub-calls and counts only top-level calls', () => {
    const trace = [
      row('tool_result', { tool_use_id: 'd', started_at: at(0), ended_at: at(50), ok: true }),
      row('tool_result', {
        tool_use_id: 's',
        parent_id: 'd',
        started_at: at(10),
        ended_at: at(20),
        ok: false,
      }),
      row('tool_result', { tool_use_id: 'x', started_at: at(60), ended_at: at(70), ok: false }),
    ];
    const { topToolRows, nestedByParent } = groupToolRows(trace, buildChartRows(trace).rows);
    expect(topToolRows.map((r) => r.tool_use_id)).toEqual(['d', 'x']);
    expect(nestedByParent.d.map((r) => r.tool_use_id)).toEqual(['s']);
    expect(toolCallStats(topToolRows)).toEqual({
      toolCallTotal: 2,
      toolSuccessCount: 1,
      toolFailDisplayCount: 1,
      toolCallTone: 'warn',
    });
  });

  it('tones all-good, all-failed and no calls', () => {
    const r = (ok: boolean) => ({ ...row('tool_result', { ok }), _start: 0, _end: 1 }) as ChartRow;
    expect(toolCallStats([r(true)]).toolCallTone).toBe('good');
    expect(toolCallStats([r(false)]).toolCallTone).toBe('bad');
    expect(toolCallStats([]).toolCallTone).toBeNull();
  });
});

describe('computeToolWaitDuration', () => {
  it('returns 0 for empty tool rows', () => {
    expect(computeToolWaitDuration([])).toBe(0);
  });

  it('sums non-overlapping sequential tool calls', () => {
    const rows = [
      { ...row('tool_result'), _start: 100, _end: 600, duration_ms: 500 } as ChartRow,
      { ...row('tool_result'), _start: 800, _end: 1200, duration_ms: 400 } as ChartRow,
    ];
    expect(computeToolWaitDuration(rows)).toBe(900);
  });

  it('merges overlapping and concurrent tool calls', () => {
    const rows = [
      { ...row('tool_result'), _start: 500, _end: 1500, duration_ms: 1000 } as ChartRow,
      { ...row('tool_result'), _start: 800, _end: 2000, duration_ms: 1200 } as ChartRow,
    ];
    expect(computeToolWaitDuration(rows)).toBe(1500);
  });
});

describe('request and outcome resolution', () => {
  /** A truncated request's switches are unknown, not off. */
  it('reports switches of a truncated raw request as unknown', () => {
    const raw = resolveRawRequest(
      row('request_raw', {
        payload: { payload: null, payload_truncated: true, payload_original_chars: 9 },
      }),
    );
    expect(raw).toEqual({ rawPayload: {}, rawTruncated: true, rawOriginalChars: 9 });
    expect(requestFlag(raw.rawTruncated, true)).toBeNull();
    expect(requestFlag(false, undefined)).toBe(false);
  });

  it('lets an unapplied regenerate’s own outcome win over the message status', () => {
    const notApplied = row('regenerate_not_applied', {
      payload: { aborted: true, error_message: 'stopped' },
    });
    expect(resolveMessageOutcome([notApplied], message)).toMatchObject({
      statusCode: 3,
      errorMessage: 'stopped',
      isAborted: true,
    });
    expect(resolveMessageOutcome([], { ...message, status: null, response: '' }).isAborted).toBe(
      true,
    );
  });

  it('labels SUCCESS as aborted only when the fallback says so', () => {
    expect(statusLabel(t, 1, false)).toBe('com_ui_tars_audit_trace_completed');
    expect(statusLabel(t, 1, true)).toBe('com_ui_tars_audit_trace_aborted');
    expect(statusLabel(t, 2, true)).toBe('com_ui_tars_audit_trace_status_failed');
  });

  /** Red is kept for a failure; a run that stopped short without failing is amber. */
  it('colors only a failed run red', () => {
    const toneOf = (trace: TTarsTraceRow[], fields: Partial<TTarsMessageTrace['message']>) => {
      const outcome = resolveMessageOutcome(trace, { ...message, ...fields });
      return outcomeTone(outcome.statusCode, outcome.isAborted);
    };
    expect(toneOf([], { status: 1 })).toBe('good');
    expect(toneOf([], { status: 2 })).toBe('bad');
    expect(toneOf([], { status: 3 })).toBe('warn');
    /** No status and no answer: the trace cannot tell a stop from a failure. */
    expect(toneOf([], { status: null, response: '' })).toBe('warn');
    const regenerate = (payload: TTarsTraceRow['payload']) => [
      row('regenerate_not_applied', { payload }),
    ];
    expect(toneOf(regenerate({ aborted: true }), { status: 1 })).toBe('warn');
    expect(toneOf(regenerate({ status: 2 }), { status: 1 })).toBe('bad');
  });
});

describe('formatting', () => {
  it('prints inline JSON with spaces after colons and commas', () => {
    expect(fmtJsonInline({ a: 1, b: [true, null], c: { d: 'x' } })).toBe(
      '{"a": 1, "b": [true, null], "c": {"d": "x"}}',
    );
    expect(fmtJsonInline(null)).toBe('{}');
  });

  it('parses a JSON-string style spec and drops empty values', () => {
    expect(styleSpecEntries('{"font":"Arial","size":12,"empty":"","n":{"a":1}}')).toEqual([
      ['font', 'Arial'],
      ['size', '12'],
      ['n', '{"a":1}'],
    ]);
    expect(styleSpecEntries('not json')).toEqual([]);
    expect(styleSpecEntries(['a'])).toEqual([]);
  });

  it('flattens multi-part history content', () => {
    expect(historyContentText([{ type: 'text', text: 'hi' }, { type: 'image_url' }, 'x'])).toBe(
      'hi\n[image_url]\nx',
    );
  });

  it('maps default to the localized default value key', () => {
    expect(reasoningEffortLabel(t, 'default')).toBe('com_ui_tars_audit_trace_default_value');
    expect(reasoningEffortLabel(t, 'Default')).toBe('com_ui_tars_audit_trace_default_value');
  });

  it('maps effort levels to LibreChat standard parameter setting keys', () => {
    expect(reasoningEffortLabel(t, 'low')).toBe('com_ui_low');
    expect(reasoningEffortLabel(t, 'medium')).toBe('com_ui_medium');
    expect(reasoningEffortLabel(t, 'high')).toBe('com_ui_high');
    expect(reasoningEffortLabel(t, 'auto')).toBe('com_ui_auto');
    expect(reasoningEffortLabel(t, 'none')).toBe('com_ui_none');
    expect(reasoningEffortLabel(t, 'off')).toBe('com_ui_tars_audit_trace_off');
    expect(reasoningEffortLabel(t, null)).toBe('com_ui_tars_audit_trace_off');
  });
});

describe('fmtTimestamp', () => {
  it('returns em dash for empty or invalid values', () => {
    expect(fmtTimestamp(null)).toBe('—');
    expect(fmtTimestamp(undefined)).toBe('—');
    expect(fmtTimestamp('')).toBe('—');
    expect(fmtTimestamp('invalid-date')).toBe('—');
  });

  it('formats timestamp with decimal seconds based on record precision', () => {
    const dWithMs = new Date(2026, 8, 1, 14, 30, 25, 123);
    expect(fmtTimestamp(dWithMs.toISOString())).toBe('2026-09-01 14:30:25.123');

    const dNoMs = new Date(2026, 8, 1, 14, 30, 25, 0);
    const isoNoMs = dNoMs.toISOString().replace('.000', '');
    expect(fmtTimestamp(isoNoMs)).toBe('2026-09-01 14:30:25');

    const isoMicro = dWithMs.toISOString().replace('.123', '.123456');
    expect(fmtTimestamp(isoMicro)).toBe('2026-09-01 14:30:25.123456');
  });

  it('supports Date objects and epoch timestamps', () => {
    const d = new Date(2026, 8, 1, 14, 30, 25, 450);
    expect(fmtTimestamp(d)).toBe('2026-09-01 14:30:25.450');
    expect(fmtTimestamp(d.getTime())).toBe('2026-09-01 14:30:25.450');
  });
});

/** A mirrored chat's thread files, as the mirror records them: by LibreChat `file_id` when known. */
const longTermMemory = row('long_term_memory', {
  payload: {
    documents: [
      { id: null, file_id: 'f-sheet', filename: 'sales.xlsx', injected_as: 'data_file' },
      { id: null, file_id: 'f-zip', filename: 'logs.zip', injected_as: 'attachment' },
      { id: null, file_id: 'f-pdf', filename: 'report.pdf', injected_as: 'provider' },
      { id: null, file_id: 'f-img', filename: 'photo.png', injected_as: 'image' },
      { id: 'pwc-doc', filename: 'notes.md', injected_as: 'summary' },
      { id: 'x', filename: 'unknown.bin', injected_as: 'something_else' },
    ],
    websites: [],
  },
});

describe('long-term memory files', () => {
  it('lists every kind in reading order, leaving unknown kinds out', () => {
    const documents = longTermMemory.payload?.documents ?? [];
    expect(
      labeledMemoryDocuments(documents).map(({ labelKey, document }) => [
        tZh(labelKey),
        document.filename,
      ]),
    ).toEqual([
      ['檔案內容注入', 'notes.md'],
      ['原檔交給模型', 'report.pdf'],
      ['圖片交給模型', 'photo.png'],
      ['掛載為檔案', 'sales.xlsx'],
      ['附件（未直接交給模型）', 'logs.zip'],
    ]);
  });

  it('lists each file once, this message’s uploads first, skipping unknown kinds', () => {
    const documents = [
      { id: null, file_id: 'f-old', filename: 'old.xlsx', injected_as: 'data_file' },
      { id: null, file_id: 'f-new', filename: 'new.pdf', injected_as: 'provider' },
      { id: null, file_id: 'f-img', filename: 'photo.png', injected_as: 'image' },
      { id: null, file_id: 'x', filename: 'odd.bin', injected_as: 'something_else' },
    ];
    const files = overviewAttachments(documents, {
      files: [{ file_id: 'f-new' }, { file_id: 'f-img' }],
      filename: 'new.pdf, photo.png',
    });
    expect(
      files.map(({ filename, injectedAs, current, id }) => [filename, injectedAs, current, id]),
    ).toEqual([
      ['new.pdf', 'provider', true, 'f-new'],
      ['photo.png', 'image', true, 'f-img'],
      ['old.xlsx', 'data_file', false, 'f-old'],
    ]);
  });

  /** pwc_tars's own trace has no `upload_files`; its one upload is named by `upload_filename`. */
  it('marks the upload of a pwc_tars trace by its file name', () => {
    const files = overviewAttachments(
      [
        { id: 'pwc-1', filename: 'report.docx', injected_as: 'summary' },
        { id: 'pwc-2', filename: 'earlier.docx', injected_as: 'summary' },
      ],
      { filename: 'report.docx' },
    );
    expect(files.map(({ filename, current }) => [filename, current])).toEqual([
      ['report.docx', true],
      ['earlier.docx', false],
    ]);
    expect(overviewAttachments([], { filename: 'a.pdf' })).toEqual([]);
  });

  it('downloads a LibreChat attachment by its file_id and a pwc_tars document by its id', () => {
    expect(memoryDocumentId({ id: null, file_id: 'f-1' })).toBe('f-1');
    expect(memoryDocumentId({ id: 'pwc-doc' })).toBe('pwc-doc');
    expect(memoryDocumentId({ id: null, file_id: null })).toBeNull();
  });

  it('prints each file with its id and points to the panel, never an address that needs a session', () => {
    const summary = summarizeTrace({
      message,
      user: null,
      unapplied_regenerate_count: 0,
      conversation_history: [],
      trace: [longTermMemory],
    });
    const lines = buildTraceDownloadText(tEn, summary).split('\n');
    const start = lines.indexOf(
      `${en.com_ui_tars_audit_trace_long_term_memory}${en.com_ui_tars_audit_trace_colon}`,
    );
    expect(lines.slice(start + 1, start + 12)).toEqual([
      `  ${en.com_ui_tars_audit_trace_download_in_panel}`,
      `  [${en.com_ui_tars_audit_trace_file_content_injected}] notes.md`,
      '    id: pwc-doc',
      `  [${en.com_ui_tars_audit_trace_original_file_sent}] report.pdf`,
      '    file_id: f-pdf',
      `  [${en.com_ui_tars_audit_trace_image_sent}] photo.png`,
      '    file_id: f-img',
      `  [${en.com_ui_tars_audit_trace_mounted_as_file}] sales.xlsx`,
      '    file_id: f-sheet',
      `  [${en.com_ui_tars_audit_trace_attachment_kept}] logs.zip`,
      '    file_id: f-zip',
    ]);
    expect(lines.join('\n')).not.toMatch(/https?:|\/api\//);
  });
});

describe('summarizeTrace', () => {
  it('sums usage, keeps the last plan and de-duplicates web sources', () => {
    const summary = summarizeTrace({
      message,
      user: null,
      unapplied_regenerate_count: 0,
      conversation_history: [],
      trace: [
        row('usage', { payload: { input_tokens: 10, output_tokens: 2 } }),
        row('usage', { payload: { input_tokens: 5, output_tokens: 1 } }),
        row('plan', { payload: { items: [{ content: 'old' }] } }),
        row('plan', { payload: { items: [{ content: 'new' }] } }),
        row('tool_result', { tool_name: 'web_search', payload: { sources: ['a', 'b'] } }),
        row('tool_result', { tool_name: 'web_fetch', payload: { sources: ['a'] } }),
        row('tool_result', { tool_name: 'knowledge_search', payload: { sources: ['f.pdf'] } }),
        row('message_stop', { payload: { finish_reason: 'stop' } }),
        row('message_stop', { payload: { finish_reason: 'length' } }),
      ],
    });
    expect([summary.totalIn, summary.totalOut]).toEqual([15, 3]);
    expect(summary.planRow?.payload?.items?.[0].content).toBe('new');
    expect(summary.webSources).toEqual(['a', 'b']);
    expect(summary.notableStops).toHaveLength(1);
  });

  it('computes TPS and TTFT from output tokens and model duration', () => {
    const summary = summarizeTrace({
      message: { ...message, response_latency: 2.5 },
      user: null,
      unapplied_regenerate_count: 0,
      conversation_history: [
        { role: 'user', content: 'Turn 1 prompt' },
        { role: 'assistant', content: 'Turn 1 reply' },
        { role: 'user', content: 'Turn 2 prompt' },
      ],
      trace: [
        row('turn', { turn: 1, started_at: at(0) }),
        row('text', { turn: 1, started_at: at(450), ended_at: at(2450), duration_ms: 2000 }),
        row('usage', { payload: { input_tokens: 100, output_tokens: 50 } }),
        row('status', { payload: { kind: 'compact', message: 'Context compacted' } }),
      ],
    });

    expect(summary.totalOut).toBe(50);
    expect(summary.generationDurationMs).toBe(2000);
    expect(summary.promptTps).toBe(222.22);
    expect(summary.tps).toBe(25);
    expect(summary.modelPercent).toBe(98);
    expect(summary.toolWaitPercent).toBe(null);
    expect(summary.otherPercent).toBe(2);
    expect(summary.historyTurns).toBe(2);
    expect(summary.historyMessageCount).toBe(3);
    expect(summary.hasContextCompaction).toBe(true);
    expect(summary.hasTurnLimit).toBe(false);
  });

  it('calculates generation duration and TPS strictly for the final reply bar', () => {
    const summary = summarizeTrace({
      message: { ...message, response_latency: 6.0 },
      user: null,
      unapplied_regenerate_count: 0,
      conversation_history: [],
      trace: [
        row('turn', { turn: 1, started_at: at(0) }),
        row('text', { turn: 1, started_at: at(200), ended_at: at(700), duration_ms: 500 }),
        row('usage', { turn: 1, payload: { input_tokens: 500, output_tokens: 20 } }),
        row('tool_call', { turn: 1, tool_use_id: 't1', started_at: at(700) }),
        row('tool_result', {
          turn: 1,
          tool_use_id: 't1',
          started_at: at(700),
          ended_at: at(2000),
          duration_ms: 1300,
        }),
        row('turn', { turn: 2, started_at: at(2000) }),
        row('text', { turn: 2, started_at: at(2500), ended_at: at(4500), duration_ms: 2000 }),
        row('usage', { turn: 2, payload: { input_tokens: 1200, output_tokens: 80 } }),
      ],
    });

    expect(summary.totalOut).toBe(100);
    expect(summary.generationDurationMs).toBe(2000);
    expect(summary.promptTps).toBe(2400);
    expect(summary.tps).toBe(40);
    expect(summary.modelPercent).toBe(53.3);
    expect(summary.toolWaitPercent).toBe(21.7);
    expect(summary.otherPercent).toBe(25);
  });

  it('computes tool wait duration and proportion against total latency', () => {
    const summary = summarizeTrace({
      message: { ...message, response_latency: 5.0 },
      user: null,
      unapplied_regenerate_count: 0,
      conversation_history: [],
      trace: [
        row('turn', { turn: 1, started_at: at(0) }),
        row('tool_call', { tool_use_id: 't1', started_at: at(500) }),
        row('tool_result', {
          tool_use_id: 't1',
          started_at: at(500),
          ended_at: at(1500),
          duration_ms: 1000,
        }),
        row('tool_call', { tool_use_id: 't2', started_at: at(2000) }),
        row('tool_result', {
          tool_use_id: 't2',
          started_at: at(2000),
          ended_at: at(3000),
          duration_ms: 1000,
        }),
      ],
    });

    expect(summary.toolWaitDurationMs).toBe(2000);
    expect(summary.toolWaitPercent).toBe(40);
  });

  it('splits tool wait duration between successful and failed tools', () => {
    const summary = summarizeTrace({
      message: { ...message, response_latency: 10.0 },
      user: null,
      unapplied_regenerate_count: 0,
      conversation_history: [],
      trace: [
        row('turn', { turn: 1, started_at: at(0) }),
        row('tool_call', { tool_use_id: 't1', started_at: at(500) }),
        row('tool_result', {
          tool_use_id: 't1',
          started_at: at(500),
          ended_at: at(1500),
          duration_ms: 1000,
          ok: true,
        }),
        row('tool_call', { tool_use_id: 't2', started_at: at(2000) }),
        row('tool_result', {
          tool_use_id: 't2',
          started_at: at(2000),
          ended_at: at(4000),
          duration_ms: 2000,
          ok: false,
        }),
      ],
    });

    expect(summary.toolWaitDurationMs).toBe(3000);
    expect(summary.toolWaitPercent).toBe(30);
    expect(summary.toolSuccessWaitMs).toBe(1000);
    expect(summary.toolSuccessPercent).toBe(10);
    expect(summary.toolFailWaitMs).toBe(2000);
    expect(summary.toolFailPercent).toBe(20);
  });
});

describe('annotateHistoryTurns', () => {
  it('returns empty array for empty history', () => {
    expect(annotateHistoryTurns([])).toEqual([]);
  });

  it('tags user and assistant turns in sequential order', () => {
    const history = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'How are you?' },
      { role: 'assistant', content: 'Doing great' },
    ];
    const annotated = annotateHistoryTurns(history);
    expect(annotated).toEqual([
      { turnIndex: 1, role: 'user', content: 'Hello' },
      { turnIndex: 1, role: 'assistant', content: 'Hi there' },
      { turnIndex: 2, role: 'user', content: 'How are you?' },
      { turnIndex: 2, role: 'assistant', content: 'Doing great' },
    ]);
  });
});

describe('retryFailureReason', () => {
  it('quotes the failed attempt’s result, cut to a readable length', () => {
    const long = 'x'.repeat(RETRY_REASON_MAX_CHARS + 30);
    const trace = [
      row('tool_result', { tool_use_id: 'c1', payload: { summary: 'rate limited' } }),
      row('tool_result', { tool_use_id: 'c2', payload: { output: long } }),
    ];
    expect(retryFailureReason(trace, 'c1')).toBe('rate limited');
    expect(retryFailureReason(trace, 'c2')).toBe(`${'x'.repeat(RETRY_REASON_MAX_CHARS)}…`);
  });

  /** A null retry_of must not pair with the trace’s rows that carry no tool_use_id. */
  it('names no reason when the retry does not say which attempt it replaces', () => {
    const trace = [row('tool_result', { tool_use_id: null, payload: { output: 'unrelated' } })];
    expect(retryFailureReason(trace, null)).toBe('—');
    expect(retryFailureReason(trace, 'missing')).toBe('—');
  });
});

describe('finishReasonLabel', () => {
  it('returns null for empty reason', () => {
    expect(finishReasonLabel(t as any, null)).toBeNull();
    expect(finishReasonLabel(t as any, '')).toBeNull();
  });

  it('maps stop to good tone', () => {
    const res = finishReasonLabel(t as any, 'stop');
    expect(res?.tone).toBe('good');
    expect(res?.label).toBe('com_ui_tars_audit_trace_finish_stop');
  });

  it('maps length to warn tone', () => {
    const res = finishReasonLabel(t as any, 'length');
    expect(res?.tone).toBe('warn');
    expect(res?.label).toBe('com_ui_tars_audit_trace_finish_length');
  });

  it('maps content_filter to bad tone', () => {
    const res = finishReasonLabel(t as any, 'content_filter');
    expect(res?.tone).toBe('bad');
    expect(res?.label).toBe('com_ui_tars_audit_trace_finish_content_filter');
  });

  it('falls back to neutral tone for custom reason', () => {
    const res = finishReasonLabel(t as any, 'custom_stop');
    expect(res?.tone).toBe('neutral');
    expect(res?.label).toBe('custom_stop');
  });
});

describe('buildDetailExportJson', () => {
  it('builds a clean structured JSON object for a tool call', () => {
    const callRow = row('tool_call', {
      tool_name: 'search_kb',
      tool_use_id: 'call_1',
      turn: 1,
      started_at: '2026-10-09T10:00:00.000Z',
      payload: { input: JSON.stringify({ query: 'hello' }) },
    });
    const resultRow = row('tool_result', {
      tool_name: 'search_kb',
      tool_use_id: 'call_1',
      ok: true,
      duration_ms: 150,
      ended_at: '2026-10-09T10:00:00.150Z',
      payload: {
        output: JSON.stringify({ results: ['item1'] }),
        sources: ['https://example.com/1'],
      },
    });

    const exportData = buildDetailExportJson(callRow, callRow, resultRow);
    expect(exportData).toEqual({
      tool_name: 'search_kb',
      tool_use_id: 'call_1',
      status: 'success',
      ok: true,
      duration_ms: 150,
      turn: 1,
      started_at: '2026-10-09T10:00:00.000Z',
      ended_at: '2026-10-09T10:00:00.150Z',
      input: { query: 'hello' },
      output: { results: ['item1'] },
      sources: ['https://example.com/1'],
    });
  });

  it('includes error information for a failed tool call', () => {
    const callRow = row('tool_call', {
      tool_name: 'execute_code',
      tool_use_id: 'call_2',
      attempt: 2,
      retry_of: 'call_1',
      payload: { input: { code: '1/0' } },
    });
    const resultRow = row('tool_result', {
      tool_name: 'execute_code',
      tool_use_id: 'call_2',
      ok: false,
      duration_ms: 300,
      payload: {
        output: 'ZeroDivisionError',
        error_message: 'ZeroDivisionError: division by zero',
        truncated: true,
        output_len_chars: 100,
      },
    });

    const exportData = buildDetailExportJson(resultRow, callRow, resultRow);
    expect(exportData).toEqual({
      tool_name: 'execute_code',
      tool_use_id: 'call_2',
      status: 'error',
      ok: false,
      duration_ms: 300,
      attempt: 2,
      retry_of: 'call_1',
      turn: 1,
      input: { code: '1/0' },
      output: 'ZeroDivisionError',
      error_message: 'ZeroDivisionError: division by zero',
      truncated: true,
      output_len_chars: 100,
    });
  });

  it('handles non-tool trace rows gracefully', () => {
    const modelRow = row('model', {
      duration_ms: 1200,
      payload: { text: 'Hello, how can I help?' },
    });

    const exportData = buildDetailExportJson(modelRow, undefined, undefined);
    expect(exportData).toEqual({
      event_type: 'model',
      duration_ms: 1200,
      payload: { text: 'Hello, how can I help?' },
    });
  });
});
