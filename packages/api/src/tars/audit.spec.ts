jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import { fetchTarsAuditReport, fetchTarsAuditFilterOptions } from './audit';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const bodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);

describe('fetchTarsAuditFilterOptions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** pwc_tars sends numeric ids; every picker in the filter bar compares strings. */
  it('stringifies the ids of all three pickers', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          users: [{ id: 3, username: 'ada' }],
          domains: [{ id: 8, name: 'Finance' }],
          knowledge_bases: [{ id: 21, name: 'Tax rules' }],
        },
      }),
    );
    await expect(fetchTarsAuditFilterOptions(BASE_URL)).resolves.toEqual({
      users: [{ id: '3', username: 'ada' }],
      domains: [{ id: '8', name: 'Finance' }],
      knowledge_bases: [{ id: '21', name: 'Tax rules' }],
    });
  });

  it('returns empty pickers when pwc_tars omits them', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: {} }));
    await expect(fetchTarsAuditFilterOptions(BASE_URL)).resolves.toEqual({
      users: [],
      domains: [],
      knowledge_bases: [],
    });
  });

  /** A row without an id cannot be selected, so it must not reach the dropdown. */
  it('drops rows with no id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: { domains: [{ name: 'orphan' }, { id: 1, name: 'Finance' }] },
      }),
    );
    const options = await fetchTarsAuditFilterOptions(BASE_URL);
    expect(options.domains).toEqual([{ id: '1', name: 'Finance' }]);
  });
});

describe('fetchTarsAuditReport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const query = { start_date: '2026-08-01', end_date: '2026-08-08' };

  it('sends every filter, defaulting the optional ones', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { data: [] } }));
    await fetchTarsAuditReport('7', query, BASE_URL);

    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(bodyOf(fetchMock)).toEqual({
      user_id: '7',
      filter_user_ids: [],
      start_date: '2026-08-01',
      end_date: '2026-08-08',
      domain_id: '',
      knowledge_base_ids: [],
      query_filter: '',
    });
  });

  /** pwc_tars treats a null `domain_id` as "no filter" only when it arrives blank. */
  it('sends a blank domain_id rather than null', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { data: [] } }));
    await fetchTarsAuditReport('7', { ...query, domain_id: null }, BASE_URL);
    expect(bodyOf(fetchMock).domain_id).toBe('');
  });

  it('forwards the selected users, knowledge bases and keyword', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { data: [] } }));
    await fetchTarsAuditReport(
      '7',
      {
        ...query,
        filter_user_ids: ['3', '4'],
        knowledge_base_ids: ['21'],
        domain_id: '8',
        query_filter: 'invoice',
      },
      BASE_URL,
    );
    expect(bodyOf(fetchMock)).toMatchObject({
      filter_user_ids: ['3', '4'],
      knowledge_base_ids: ['21'],
      domain_id: '8',
      query_filter: 'invoice',
    });
  });

  /** The plotting arrays only restate `details`, so only summary/details survive. */
  it('flattens chart_data down to the summary and the per-brain rollup', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          total_count: 1,
          data: [{ message_id: 'm-1' }],
          feedback_data: [{ message_id: 'm-1', like_count: 1 }],
          chart_data: {
            bar_chart: { labels: ['Finance'], conversation_data: [2], message_data: [5] },
            pie_chart: { labels: ['Finance'], data: [5] },
            summary: {
              total_domains: 1,
              total_conversations: 2,
              total_messages: 5,
              date_range: { start_date: '2026-08-01', end_date: '2026-08-08' },
            },
            details: [
              {
                domain_name: 'Finance',
                conversation_count: 2,
                message_count: 5,
                knowledge_bases: [{ id: 21, name: 'Tax rules' }],
                conversations: [{ conversation_id: 'c-1', messages: [{ message_id: 'm-1' }] }],
              },
            ],
          },
        },
      }),
    );

    const report = await fetchTarsAuditReport('7', query, BASE_URL);
    expect(report.summary?.total_messages).toBe(5);
    expect(report.details).toEqual([
      {
        domain_name: 'Finance',
        conversation_count: 2,
        message_count: 5,
        knowledge_bases: [{ id: 21, name: 'Tax rules' }],
      },
    ]);
    expect(report.feedback_data).toHaveLength(1);
  });

  /**
   * When no domain matches the knowledge-base filter pwc_tars short-circuits with
   * only `total_count` and `data`, so the rest has to default rather than throw.
   */
  it('tolerates the short-circuited empty response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { total_count: 0, data: [] } }));
    await expect(fetchTarsAuditReport('7', query, BASE_URL)).resolves.toEqual({
      total_count: 0,
      data: [],
      feedback_data: [],
      summary: null,
      details: [],
    });
  });

  it('relays the pwc_tars message when the date range is rejected', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { message: '起始日期不能晚於結束日期' }));
    await expect(fetchTarsAuditReport('7', query, BASE_URL)).rejects.toMatchObject({
      status: 400,
      serverMessage: '起始日期不能晚於結束日期',
    });
  });
});

describe('fetchTarsAuditFilterOptions blank names', () => {
  afterEach(() => jest.restoreAllMocks());

  /**
   * `display_name` and friends are nullable strings in pwc_tars, so an unset
   * one can come back as `''`. A blank label sorts to the top of the picker and
   * reads as an empty row, so the id stands in instead.
   */
  it('falls back past an empty name to the id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        data: {
          users: [
            { id: 7, name: '', username: '' },
            { id: 8, name: null, username: 'amy' },
          ],
          domains: [],
          knowledge_bases: [],
        },
      }),
    );

    const options = await fetchTarsAuditFilterOptions(BASE_URL);

    expect(options.users).toEqual([
      { id: '7', username: '7' },
      { id: '8', username: 'amy' },
    ]);
  });
});
