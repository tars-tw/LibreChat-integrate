jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { PrincipalType } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { TarsAccount, TarsUserGroup } from './users';
import {
  parseTarsGroupIds,
  isTarsGroupEnabled,
  buildTarsDirectory,
  toPrincipalDirectory,
  fetchTarsAllUserGroups,
  createTarsDirectoryCache,
  createPrincipalDirectoryHandler,
} from './directory';
import { TarsRequestError } from './client';

const account = (id: string, overrides: Partial<TarsAccount> = {}): TarsAccount => ({
  id,
  username: id,
  email: `${id}@example.com`,
  role_id: 2,
  user_group_id: null,
  display_name: id.toUpperCase(),
  status: 'active',
  ...overrides,
});

const group = (id: string, overrides: Partial<TarsUserGroup> = {}): TarsUserGroup => ({
  id,
  name: `Group ${id}`,
  status: 1,
  ...overrides,
});

const buildResponse = () => {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status: jest.fn(),
    json: jest.fn(),
    set: jest.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  res.set.mockReturnValue(res);
  return res;
};

describe('parseTarsGroupIds', () => {
  it('splits the comma separated column and drops blanks', () => {
    expect(parseTarsGroupIds(' g1, g2 ,,g3 ')).toEqual(['g1', 'g2', 'g3']);
    expect(parseTarsGroupIds(null)).toEqual([]);
    expect(parseTarsGroupIds('')).toEqual([]);
  });
});

describe('isTarsGroupEnabled', () => {
  it('treats 1, true and a missing status as enabled', () => {
    expect(isTarsGroupEnabled({ status: 1 })).toBe(true);
    expect(isTarsGroupEnabled({ status: true })).toBe(true);
    expect(isTarsGroupEnabled({ status: null })).toBe(true);
    expect(isTarsGroupEnabled({ status: 0 })).toBe(false);
    expect(isTarsGroupEnabled({ status: false })).toBe(false);
  });
});

describe('buildTarsDirectory', () => {
  it('lists active accounts and enabled groups with their active members', () => {
    const directory = buildTarsDirectory(
      [
        account('u2', { user_group_id: 'g1,g2' }),
        account('u1', { user_group_id: 'g1' }),
        account('u3', { user_group_id: 'g1', status: 'inactive' }),
      ],
      [group('g1'), group('g2', { status: 0 }), group('g3', { description: 'empty' })],
    );

    expect(directory.users.map((user) => user.id)).toEqual(['u2', 'u1']);
    expect(directory.groups).toEqual([
      { id: 'g1', name: 'Group g1', description: undefined, memberIds: ['u1', 'u2'] },
      { id: 'g3', name: 'Group g3', description: 'empty', memberIds: [] },
    ]);
  });
});

describe('toPrincipalDirectory', () => {
  it('maps groups and users to share-dialog principals sorted by name', () => {
    const response = toPrincipalDirectory(
      buildTarsDirectory(
        [account('zoe', { user_group_id: 'g1' }), account('amy')],
        [group('g1', { name: 'Sales' }), group('g2', { name: 'Finance' })],
      ),
    );

    expect(response.enabled).toBe(true);
    expect(response.groups).toEqual([
      expect.objectContaining({
        type: PrincipalType.GROUP,
        name: 'Finance',
        source: 'tars',
        idOnTheSource: 'g2',
        memberCount: 0,
      }),
      expect.objectContaining({ name: 'Sales', idOnTheSource: 'g1', memberCount: 1 }),
    ]);
    expect(response.users.map((user) => [user.name, user.idOnTheSource, user.source])).toEqual([
      ['AMY', 'amy', 'tars'],
      ['ZOE', 'zoe', 'tars'],
    ]);
  });
});

describe('fetchTarsAllUserGroups', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('asks pwc_tars for every group regardless of status', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [group('g1')] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchTarsAllUserGroups('http://tars.test')).resolves.toEqual([group('g1')]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://tars.test/api/user_settings/get_user_group_by_filter');
    expect(JSON.parse(init.body)).toEqual({ filter: {} });
  });
});

describe('createTarsDirectoryCache', () => {
  it('reuses a fresh read, refetches once stale, and shares concurrent fetches', async () => {
    let now = 0;
    const source = {
      fetchUsers: jest.fn().mockResolvedValue([account('u1')]),
      fetchGroups: jest.fn().mockResolvedValue([group('g1')]),
    };
    const cache = createTarsDirectoryCache(source, 1000, () => now);

    const [first, second] = await Promise.all([cache.get(), cache.get()]);
    expect(first).toBe(second);
    expect(source.fetchUsers).toHaveBeenCalledTimes(1);

    now = 500;
    await cache.get();
    expect(source.fetchUsers).toHaveBeenCalledTimes(1);

    now = 1500;
    await cache.get();
    expect(source.fetchUsers).toHaveBeenCalledTimes(2);

    await cache.refresh();
    expect(source.fetchGroups).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failed fetch', async () => {
    const source = {
      fetchUsers: jest
        .fn()
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValue([account('u1')]),
      fetchGroups: jest.fn().mockResolvedValue([]),
    };
    const cache = createTarsDirectoryCache(source, 1000, () => 0);

    await expect(cache.get()).rejects.toThrow('down');
    await expect(cache.get()).resolves.toEqual(expect.objectContaining({ groups: [] }));
  });
});

describe('createPrincipalDirectoryHandler', () => {
  const req = {} as Request;

  it('answers enabled: false without pwc_tars', async () => {
    const directory = { get: jest.fn(), refresh: jest.fn() };
    const handler = createPrincipalDirectoryHandler({ isEnabled: () => false, directory });
    const res = buildResponse();

    await handler(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ enabled: false, users: [], groups: [] });
    expect(directory.get).not.toHaveBeenCalled();
  });

  it('returns the directory as principals', async () => {
    const directory = {
      get: jest.fn().mockResolvedValue(buildTarsDirectory([account('u1')], [group('g1')])),
      refresh: jest.fn(),
    };
    const handler = createPrincipalDirectoryHandler({ isEnabled: () => true, directory });
    const res = buildResponse();

    await handler(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        enabled: true,
        users: [expect.objectContaining({ idOnTheSource: 'u1' })],
        groups: [expect.objectContaining({ idOnTheSource: 'g1' })],
      }),
    );
  });

  it('relays a pwc_tars 4xx and hides a 5xx', async () => {
    const res4xx = buildResponse();
    await createPrincipalDirectoryHandler({
      isEnabled: () => true,
      directory: {
        get: jest.fn().mockRejectedValue(new TarsRequestError(403, '/x', 'license expired')),
        refresh: jest.fn(),
      },
    })(req, res4xx as unknown as Response);
    expect(res4xx.statusCode).toBe(403);
    expect(res4xx.body).toEqual({ error: 'license expired' });

    const res5xx = buildResponse();
    await createPrincipalDirectoryHandler({
      isEnabled: () => true,
      directory: { get: jest.fn().mockRejectedValue(new Error('boom')), refresh: jest.fn() },
    })(req, res5xx as unknown as Response);
    expect(res5xx.statusCode).toBe(500);
    expect(res5xx.body).toEqual({ error: 'Failed to load users and groups' });
  });
});
