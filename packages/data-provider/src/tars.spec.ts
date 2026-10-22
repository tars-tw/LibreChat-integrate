import { normalizeTarsMessageTrace } from './tars';

const message = {
  id: 'msg-1',
  conversation_id: 'convo-1',
  model_name: 'gpt-5.4-mini',
  created_at: '2026-10-22T01:00:00+00:00',
  ip_addr: '10.0.0.1',
  query: 'Which flights?',
  response: 'Two.',
  status: 1,
  error_message: null,
  response_latency: 3.2,
};

const row = (fields: Record<string, unknown> = {}) => ({
  id: 'row-a',
  seq: 1,
  message_id: 'msg-1',
  event_type: 'tool_result',
  turn: 1,
  tool_name: 'knowledge_search',
  tool_use_id: 'call-1',
  parent_id: null,
  attempt: 1,
  retry_of: null,
  started_at: '2026-10-22T01:00:00+00:00',
  ended_at: '2026-10-22T01:00:01+00:00',
  duration_ms: 1000,
  ok: true,
  payload: { output: 'ok' },
  ...fields,
});

describe('normalizeTarsMessageTrace', () => {
  it('keeps a well-formed trace as pwc_tars sent it', () => {
    const raw = {
      message,
      user: { id: 'u1', username: 'amy', email: null, user_groups: [{ id: 'g1', name: 'Ops' }] },
      trace: [row()],
      unapplied_regenerate_count: 2,
      conversation_history: [{ role: 'user', content: 'hi' }],
    };
    expect(normalizeTarsMessageTrace(raw)).toEqual(raw);
  });

  it('is null without a message object', () => {
    expect(normalizeTarsMessageTrace(null)).toBeNull();
    expect(normalizeTarsMessageTrace('oops')).toBeNull();
    expect(normalizeTarsMessageTrace({ trace: [] })).toBeNull();
    expect(normalizeTarsMessageTrace({ message: 'msg-1' })).toBeNull();
  });

  it('defaults the parts a reader iterates when they are missing or of the wrong kind', () => {
    const trace = normalizeTarsMessageTrace({
      message: { id: 7 },
      user: 'amy',
      trace: { 0: row() },
      unapplied_regenerate_count: 'two',
      conversation_history: 'none',
    });
    expect(trace).toEqual({
      message: {
        id: '7',
        conversation_id: null,
        model_name: null,
        created_at: null,
        ip_addr: null,
        query: null,
        response: null,
        status: null,
        error_message: null,
        response_latency: null,
      },
      user: null,
      trace: [],
      unapplied_regenerate_count: 0,
      conversation_history: [],
    });
  });

  it('drops rows that are not objects and fills a row’s required fields', () => {
    const trace = normalizeTarsMessageTrace({
      message,
      trace: [null, 'text', 42, { event_type: 'text', payload: 'not an object', ok: 'yes' }],
    });
    expect(trace?.trace).toEqual([
      {
        id: 'row-3',
        seq: 3,
        message_id: '',
        event_type: 'text',
        turn: null,
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
      },
    ]);
  });

  it('holds every payload field the panel reads to its declared kind', () => {
    const trace = normalizeTarsMessageTrace({
      message,
      trace: [
        row({
          payload: {
            text: { nested: true },
            input_tokens: '12',
            truncated: 'yes',
            sources: ['a.pdf', 3, null, { url: 'x' }],
            reasoning_effort_unknown_key: { kept: true },
            model_kwargs: ['not', 'an', 'object'],
            documents: [null, { filename: 9, milvus_pk: 12, injected_as: ['summary'] }, 'bad'],
            records: [{ score: '0.9', created_at: 20261022, content: null }],
            options: 'pick one',
            payload: { reasoning_effort: 1, upload_files: [{ file_id: 'f1' }, 'bad'] },
            floor_filter: [],
            input: { query: 'raw' },
          },
        }),
      ],
    });
    expect(trace?.trace[0].payload).toEqual({
      sources: ['a.pdf', '3'],
      reasoning_effort_unknown_key: { kept: true },
      documents: [{ filename: '9', milvus_pk: 12 }],
      records: [{ score: '0.9', created_at: '20261022' }],
      payload: { reasoning_effort: '1', upload_files: [{ file_id: 'f1' }] },
      input: { query: 'raw' },
    });
  });

  it('keeps the optional row columns only when pwc_tars sent them', () => {
    const trace = normalizeTarsMessageTrace({
      message,
      trace: [row({ created_at: 5, user_id: { id: 1 } })],
    });
    expect(trace?.trace[0]).toMatchObject({ created_at: '5', user_id: null });
    expect(trace?.trace[0]).not.toHaveProperty('domain_id');
  });

  it('keeps users, groups and history entries readable whatever their fields hold', () => {
    const trace = normalizeTarsMessageTrace({
      message,
      user: { id: 3, username: ['x'], user_groups: [null, { id: 1, name: null }] },
      conversation_history: [null, { content: { parts: ['a'] } }, { role: 'assistant' }],
    });
    expect(trace?.user).toEqual({
      id: '3',
      username: null,
      email: null,
      user_groups: [{ id: '1', name: '' }],
    });
    expect(trace?.conversation_history).toEqual([
      { role: '', content: { parts: ['a'] } },
      { role: 'assistant', content: null },
    ]);
  });
});
