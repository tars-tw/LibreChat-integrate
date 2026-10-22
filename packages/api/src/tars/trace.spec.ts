jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { ContentTypes } from 'librechat-data-provider';
import { formatAgentMessages, createContentAggregator } from '@librechat/agents';
import { noteTarsMcpToolCall, noteTarsMcpToolError, takeTarsFailedToolCalls } from './failure';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { TarsStepTiming, TarsTraceInput, TarsTraceRecord } from './trace';
import {
  sumTarsUsage,
  resolveTarsUsage,
  stampTarsStepTiming,
  buildTarsMirrorTrace,
  noteTarsFinishReason,
  buildTarsTraceRecords,
  resolveTarsTurnSwitches,
} from './trace';

const T0 = Date.UTC(2026, 9, 8, 2, 0, 0);
const at = (ms: number) => new Date(T0 + ms).toISOString().replace('Z', '+00:00');

const think = (text: string) => ({ type: ContentTypes.THINK, think: text }) as TMessageContentParts;
const text = (value: string) => ({ type: ContentTypes.TEXT, text: value }) as TMessageContentParts;
const toolCall = (fields: Record<string, unknown>) =>
  ({ type: ContentTypes.TOOL_CALL, tool_call: fields }) as unknown as TMessageContentParts;

const build = (overrides: Partial<TarsTraceInput> = {}) =>
  buildTarsTraceRecords({
    query: 'Which flights?',
    startedAt: T0,
    finishedAt: T0 + 5000,
    model: 'gpt-5.4-mini',
    ...overrides,
  });

const ofType = (records: TarsTraceRecord[], type: string) =>
  records.filter((record) => record.type === type);

