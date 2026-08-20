jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsTokenReportUser,
  fetchTarsTokenReportExport,
  fetchTarsTokenReportMembers,
  fetchTarsTokenReportOverview,
} from './reports';

const BASE_URL = 'http://tars.test';
const RANGE = { start_date: '2026-07-01', end_date: '2026-07-31' };

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const urlOf = (fetchMock: jest.SpyInstance): string => String(fetchMock.mock.calls[0][0]);
const bodyOf = (fetchMock: jest.SpyInstance): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);

describe('token report service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the range to the pwc_tars report endpoint', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { group_overview: [] } }));

    await fetchTarsTokenReportOverview(RANGE, BASE_URL);

    expect(urlOf(fetchMock)).toContain('/api/reports/get_group_token_overview');
    expect(bodyOf(fetchMock)).toEqual(RANGE);
  });

  /** A report with no rows must read as empty collections, never as undefined. */
  it('fills in the collections pwc_tars omits', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: {} }));

    await expect(fetchTarsTokenReportOverview(RANGE, BASE_URL)).resolves.toEqual({
      group_overview: [],
      domain_usage: [],
      model_usage: [],
      date_range: RANGE,
    });
  });

  /**
   * pwc_tars attaches every underlying usage-log id to each member; that is the
   * largest part of the payload and nothing renders it.
   */
  it('drops the per-member usage log ids', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: {
          user_usage: [
            {
              user_id: 7,
              username: 'ada',
              display_name: 'Ada',
              user_group_ids: ['2'],
              log_count: 3,
              total_tokens: 900,
              usage_logs: [{ id: 'l1', total_tokens: 300, created_at: null }],
            },
          ],
        },
      }),
    );

    const members = await fetchTarsTokenReportMembers(RANGE, ['2'], BASE_URL);

    expect(members).toEqual([
      {
        user_id: 7,
        username: 'ada',
        display_name: 'Ada',
        user_group_ids: ['2'],
        log_count: 3,
        total_tokens: 900,
      },
    ]);
  });

  it('sends the group ids and the user id with their ranges', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { data: { user_usage: [] } }));

    await fetchTarsTokenReportMembers(RANGE, ['2', '5'], BASE_URL);
    expect(bodyOf(fetchMock)).toEqual({ ...RANGE, user_group_ids: ['2', '5'] });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(buildResponse(200, { data: {} }));
    await fetchTarsTokenReportUser(RANGE, '7', BASE_URL);
    expect(bodyOf(fetchMock)).toEqual({ ...RANGE, user_id: '7' });
  });

  it('returns null when pwc_tars has no summary for the user', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: {} }));
    await expect(fetchTarsTokenReportUser(RANGE, '7', BASE_URL)).resolves.toBeNull();
  });

  it('relays the pwc_tars failure message', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { message: '起始日期不能晚於結束日期' }));

    await expect(fetchTarsTokenReportExport(RANGE, BASE_URL)).rejects.toMatchObject({
      status: 400,
      serverMessage: '起始日期不能晚於結束日期',
    });
  });
});
