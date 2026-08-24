jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  toTarsDateTime,
  fetchTarsActionLogs,
  fetchTarsUserActionLogs,
  fetchTarsActionLogFilterOptions,
  fetchTarsActionLogDetail,
  recordTarsActionLog,
} from './syslogs';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const urlOf = (fetchMock: jest.SpyInstance): string => String(fetchMock.mock.calls[0][0]);

/** Reads one decoded query value; `URLSearchParams` encodes spaces as `+`. */
const paramOf = (fetchMock: jest.SpyInstance, name: string): string | null =>
  new URL(urlOf(fetchMock)).searchParams.get(name);

describe('toTarsDateTime', () => {
  /** `<input type="datetime-local">` omits the seconds pwc_tars' parser wants. */
  it('turns a datetime-local value into the pwc_tars format', () => {
    expect(toTarsDateTime('2026-08-20T14:30')).toBe('2026-08-20 14:30:00');
  });

  it('passes a bare date through for pwc_tars to widen to the whole day', () => {
    expect(toTarsDateTime('2026-08-20')).toBe('2026-08-20');
  });

  it('leaves an already-complete timestamp alone', () => {
    expect(toTarsDateTime('2026-08-20 14:30:59')).toBe('2026-08-20 14:30:59');
  });

  it('treats blank and missing values as no bound', () => {
    expect(toTarsDateTime('')).toBeUndefined();
    expect(toTarsDateTime(undefined)).toBeUndefined();
  });
});

describe('fetchTarsActionLogs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const page = {
    logs: [{ id: 'l-1', action_type: 'CREATE' }],
    total: 41,
    page: 2,
    page_size: 20,
    summary: { total: 41, create: 5 },
  };

  /** The audit-log blueprint answers bare JSON, with no success envelope. */
  it('reads the unwrapped page and fills in the missing summary counts', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, page));
    const result = await fetchTarsActionLogs({ page: 2 }, BASE_URL);
    expect(result.total).toBe(41);
    expect(result.summary).toEqual({
      total: 41,
      create: 5,
      update: 0,
      delete: 0,
      read: 0,
      export: 0,
      download: 0,
      login: 0,
      logout: 0,
      other: 0,
    });
  });

  /** `before_data`/`after_data`/`extra` are `db.JSON`, so they arrive parsed. */
  it('passes the JSON columns through as the objects pwc_tars sends', async () => {
    const before = { id: 7, name: 'Test11', tags: ['a'] };
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        logs: [{ id: 'l-1', before_data: before, after_data: null, extra: { count: 2 } }],
      }),
    );
    const result = await fetchTarsActionLogs({}, BASE_URL);
    expect(result.logs[0].before_data).toEqual(before);
    expect(result.logs[0].extra).toEqual({ count: 2 });
  });

  it('joins the multi-select filters with commas', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await fetchTarsActionLogs(
      {
        user_ids: ['3', '4'],
        action_types: ['CREATE', 'DELETE'],
        modules: ['user-mgmt'],
      },
      BASE_URL,
    );
    expect(paramOf(fetchMock, 'user_ids')).toBe('3,4');
    expect(paramOf(fetchMock, 'action_types')).toBe('CREATE,DELETE');
    expect(paramOf(fetchMock, 'modules')).toBe('user-mgmt');
  });

  /** pwc_tars reads an empty parameter as a filter on the empty string. */
  it('omits empty filters entirely', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await fetchTarsActionLogs({ user_ids: [], modules: [], keyword: '' }, BASE_URL);
    const url = urlOf(fetchMock);
    expect(url).not.toContain('user_ids');
    expect(url).not.toContain('modules');
    expect(url).not.toContain('keyword');
  });

  it('normalizes both date bounds before sending them', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await fetchTarsActionLogs(
      { start_date: '2026-07-20T00:00', end_date: '2026-08-20T23:59' },
      BASE_URL,
    );
    expect(paramOf(fetchMock, 'start_date')).toBe('2026-07-20 00:00:00');
    expect(paramOf(fetchMock, 'end_date')).toBe('2026-08-20 23:59:00');
  });

  it('defaults the paging when the caller omits it', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await fetchTarsActionLogs({}, BASE_URL);
    const url = urlOf(fetchMock);
    expect(url).toContain('page=1');
    expect(url).toContain('page_size=20');
  });

  /** This blueprint reports failures as `{error}`, not the usual `{message}`. */
  it('relays the pwc_tars error text', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(400, { error: '起始日期不可晚於結束日期' }));
    await expect(fetchTarsActionLogs({}, BASE_URL)).rejects.toMatchObject({
      status: 400,
      serverMessage: '起始日期不可晚於結束日期',
    });
  });
});