describe('buildTarsTraceRecords', () => {
  it('opens with the request, its switches and the run settings', () => {
    const records = build({
      endpoint: 'agents',
      agentId: 'ephemeral',
      isRegenerate: true,
      turnFiles: [
        { file_id: 'f-pdf', filename: 'a.pdf', type: 'application/pdf' },
        { file_id: 'f-img', filename: 'b.png', type: 'image/png' },
        { filename: 'legacy.txt' },
        null,
      ],
      ephemeralAgent: { web_search: true, sql_agent: true, mcp: ['tars_github'] },
      modelParameters: { temperature: 0.3, reasoning_effort: 'low' },
      availableTools: ['web_search', { name: 'tars_sql_query' }, null],
    });

    expect(records.slice(0, 3).map((record) => record.type)).toEqual([
      'request',
      'request_raw',
      'provenance',
    ]);
    expect(records[0]).toMatchObject({ source: 'librechat', query: 'Which flights?' });
    expect(build({ domainId: 100 })[0]).toMatchObject({ domain_id: '100' });
    expect(records[0]).toMatchObject({ domain_id: null });
    /** 知識庫檢索 was off, so pwc_tars must not fill the brain's knowledge bases in. */
    expect(records[0]).not.toHaveProperty('uses_brain_knowledge_bases');
    expect(build({ ephemeralAgent: { rag_agent: true } })[0]).toMatchObject({
      uses_brain_knowledge_bases: true,
    });
    expect(records[1].payload).toMatchObject({
      source: 'librechat',
      reasoning_effort: 'low',
      upload_filename: 'a.pdf, b.png, legacy.txt',
      upload_files: [
        { file_id: 'f-pdf', filename: 'a.pdf' },
        { file_id: 'f-img', filename: 'b.png' },
      ],
      is_database_bound: true,
      is_enable_web_search: true,
      is_file_generate_active: false,
      is_mcp_enabled: true,
      is_regenerate: true,
    });
    expect(records[2]).toMatchObject({
      model_name: 'gpt-5.4-mini',
      temperature: 0.3,
      mcp_servers: [{ name: 'tars_github' }],
      available_tools: ['web_search', 'tars_sql_query'],
      image_input_count: 1,
    });
    expect(build({})[1].payload).toMatchObject({ upload_filename: null, upload_files: [] });
    expect(build({})[2]).not.toHaveProperty('image_input_count');
    for (const record of records.slice(0, 3)) {
      expect(record.started_at).toBe(at(0));
    }
  });

  /** `model_parameters` is the whole client config; only the settings themselves are recorded. */
  it('records the model settings but never the client config’s credentials', () => {
    const provenance = ofType(
      build({
        modelParameters: {
          model: 'gpt-5.5',
          apiKey: 'sk-live',
          user: 'librechat-user-id',
          max_tokens: 4096,
          reasoning: { effort: 'high', summary: 'auto' },
          thinking: { type: 'enabled', budget_tokens: 2048, apiKey: 'nested' },
          configuration: {
            baseURL: 'https://user:pass@api.example.com/v1?key=x',
            defaultHeaders: { Authorization: 'Bearer x' },
            fetchOptions: { dispatcher: {} },
          },
        },
      }),
      'provenance',
    )[0];

    expect(provenance.model_kwargs).toEqual({
      model: 'gpt-5.5',
      max_tokens: 4096,
      reasoning: { effort: 'high', summary: 'auto' },
      thinking: { type: 'enabled', budget_tokens: 2048 },
    });
    expect(provenance.model_endpoint).toBe('https://api.example.com/v1');
    expect(JSON.stringify(provenance)).not.toMatch(/sk-live|Bearer|pass@|nested/);
    expect(
      ofType(build({ modelParameters: { reasoning: { effort: 'high' } } }), 'request_raw')[0],
    ).toMatchObject({ payload: { reasoning_effort: 'high' } });
  });

  it('records a model that thought without a configured effort as thinking by default', () => {
    const effort = (overrides: Partial<TarsTraceInput>) =>
      ofType(build(overrides), 'request_raw')[0].payload as Record<string, unknown>;
    expect(effort({ content: [think('plan'), text('answer')] }).reasoning_effort).toBe('default');
    expect(effort({ content: [text('answer')] }).reasoning_effort).toBeNull();
    expect(
      effort({ content: [think('plan')], modelParameters: { reasoning_effort: 'low' } })
        .reasoning_effort,
    ).toBe('low');
  });

  /** A saved agent carries its capabilities as tools; it has no chat switches. */
  it('reads a saved agent’s switches off the tools it was equipped with', () => {
    expect(
      resolveTarsTurnSwitches(null, [
        'tars_knowledge_search',
        { name: 'tars_sql_query' },
        'web_search',
        'list_issues_mcp_tars_bug-tracker',
      ]),
    ).toEqual({
      knowledge: true,
      database: true,
      webSearch: true,
      fileGenerate: false,
      mcpServers: ['tars_bug-tracker'],
    });
    const records = build({ availableTools: ['tars_knowledge_search', 'tars_generate_file'] });
    expect(records[0]).toMatchObject({ uses_brain_knowledge_bases: true });
    expect(records[1].payload).toMatchObject({
      is_file_generate_active: true,
      is_database_bound: false,
    });
  });

  it('keeps side calls such as summarization from shifting the turn numbers', () => {
    const usage = ofType(
      build({
        usage: [
          { input_tokens: 10, output_tokens: 1 },
          { input_tokens: 50, output_tokens: 5, usage_type: 'summarization' },
          { input_tokens: 20, output_tokens: 2 },
        ],
      }),
      'usage',
    );
    expect(usage.map(({ turn, source }) => ({ turn, source }))).toEqual([
      { turn: 1, source: undefined },
      { turn: 1, source: 'summarization' },
      { turn: 2, source: undefined },
    ]);
  });

  it('lists the spreadsheets the data tools could query as data files', () => {
    const provenance = ofType(
      build({ threadFiles: { dataFiles: [{ filename: 'sales.xlsx' }] } }),
      'provenance',
    )[0];
    expect(provenance.data_files).toEqual(['sales.xlsx']);
  });

  /** Tool calls are measured: dispatch → close, as the agents run stamped them. */
  it('times each tool call from dispatch to close and pairs call with result', () => {
    const records = build({
      content: [
        think('need data'),
        toolCall({
          id: 'call_1',
          name: 'web_search',
          args: '{"query":"NRT"}',
          output: 'three results',
          toolPreparationStartedAt: T0 + 800,
          toolDispatchedAt: T0 + 1000,
          runStepClosedAt: T0 + 2500,
          runStepStatus: 'completed',
        }),
        text('Here are the flights.'),
      ],
    });

    const [call] = ofType(records, 'tool_call');
    const [result] = ofType(records, 'tool_result');
    expect(call).toMatchObject({
      id: 'call_1',
      name: 'web_search',
      input: { query: 'NRT' },
      turn: 1,
      attempt: 1,
      started_at: at(1000),
    });
    expect(call).not.toHaveProperty('timing');
    expect(result).toMatchObject({
      id: 'call_1',
      ok: true,
      output: 'three results',
      started_at: at(1000),
      ended_at: at(2500),
      duration_ms: 1500,
    });
  });

  /**
   * Model text has no timestamps: it fills the gap before the turn's first
   * tool call starts streaming (or the response ends), split in order.
   */
  it('places thinking and answer text in the gaps around tool calls and marks them inferred', () => {
    const records = build({
      content: [
        think('plan'),
        text('Let me search.'),
        toolCall({
          id: 'call_1',
          name: 'web_search',
          toolPreparationStartedAt: T0 + 1000,
          toolDispatchedAt: T0 + 1200,
          runStepClosedAt: T0 + 3000,
          runStepStatus: 'completed',
        }),
        text('Done.'),
      ],
    });

    expect(ofType(records, 'turn').map((turn) => [turn.turn, turn.started_at])).toEqual([
      [1, at(0)],
      [2, at(3000)],
    ]);
    const model = records.filter((record) => record.type === 'thinking' || record.type === 'text');
    expect(
      model.map((record) => [record.type, record.turn, record.started_at, record.ended_at]),
    ).toEqual([
      ['thinking', 1, at(0), at(500)],
      ['text', 1, at(500), at(1000)],
      ['text', 2, at(3000), at(5000)],
    ]);
    expect(model.every((record) => record.timing === 'inferred')).toBe(true);
  });

  it('reads the function-call shape and flags a failed step', () => {
    const records = build({
      content: [
        toolCall({
          id: 'fn_1',
          type: 'function',
          function: { name: 'sql_query', arguments: '{"sql":"select 1"}', output: 'syntax error' },
          toolDispatchedAt: T0 + 100,
          runStepClosedAt: T0 + 200,
          runStepStatus: 'failed',
        }),
      ],
    });
    expect(ofType(records, 'tool_call')[0]).toMatchObject({
      name: 'sql_query',
      input: { sql: 'select 1' },
    });
    expect(ofType(records, 'tool_result')[0]).toMatchObject({ ok: false, output: 'syntax error' });
  });

  it('falls back to the turn boundary for an untimed call and says so', () => {
    const records = build({
      content: [think('x'), toolCall({ id: 'c', name: 'tool_a', args: 'not json' })],
    });
    const [call] = ofType(records, 'tool_call');
    const [result] = ofType(records, 'tool_result');
    expect(call).toMatchObject({ input: 'not json', timing: 'inferred' });
    expect(result).toMatchObject({ ok: null, output: null, duration_ms: 0 });
  });

  it('records one usage row per model call and turns error parts into error rows', () => {
    const records = build({
      content: [
        { type: ContentTypes.ERROR, error: 'rate limited' } as TMessageContentParts,
        text('partial'),
      ],
      usage: [
        { input_tokens: 1200, output_tokens: 40, model: 'gpt-5.4-mini' },
        { input_tokens: 1500, output_tokens: 300 },
      ],
    });
    expect(ofType(records, 'usage')).toEqual([
      expect.objectContaining({ turn: 1, input_tokens: 1200, output_tokens: 40 }),
      expect.objectContaining({ turn: 2, input_tokens: 1500, output_tokens: 300 }),
    ]);
    expect(ofType(records, 'error')).toEqual([
      expect.objectContaining({ error_code: 'librechat_error', message: 'rate limited' }),
    ]);
  });

  it('starts at the first tool call when the turn start is unknown', () => {
    const records = build({
      startedAt: null,
      content: [
        toolCall({ id: 'c', name: 't', toolDispatchedAt: T0 + 700, runStepClosedAt: T0 + 900 }),
      ],
    });
    expect(records[0].started_at).toBe(at(700));
  });

  it('skips holes and empty parts in sparse content', () => {
    const records = build({ content: [null, undefined, text(''), text('only')] });
    expect(ofType(records, 'text')).toHaveLength(1);
    expect(ofType(records, 'turn')).toHaveLength(1);
  });

  /** LibreChat's MCP client drops `isError`, so the step itself still closes as completed. */
  it('records a TARS tool that answered with a failure as failed', () => {
    const records = build({
      content: [
        toolCall({
          id: 'c',
          name: 'Models_mcp_tars_vLLM',
          runStepStatus: 'completed',
          output: 'TARS tool call failed: pwc_tars request to /api/mcp/execute returned status 500',
        }),
        toolCall({ id: 'd', name: 'web', runStepStatus: 'completed', output: 'fine' }),
      ],
    });
    expect(ofType(records, 'tool_result').map((record) => record.ok)).toEqual([false, true]);
  });

  /** A steer reached the model mid-turn; the audit report shows it where it landed. */
  it('records what the user sent during the run as a steer status row', () => {
    const records = build({
      content: [
        text('working on it'),
        { type: 'steer', steer: ' 只看台灣的資料 ', createdAt: T0 + 1500 } as never,
        { type: 'steer', steer: '   ' } as never,
        text('done'),
      ],
    });
    expect(ofType(records, 'status')).toEqual([
      { type: 'status', kind: 'steer', message: '只看台灣的資料', started_at: at(1500) },
    ]);
  });

  /** The SDK answers a thrown tool in text and still closes its step as completed. */
  it('records a tool the SDK reported as thrown as failed', () => {
    const records = build({
      content: [
        toolCall({
          id: 'thrown',
          name: 'web_search',
          runStepStatus: 'completed',
          output: 'Error: fetch failed\n Please fix your mistakes.',
        }),
      ],
    });
    expect(ofType(records, 'tool_result')[0].ok).toBe(false);
  });

  it('lists the charts and files a TARS tool generated among its sources', () => {
    const records = build({
      content: [toolCall({ id: 'chart', name: 'tars_create_chart', output: 'done' })],
      attachments: [
        {
          type: 'tars_trace',
          toolCallId: 'chart',
          tars_trace: {
            step: { ok: true, links: [{ type: 'chart', url: '/api/tars/assets/c.png' }] },
          },
        },
      ],
    });
    expect(ofType(records, 'tool_result')[0].sources).toEqual(['/api/tars/assets/c.png']);
  });

  it('lists the files a tool wrote, such as Python output, among its sources', () => {
    const records = build({
      content: [
        toolCall({ id: 'py', name: 'execute_code', output: 'stdout:\nsaved\n' }),
        toolCall({ id: 'search', name: 'web_search', output: 'results' }),
      ],
      attachments: [
        { type: 'image/png', toolCallId: 'py', file_id: 'f-1', filename: 'plot.png' },
        { type: 'text/csv', toolCallId: 'py', file_id: 'f-2', filename: 'result.csv' },
        // The same file reported twice (e.g. its preview update) is listed once.
        { type: 'text/csv', toolCallId: 'py', file_id: 'f-2', filename: 'result.csv' },
        // Attachments that describe a call carry no file of their own.
        { type: 'web_search', toolCallId: 'search', file_id: 'x', filename: 'x' },
      ],
    });
    const [py, search] = ofType(records, 'tool_result');
    expect(py.sources).toEqual(['plot.png', 'result.csv']);
    expect(search.sources).toBeUndefined();
  });

  /** A third-party MCP server's `isError` never reaches the content part. */
  it('records a call its MCP server reported as an error as failed', () => {
    const formatted: [string, undefined] = ['quota exceeded', undefined];
    noteTarsMcpToolError(formatted, { isError: true });
    noteTarsMcpToolCall('mcp-call', formatted, { user_id: 'u-1', thread_id: 'c-1' });

    const records = build({
      failedToolCalls: takeTarsFailedToolCalls('u-1', 'c-1'),
      content: [
        toolCall({
          id: 'mcp-call',
          name: 'lookup_mcp_third_party',
          runStepStatus: 'completed',
          output: 'quota exceeded',
        }),
      ],
    });
    expect(ofType(records, 'tool_result')[0].ok).toBe(false);
  });

  it('places pwc_tars’s retrieval detail under the call that searched', () => {
    const records = build({
      content: [
        toolCall({
          id: 'c',
          name: 'tars_knowledge_search',
          toolDispatchedAt: T0 + 100,
          runStepClosedAt: T0 + 900,
          output: '[1] source: a.pdf',
        }),
      ],
      toolAuditTrace: new Map([
        ['c', [{ type: 'rag_retrieval', parent_id: '', query: 'q', documents: [{ pk: 1 }] }]],
        ['other-call', [{ type: 'rag_retrieval', parent_id: '' }]],
      ]),
    });
    const types = records.map((record) => record.type);
    expect(types.indexOf('rag_retrieval')).toBe(types.indexOf('tool_result') + 1);
    expect(ofType(records, 'rag_retrieval')).toEqual([
      {
        type: 'rag_retrieval',
        parent_id: 'c',
        turn: 1,
        started_at: at(900),
        query: 'q',
        documents: [{ pk: 1 }],
      },
    ]);
  });

  /** pwc_tars keeps a TARS tool's summary and the files or pages it read on `tool_result`. */
  it('takes each call’s summary, sources and outcome from its attachments', () => {
    const records = build({
      content: [
        toolCall({ id: 'kb', name: 'tars_knowledge_search', output: '[1] source: a.pdf' }),
        toolCall({ id: 'web', name: 'web_search', output: 'results' }),
        toolCall({ id: 'sql', name: 'tars_sql_query', runStepStatus: 'completed', output: 'x' }),
      ],
      attachments: [
        {
          type: 'tars_trace',
          toolCallId: 'kb',
          tars_trace: {
            step: {
              ok: true,
              summary: '2 chunks',
              sources: [{ filename: 'a.pdf', chunks: 2 }],
            },
          },
        },
        {
          type: 'web_search',
          toolCallId: 'web',
          web_search: {
            organic: [{ link: 'https://a.example' }, { link: 'https://a.example' }],
            topStories: [{ link: 'https://b.example' }],
          },
        },
        { type: 'tars_trace', toolCallId: 'sql', tars_trace: { step: { ok: false } } },
        null,
      ],
    });
    const [kb, web, sql] = ofType(records, 'tool_result');
    expect(kb).toMatchObject({ summary: '2 chunks', sources: ['a.pdf'] });
    expect(web.sources).toEqual(['https://a.example', 'https://b.example']);
    expect(sql.ok).toBe(false);
  });

  /** The audit report flags a call cut off by its token limit or a content filter. */
  it('records why each model call stopped beside its usage', () => {
    const first = { input_tokens: 10, output_tokens: 5 };
    const second = { input_tokens: 20, output_tokens: 4096 };
    noteTarsFinishReason(first, { response_metadata: { finish_reason: 'tool_calls' } });
    noteTarsFinishReason(second, { response_metadata: { stop_reason: 'max_tokens' } });
    noteTarsFinishReason(null, { response_metadata: { finish_reason: 'stop' } });

    const stops = ofType(build({ usage: [first, second] }), 'message_stop');
    expect(stops.map(({ turn, finish_reason }) => ({ turn, finish_reason }))).toEqual([
      { turn: 1, finish_reason: 'tool_calls' },
      { turn: 2, finish_reason: 'max_tokens' },
    ]);
    /** The usage entry is billing data: nothing is written onto it. */
    expect(second).toEqual({ input_tokens: 20, output_tokens: 4096 });
  });

  /** pwc_tars counts a tool's own model calls in the message totals. */
  it('records the tokens a TARS tool spent itself as a usage row under the call', () => {
    const records = build({
      content: [toolCall({ id: 'kb', name: 'tars_knowledge_search', runStepClosedAt: T0 + 900 })],
      usage: [{ input_tokens: 100, output_tokens: 10 }],
      toolUsage: new Map([['kb', { input_tokens: 40, output_tokens: 5 }]]),
    });
    expect(ofType(records, 'usage')).toEqual([
      expect.objectContaining({
        parent_id: 'kb',
        input_tokens: 40,
        output_tokens: 5,
        source: 'tool',
      }),
      expect.objectContaining({ input_tokens: 100, output_tokens: 10 }),
    ]);
  });

  it('merges the retrieval settings pwc_tars returned into the turn’s provenance', () => {
    const records = build({
      content: [toolCall({ id: 'c', name: 'tars_knowledge_search' })],
      toolAuditTrace: new Map([
        [
          'c',
          [
            { type: 'rag_retrieval', parent_id: '', query: 'q' },
            {
              type: 'provenance',
              rerank_backend: 'bge',
              embedding_profiles: [{ kb: 'LLM' }],
              milvus_url: 'milvus.local',
              retrieval_params: { default_limit: 5 },
            },
          ],
        ],
      ]),
    });
    expect(ofType(records, 'provenance')).toHaveLength(1);
    expect(ofType(records, 'provenance')[0]).toMatchObject({
      rerank_backend: 'bge',
      embedding_profiles: [{ kb: 'LLM' }],
      milvus_url: 'milvus.local',
      retrieval_params: { default_limit: 5 },
    });
  });

  it('lists the thread’s attachments as the long-term memory row', () => {
    const records = build({
      threadFiles: {
        textFiles: [{ filename: 'notes.md' }],
        dataFiles: [{ filename: 'sales.xlsx' }],
      },
    });
    expect(ofType(records, 'long_term_memory')).toEqual([
      expect.objectContaining({
        documents: [
          { id: null, file_id: null, filename: 'notes.md', injected_as: 'summary' },
          { id: null, file_id: null, filename: 'sales.xlsx', injected_as: 'data_file' },
        ],
        websites: [],
      }),
    ]);
    expect(
      ofType(build({ threadFiles: { dataFiles: [], textFiles: [] } }), 'long_term_memory'),
    ).toEqual([]);
  });

  it('names every attachment by its file_id, whichever way it reached the model', () => {
    const records = build({
      threadFiles: {
        textFiles: [{ id: 'f-text-1', filename: 'notes.md' }],
        providerFiles: [{ id: 'f-pdf-1', filename: 'report.pdf' }],
        imageFiles: [{ id: 'f-img-1', filename: 'photo.png' }],
        dataFiles: [{ id: 'f-data-1', filename: 'sales.xlsx' }],
        otherFiles: [{ id: 'f-zip-1', filename: 'logs.zip' }],
      },
    });
    expect(ofType(records, 'long_term_memory')).toEqual([
      expect.objectContaining({
        documents: [
          { id: null, file_id: 'f-text-1', filename: 'notes.md', injected_as: 'summary' },
          { id: null, file_id: 'f-pdf-1', filename: 'report.pdf', injected_as: 'provider' },
          { id: null, file_id: 'f-img-1', filename: 'photo.png', injected_as: 'image' },
          { id: null, file_id: 'f-data-1', filename: 'sales.xlsx', injected_as: 'data_file' },
          { id: null, file_id: 'f-zip-1', filename: 'logs.zip', injected_as: 'attachment' },
        ],
        websites: [],
      }),
    ]);
  });

  /** pwc_tars `sanitize_external_trace` sets every document's `id` to null and keeps the rest. */
  it('keeps the download id through pwc_tars clearing document ids', () => {
    const [row] = ofType(
      build({ threadFiles: { imageFiles: [{ id: 'f-img-1', filename: 'photo.png' }] } }),
      'long_term_memory',
    );
    const stored = (row.documents as Record<string, unknown>[]).map((doc) => ({
      ...doc,
      id: null,
    }));
    expect(stored).toEqual([
      { id: null, file_id: 'f-img-1', filename: 'photo.png', injected_as: 'image' },
    ]);
  });

  it('trims the blank lines a reasoning model opens its answer with', () => {
    const records = build({ content: [think('\nplan\n'), text('\n\nanswer\n'), text('\n\n')] });
    expect(ofType(records, 'thinking')[0].text).toBe('plan');
    expect(ofType(records, 'text').map((record) => record.text)).toEqual(['answer']);
  });
});

