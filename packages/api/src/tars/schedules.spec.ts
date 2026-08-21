jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsSchedules,
  createTarsSchedule,
  updateTarsSchedule,
  runTarsScheduleNow,
  restartTarsSchedule,
  updateTarsScheduleSyncAll,
} from './schedules';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const urlOf = (fetchMock: jest.SpyInstance, call = 0): URL =>
  new URL(String(fetchMock.mock.calls[call][0]));

const bodyOf = (fetchMock: jest.SpyInstance, call = 0): Record<string, unknown> =>
  JSON.parse(String(fetchMock.mock.calls[call][1]?.body));

describe('fetchTarsSchedules', () => {
  afterEach(() => jest.restoreAllMocks());

  it('scopes to one knowledge base when asked', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { schedule_list: [{ id: 's-1' }] }));

    const schedules = await fetchTarsSchedules('user-1', 'kb-1', BASE_URL);

    expect(urlOf(fetchMock).searchParams.get('knowledge_base_id')).toBe('kb-1');
    expect(schedules).toHaveLength(1);
  });

  /** pwc_tars reads a missing parameter as "every accessible knowledge base". */
  it('omits the knowledge base entirely when none is given', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { schedule_list: [] }));

    await fetchTarsSchedules('user-1', undefined, BASE_URL);

    expect(urlOf(fetchMock).searchParams.has('knowledge_base_id')).toBe(false);
  });

  it('returns [] when pwc_tars answers without a list', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { message: 'ok' }));

    await expect(fetchTarsSchedules('user-1', 'kb-1', BASE_URL)).resolves.toEqual([]);
  });
});

describe('createTarsSchedule', () => {
  afterEach(() => jest.restoreAllMocks());

  /** pwc_tars parses these with `datetime.strptime(..., '%Y-%m-%d %H:%M:%S')`. */
  it('converts datetime-local values to the format pwc_tars parses', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(201, { schedule: { id: 's-1' } }));

    await createTarsSchedule(
      'user-1',
      {
        datasetId: 'w-1',
        datasetType: 'website',
        knowledgeBaseId: 'kb-1',
        frequency: 1,
        frequencyUnit: 'day',
        startTime: '2026-01-02T03:04',
      },
      BASE_URL,
    );

    const body = bodyOf(fetchMock);
    expect(body.start_time).toBe('2026-01-02 03:04:00');
    expect(body.created_by).toBe('user-1');
  });

  /** `end_time` is optional; pwc_tars only parses it when it is present. */
  it('leaves end_time undefined when the caller gave none', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(201, { schedule: { id: 's-1' } }));

    await createTarsSchedule(
      'user-1',
      {
        datasetId: 'w-1',
        datasetType: 'website',
        knowledgeBaseId: 'kb-1',
        frequency: 2,
        frequencyUnit: 'week',
        startTime: '2026-01-02T03:04',
        endTime: '',
      },
      BASE_URL,
    );

    expect(bodyOf(fetchMock)).not.toHaveProperty('end_time', expect.any(String));
    expect(bodyOf(fetchMock).end_time).toBeUndefined();
  });
});

describe('updateTarsSchedule', () => {
  afterEach(() => jest.restoreAllMocks());

  /**
   * pwc_tars rejects the call when `enable` is absent, but its model has no
   * such column so the value never lands. Sending `true` satisfies the check
   * without pretending the flag does anything.
   */
  it('sends the enable flag the endpoint checks for but ignores', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { message: 'ok' }));

    await updateTarsSchedule(
      's-1',
      { frequency: 3, frequencyUnit: 'day', startTime: '2026-01-02T03:04' },
      BASE_URL,
    );

    expect(bodyOf(fetchMock)).toMatchObject({ schedule_id: 's-1', enable: true, frequency: 3 });
  });
});

describe('job actions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('runs a job by query parameter', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    await runTarsScheduleNow('s-1', BASE_URL);

    expect(urlOf(fetchMock).pathname).toBe('/api/knowledge_detail/run_scheduled_job_now');
    expect(urlOf(fetchMock).searchParams.get('schedule_id')).toBe('s-1');
  });

  it('restarts a job by request body', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    await restartTarsSchedule('s-1', BASE_URL);

    expect(bodyOf(fetchMock)).toEqual({ schedule_id: 's-1' });
  });

  it('puts the sync-all flag on the schedule path', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));

    await updateTarsScheduleSyncAll('s-1', true, BASE_URL);

    expect(urlOf(fetchMock).pathname).toBe('/api/schedule/update_sync_all/s-1');
    expect(bodyOf(fetchMock)).toEqual({ is_sync_all: true });
  });
});