describe('fetchTarsActionLogFilterOptions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the three pickers', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        users: [{ user_id: '3', username: 'ada', user_email: 'ada@example.com' }],
        action_types: ['CREATE', 'LOGIN'],
        modules: [{ value: 'user-mgmt', title: 'User Management', lang_key: 'MENU_USERS' }],
      }),
    );
    const options = await fetchTarsActionLogFilterOptions(BASE_URL);
    expect(options.users).toHaveLength(1);
    expect(options.action_types).toEqual(['CREATE', 'LOGIN']);
    expect(options.modules[0].title).toBe('User Management');
  });

  /** A log row written without a user id yields an unselectable option. */
  it('drops users with no id', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        buildResponse(200, { users: [{ username: 'ghost' }, { user_id: '3', username: 'ada' }] }),
      );
    const options = await fetchTarsActionLogFilterOptions(BASE_URL);
    expect(options.users).toEqual([{ user_id: '3', username: 'ada' }]);
  });

  it('defaults every picker when pwc_tars omits them', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    await expect(fetchTarsActionLogFilterOptions(BASE_URL)).resolves.toEqual({
      users: [],
      action_types: [],
      modules: [],
    });
  });
});

describe('fetchTarsUserActionLogs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('encodes the user id into the path and keeps the window', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { logs: [] }));
    await fetchTarsUserActionLogs('a/b', { start_date: '2026-08-01T00:00' }, BASE_URL);
    expect(urlOf(fetchMock)).toContain('/audit_logs/user/a%2Fb');
    expect(paramOf(fetchMock, 'start_date')).toBe('2026-08-01 00:00:00');
  });

  it('returns [] when the user has no recorded actions', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { logs: [] }));
    await expect(fetchTarsUserActionLogs('3', {}, BASE_URL)).resolves.toEqual([]);
  });
});

describe('fetchTarsActionLogDetail', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the row back by id and unwraps it', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { log: { id: 'a/b' } }));
    await expect(fetchTarsActionLogDetail('a/b', BASE_URL)).resolves.toEqual({ id: 'a/b' });
    expect(urlOf(fetchMock)).toBe(`${BASE_URL}/api/system_action_log/audit_logs/a%2Fb`);
  });

  /** A purged row is not a failure — the caller falls back to the listed copy. */
  it('answers null when pwc_tars no longer has the row', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(404, { error: '找不到指定的稽核紀錄' }));
    await expect(fetchTarsActionLogDetail('gone', BASE_URL)).resolves.toBeNull();
  });

  it('still throws on any other failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(500, { error: 'boom' }));
    await expect(fetchTarsActionLogDetail('1', BASE_URL)).rejects.toThrow();
  });
});

describe('recordTarsActionLog', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the entry with the operator as user_id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true }));

    await recordTarsActionLog(
      'admin',
      { action_type: 'EXPORT', module: 'user-settings', description: '匯出 3 筆使用者資料' },
      BASE_URL,
    );

    expect(urlOf(fetchMock)).toBe(`${BASE_URL}/api/system_action_log/record`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      action_type: 'EXPORT',
      module: 'user-settings',
      description: '匯出 3 筆使用者資料',
      user_id: 'admin',
    });
  });
});