describe('buildTarsMirrorTrace', () => {
  /** A trace bug must never stop the message itself from being mirrored. */
  it('returns undefined instead of throwing', () => {
    const broken = {
      query: 'q',
      finishedAt: T0,
      get content(): never {
        throw new Error('boom');
      },
    } as unknown as TarsTraceInput;
    expect(buildTarsMirrorTrace(broken)).toBeUndefined();
  });
});

describe('stampTarsStepTiming', () => {
  it('stamps a thinking or text part with its step’s open and close times', () => {
    const think: Record<string, unknown> = { type: ContentTypes.THINK, think: 'a' };
    const text: Record<string, unknown> = { type: ContentTypes.TEXT, text: 'b' };
    stampTarsStepTiming(think, { created_at: T0 + 10, closed_at: T0 + 400 });
    stampTarsStepTiming(text, { created_at: T0 + 400, closed_at: T0 + 900 });
    expect(think).toMatchObject({ tarsStepStartedAt: T0 + 10, tarsStepClosedAt: T0 + 400 });
    expect(text).toMatchObject({ tarsStepStartedAt: T0 + 400, tarsStepClosedAt: T0 + 900 });
  });

  /** Upstream owns tool-call timing; this never touches those parts. */
  it('leaves tool calls and other parts alone', () => {
    const tool: Record<string, unknown> = { type: ContentTypes.TOOL_CALL, tool_call: {} };
    stampTarsStepTiming(tool, { created_at: T0, closed_at: T0 + 1 });
    stampTarsStepTiming(undefined, { created_at: T0, closed_at: T0 + 1 });
    expect(tool).not.toHaveProperty('tarsStepStartedAt');
  });

  /**
   * The SDK replays a saved text part as-is, and OpenAI's chat completions
   * reject unknown fields, so a leaked stamp would fail the next turn.
   */
  it('keeps the stamps out of JSON: the saved message and the next provider request', () => {
    const answer: Record<string, unknown> = { type: ContentTypes.TEXT, text: 'Let me look.' };
    stampTarsStepTiming(answer, { created_at: T0, closed_at: T0 + 100 });
    expect(answer.tarsStepStartedAt).toBe(T0);
    expect(JSON.stringify(answer)).toBe(
      JSON.stringify({ type: ContentTypes.TEXT, text: 'Let me look.' }),
    );

    const formatted = formatAgentMessages(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            answer,
            {
              type: ContentTypes.TOOL_CALL,
              tool_call: { id: 'call-1', name: 'search', args: '{}', output: 'ok' },
            },
          ],
        },
        { role: 'user', content: 'again' },
      ] as Parameters<typeof formatAgentMessages>[0],
      undefined,
      new Set(['search']),
    );
    const sent = JSON.stringify(formatted.messages.map((message) => message.content));
    expect(sent).toContain('Let me look.');
    expect(sent).not.toContain('tarsStep');
  });

  it('records nothing it cannot trust', () => {
    const missing: Record<string, unknown> = { type: ContentTypes.TEXT };
    const reversed: Record<string, unknown> = { type: ContentTypes.TEXT };
    stampTarsStepTiming(missing, { closed_at: T0 });
    stampTarsStepTiming(reversed, { created_at: T0 + 5, closed_at: T0 });
    expect(missing).not.toHaveProperty('tarsStepStartedAt');
    expect(reversed).not.toHaveProperty('tarsStepStartedAt');
  });
});

describe('measured thinking and answer spans', () => {
  const stamped = (
    part: TMessageContentParts,
    start: number,
    end: number,
  ): TMessageContentParts & TarsStepTiming => ({
    ...part,
    tarsStepStartedAt: T0 + start,
    tarsStepClosedAt: T0 + end,
  });

  it('uses the stamped times and does not mark them inferred', () => {
    const records = build({
      content: [
        stamped(think('plan'), 300, 700),
        toolCall({
          id: 'c1',
          name: 'web_search',
          toolPreparationStartedAt: T0 + 700,
          toolDispatchedAt: T0 + 800,
          runStepClosedAt: T0 + 2000,
        }),
        stamped(text('Done.'), 2600, 4100),
      ],
    });
    const model = records.filter((record) => record.type === 'thinking' || record.type === 'text');
    expect(model.map((record) => [record.started_at, record.ended_at, record.timing])).toEqual([
      [at(300), at(700), undefined],
      [at(2600), at(4100), undefined],
    ]);
    /** The gap before the first chunk is real now, so the timeline shows the wait. */
    expect(records.find((record) => record.type === 'turn')?.started_at).toBe(at(0));
  });

  it('infers only the parts that lack a stamp', () => {
    const records = build({ content: [stamped(think('a'), 100, 500), text('unstamped')] });
    const model = records.filter((record) => record.type === 'thinking' || record.type === 'text');
    expect(model.map((record) => record.timing)).toEqual([undefined, 'inferred']);
  });
});

/**
 * The SDK aggregator rebuilds a part on every delta, dropping extra fields. A
 * stamp written at step closure survives because a step's deltas all arrive
 * before it closes — exercised against the real aggregator, as the run uses it.
 */
describe('stamping against the real content aggregator', () => {
  type Aggregator = ReturnType<typeof createContentAggregator>;
  type Parts = Record<string, unknown>[];

  const openStep = ({ aggregateContent }: Aggregator, id: string, index: number) =>
    aggregateContent({
      event: 'on_run_step',
      data: {
        id,
        index,
        type: 'message_creation',
        stepDetails: { type: 'message_creation', message_creation: { message_id: 'm' } },
      },
    } as Parameters<Aggregator['aggregateContent']>[0]);

  const delta = ({ aggregateContent }: Aggregator, event: string, id: string, part: object) =>
    aggregateContent({ event, data: { id, delta: { content: [part] } } } as Parameters<
      Aggregator['aggregateContent']
    >[0]);

  const close = (aggregator: Aggregator, id: string, createdAt: number, closedAt: number) => {
    const index = aggregator.stepMap.get(id)?.index;
    const parts = aggregator.contentParts as unknown as Parts;
    stampTarsStepTiming(index == null ? undefined : parts[index], {
      created_at: T0 + createdAt,
      closed_at: T0 + closedAt,
    });
  };

  it('keeps the stamps through the rest of the run and into the trace', () => {
    const aggregator = createContentAggregator();
    openStep(aggregator, 'think-1', 0);
    delta(aggregator, 'on_reasoning_delta', 'think-1', { type: 'think', think: 'Let me ' });
    delta(aggregator, 'on_reasoning_delta', 'think-1', { type: 'think', think: 'check.' });
    close(aggregator, 'think-1', 200, 900);
    openStep(aggregator, 'text-1', 1);
    delta(aggregator, 'on_message_delta', 'text-1', { type: 'text', text: 'Here ' });
    delta(aggregator, 'on_message_delta', 'text-1', { type: 'text', text: 'it is.' });
    close(aggregator, 'text-1', 900, 1800);

    const parts = aggregator.contentParts as unknown as Parts;
    expect(parts[0]).toMatchObject({ think: 'Let me check.', tarsStepStartedAt: T0 + 200 });
    expect(parts[1]).toMatchObject({ text: 'Here it is.', tarsStepClosedAt: T0 + 1800 });

    const records = build({ content: aggregator.contentParts as TMessageContentParts[] });
    const model = records.filter((record) => record.type === 'thinking' || record.type === 'text');
    expect(model.map((record) => [record.type, record.started_at, record.ended_at])).toEqual([
      ['thinking', at(200), at(900)],
      ['text', at(900), at(1800)],
    ]);
    expect(model.some((record) => record.timing === 'inferred')).toBe(false);
  });

  /** Pins the invariant: a delta after closure would wipe the stamp. */
  it('relies on no delta reaching a step after it closed', () => {
    const aggregator = createContentAggregator();
    openStep(aggregator, 'text-1', 0);
    delta(aggregator, 'on_message_delta', 'text-1', { type: 'text', text: 'a' });
    close(aggregator, 'text-1', 0, 100);
    delta(aggregator, 'on_message_delta', 'text-1', { type: 'text', text: 'b' });
    expect((aggregator.contentParts as unknown as Parts)[0]).not.toHaveProperty(
      'tarsStepStartedAt',
    );
  });
});

describe('sumTarsUsage', () => {
  /** pwc_tars's own messages store every model call of the run, side calls included. */
  it('sums input and output over every model call the run made', () => {
    expect(
      sumTarsUsage([
        { input_tokens: 1200, output_tokens: 40 },
        { input_tokens: 1500, output_tokens: 300 },
        { input_tokens: 300, output_tokens: 20 },
      ]),
    ).toEqual({ messageTokens: 3000, responseTokens: 360 });
  });

  it('counts nothing for missing or invalid values', () => {
    expect(
      sumTarsUsage([{ input_tokens: undefined, output_tokens: Number.NaN }, { output_tokens: -5 }]),
    ).toEqual({ messageTokens: 0, responseTokens: 0 });
    expect(sumTarsUsage(undefined)).toEqual({ messageTokens: 0, responseTokens: 0 });
  });

  /** The report and the trace timeline read the same calls, so their totals agree. */
  it('matches the usage rows the trace records', () => {
    const usage = [
      { input_tokens: 1000, output_tokens: 50 },
      { input_tokens: 2400, output_tokens: 180 },
    ];
    const rows = build({ usage }).filter((record) => record.type === 'usage');
    const fromRows = rows.reduce(
      (sum, row) => ({
        messageTokens: sum.messageTokens + Number(row.input_tokens),
        responseTokens: sum.responseTokens + Number(row.output_tokens),
      }),
      { messageTokens: 0, responseTokens: 0 },
    );
    expect(sumTarsUsage(usage)).toEqual(fromRows);
  });
});

describe('resolveTarsUsage', () => {
  const estimate = { promptTokens: 29, completionTokens: 90 };

  it('keeps the usage the provider reported', () => {
    const collected = [{ input_tokens: 1200, output_tokens: 40 }];
    expect(resolveTarsUsage(collected, estimate)).toEqual(collected);
  });

  /** vLLM streams without usage unless asked; LibreChat then bills its own count. */
  it('falls back to LibreChat’s own count when the provider reported none', () => {
    expect(resolveTarsUsage([], estimate)).toEqual([
      { input_tokens: 29, output_tokens: 90, estimated: true },
    ]);
    expect(resolveTarsUsage(undefined, estimate)).toEqual([
      { input_tokens: 29, output_tokens: 90, estimated: true },
    ]);
  });

  /** Same test `AgentClient` uses: an entry with no token fields is not real usage. */
  it('treats entries without token fields as no usage', () => {
    expect(resolveTarsUsage([{ model: 'Qwen3.8-27B' }], estimate)).toEqual([
      { input_tokens: 29, output_tokens: 90, estimated: true },
    ]);
  });

  it('records nothing when neither side has a count', () => {
    expect(resolveTarsUsage([], { promptTokens: null, completionTokens: undefined })).toEqual([]);
    expect(resolveTarsUsage([], undefined)).toEqual([]);
  });

  it('marks the estimated usage row in the trace', () => {
    const rows = build({ usage: resolveTarsUsage([], estimate) }).filter(
      (record) => record.type === 'usage',
    );
    expect(rows).toEqual([
      expect.objectContaining({ input_tokens: 29, output_tokens: 90, estimated: true }),
    ]);
  });
});

/** Every value the trace reads came from a caller; none of them may stop the mirror. */
describe('malformed input', () => {
  it('skips what it cannot read and keeps the rest of the trace', () => {
    const records = build({
      content: [
        'stray text',
        5,
        null,
        text('Here it is.'),
        { type: ContentTypes.TOOL_CALL, tool_call: 'not an object' },
        { type: ContentTypes.TOOL_CALL, tool_call: { id: 'call-1', function: null } },
        { type: ContentTypes.ERROR, error: { code: 1 } },
      ] as unknown as TMessageContentParts[],
      attachments: [
        null,
        'attachment',
        { toolCallId: 5, type: 'tars_trace' },
        {
          toolCallId: 'call-1',
          type: 'tars_trace',
          tars_trace: { step: { summary: 5, sources: 'a.pdf', links: { url: 'x' }, ok: false } },
        },
        { toolCallId: 'call-1', type: 'web_search', web_search: { organic: 'bad', news: [null] } },
      ] as unknown as TarsTraceInput['attachments'],
      usage: [null, 'usage', { input_tokens: '7' }, { input_tokens: 3, output_tokens: 2 }] as never,
      threadFiles: {
        dataFiles: [null, { filename: 3 }, { id: 'f-1', filename: 'sales.csv' }],
        textFiles: 'notes.txt',
      } as never,
      turnFiles: [{ filename: 'photo.png', type: 5 }, 'file'] as never,
      ephemeralAgent: { mcp: 'not a list' } as never,
      availableTools: 'tools' as never,
      modelParameters: 'params' as never,
    });

    expect(ofType(records, 'text').map((record) => record.text)).toEqual(['Here it is.']);
    const result = ofType(records, 'tool_result')[0];
    expect(result).toMatchObject({ id: 'call-1', name: 'tool', ok: false });
    expect(result).not.toHaveProperty('summary');
    expect(result).not.toHaveProperty('sources');
    expect(ofType(records, 'usage').map((row) => [row.input_tokens, row.output_tokens])).toEqual([
      [0, 0],
      [3, 2],
    ]);
    expect(ofType(records, 'long_term_memory')[0].documents).toEqual([
      { id: null, file_id: 'f-1', filename: 'sales.csv', injected_as: 'data_file' },
    ]);
    expect(ofType(records, 'provenance')[0]).not.toHaveProperty('image_input_count');
    expect(ofType(records, 'error')[0].message).toBe('error');
  });

  it('places a call whose times a Date cannot hold instead of throwing', () => {
    const records = build({
      content: [
        toolCall({ id: 'call-1', name: 'search', toolDispatchedAt: 1e20, runStepClosedAt: 1e20 }),
        toolCall({
          id: 'call-2',
          name: 'search',
          runStepClosedAt: T0 + 10,
          runStepDurationMs: 1e20,
        }),
      ],
    });
    const calls = ofType(records, 'tool_call');
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.timing === 'inferred')).toBe(true);
    expect(records.every((record) => !Number.isNaN(Date.parse(String(record.started_at))))).toBe(
      true,
    );
  });

  it('writes structured output it cannot serialize as text', () => {
    const output: Record<string, unknown> = {};
    output.self = output;
    const records = build({ content: [toolCall({ id: 'call-1', name: 'search', output })] });
    expect(ofType(records, 'tool_result')[0].output).toBe('[object Object]');
  });

  it('never throws from the chat-path seams', () => {
    const throwing = {
      get response_metadata(): never {
        throw new Error('getter');
      },
    };
    expect(() => noteTarsFinishReason({}, throwing)).not.toThrow();
    expect(() => noteTarsFinishReason({}, { response_metadata: 'stop' })).not.toThrow();
    expect(() => noteTarsFinishReason('usage' as never, {})).not.toThrow();

    const frozen = Object.freeze({ type: ContentTypes.TEXT, text: 'a' });
    expect(() => stampTarsStepTiming(frozen, { created_at: T0, closed_at: T0 + 1 })).not.toThrow();
    expect(frozen).not.toHaveProperty('tarsStepStartedAt');
  });

  it('counts nothing for usage that is not a list of entries', () => {
    expect(sumTarsUsage('usage' as never)).toEqual({ messageTokens: 0, responseTokens: 0 });
    expect(sumTarsUsage([null, 'x', { input_tokens: 4 }] as never)).toEqual({
      messageTokens: 4,
      responseTokens: 0,
    });
    expect(resolveTarsUsage({ length: 1 } as never, { promptTokens: 9 })).toEqual([
      { input_tokens: 9, output_tokens: 0, estimated: true },
    ]);
  });
});
