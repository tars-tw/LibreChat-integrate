jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import type { TarsDirectory, TarsDirectoryCache } from './directory';
import type { TarsGroupStore, TarsMirroredGroup } from './groupSync';
import {
  syncTarsGroups,
  createTarsSharing,
  ensureTarsGroupPrincipal,
  getTarsGroupSyncIntervalMs,
  createTarsGroupSyncScheduler,
} from './groupSync';

const directoryOf = (groups: TarsDirectory['groups']): TarsDirectoryCache => {
  const directory: TarsDirectory = { users: [], groups };
  return {
    get: jest.fn().mockResolvedValue(directory),
    refresh: jest.fn().mockResolvedValue(directory),
  };
};

const mirrored = (
  idOnTheSource: string,
  memberIds: string[],
  overrides: Partial<TarsMirroredGroup> = {},
): TarsMirroredGroup => ({
  _id: { toString: () => `mongo-${idOnTheSource}` },
  idOnTheSource,
  name: `Group ${idOnTheSource}`,
  memberIds,
  ...overrides,
});

const storeWith = (groups: TarsMirroredGroup[]) => {
  const store: jest.Mocked<TarsGroupStore> = {
    findGroupsBySource: jest.fn().mockResolvedValue(groups),
    upsertGroupByExternalId: jest.fn().mockImplementation(async (id: string) => mirrored(id, [])),
  };
  return store;
};

describe('syncTarsGroups', () => {
  it('skips pwc_tars entirely while no group has been shared with', async () => {
    const directory = directoryOf([]);
    const store = storeWith([]);

    await expect(syncTarsGroups({ directory, store })).resolves.toEqual({
      checked: 0,
      updated: 0,
    });
    expect(directory.refresh).not.toHaveBeenCalled();
  });

  it('writes only the groups whose members or name changed', async () => {
    const directory = directoryOf([
      { id: 'g1', name: 'Group g1', memberIds: ['u1', 'u2'] },
      { id: 'g2', name: 'Group g2', memberIds: ['u3'] },
      { id: 'g3', name: 'Renamed', memberIds: [] },
    ]);
    const store = storeWith([
      mirrored('g1', ['u2', 'u1']),
      mirrored('g2', ['u3', 'u4']),
      mirrored('g3', []),
    ]);

    await expect(syncTarsGroups({ directory, store })).resolves.toEqual({
      checked: 3,
      updated: 2,
    });
    expect(store.upsertGroupByExternalId).toHaveBeenCalledWith('g2', 'tars', {
      name: 'Group g2',
      memberIds: ['u3'],
    });
    expect(store.upsertGroupByExternalId).toHaveBeenCalledWith('g3', 'tars', {
      name: 'Renamed',
      memberIds: [],
    });
    expect(store.upsertGroupByExternalId).not.toHaveBeenCalledWith(
      'g1',
      expect.anything(),
      expect.anything(),
    );
  });

  it('empties a group that pwc_tars disabled or deleted, so its shares reach no one', async () => {
    const directory = directoryOf([]);
    const store = storeWith([mirrored('gone', ['u1'])]);

    await syncTarsGroups({ directory, store });

    expect(store.upsertGroupByExternalId).toHaveBeenCalledWith('gone', 'tars', { memberIds: [] });
  });
});

describe('ensureTarsGroupPrincipal', () => {
  it('mirrors the group with its current members and returns its LibreChat id', async () => {
    const directory = directoryOf([
      { id: 'g1', name: 'Finance', description: 'Money', memberIds: ['u1'] },
    ]);
    const store = storeWith([]);

    await expect(
      ensureTarsGroupPrincipal({ idOnTheSource: 'g1' }, { directory, store }),
    ).resolves.toBe('mongo-g1');
    expect(store.upsertGroupByExternalId).toHaveBeenCalledWith('g1', 'tars', {
      name: 'Finance',
      description: 'Money',
      memberIds: ['u1'],
    });
  });

  it('refuses a group pwc_tars no longer offers', async () => {
    const store = storeWith([]);
    await expect(
      ensureTarsGroupPrincipal({ idOnTheSource: 'g9' }, { directory: directoryOf([]), store }),
    ).rejects.toThrow('does not exist or is disabled');
    await expect(
      ensureTarsGroupPrincipal({}, { directory: directoryOf([]), store }),
    ).rejects.toThrow('must have idOnTheSource');
    expect(store.upsertGroupByExternalId).not.toHaveBeenCalled();
  });
});

describe('getTarsGroupSyncIntervalMs', () => {
  it('defaults to two minutes and honours an override, including 0', () => {
    expect(getTarsGroupSyncIntervalMs()).toBe(120_000);
    expect(
      getTarsGroupSyncIntervalMs({
        config: { permissions: { tarsGroupSyncSeconds: 30 } },
      } as never),
    ).toBe(30_000);
    expect(
      getTarsGroupSyncIntervalMs({ config: { permissions: { tarsGroupSyncSeconds: 0 } } } as never),
    ).toBe(0);
  });
});

describe('createTarsGroupSyncScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces a burst of requests into one run', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const scheduler = createTarsGroupSyncScheduler({
      run,
      isLeader: jest.fn().mockResolvedValue(true),
      debounceMs: 100,
    });

    scheduler.request();
    scheduler.request();
    scheduler.request();
    await jest.advanceTimersByTimeAsync(100);

    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('runs once more when a request lands mid-run, never overlapping', async () => {
    let finish: () => void = () => undefined;
    const run = jest
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockResolvedValue(undefined);
    const scheduler = createTarsGroupSyncScheduler({
      run,
      isLeader: jest.fn().mockResolvedValue(true),
      debounceMs: 10,
    });

    scheduler.request();
    await jest.advanceTimersByTimeAsync(10);
    scheduler.request();
    await jest.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('ticks on the interval only on the leader, and not at all with interval 0', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const isLeader = jest.fn().mockResolvedValue(false);
    const scheduler = createTarsGroupSyncScheduler({ run, isLeader });

    scheduler.start(0);
    await jest.advanceTimersByTimeAsync(1000);
    expect(isLeader).not.toHaveBeenCalled();

    scheduler.start(1000);
    await jest.advanceTimersByTimeAsync(0);
    expect(isLeader).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    isLeader.mockResolvedValue(true);
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});

describe('createTarsSharing', () => {
  const originalUrl = process.env.TARS_AUTH_URL;
  afterEach(() => {
    process.env.TARS_AUTH_URL = originalUrl;
  });

  it('does nothing at start or on request when pwc_tars is not configured', async () => {
    const linkUserSourceIds = jest.fn().mockResolvedValue(0);
    const sharing = createTarsSharing({
      store: storeWith([]),
      linkUserSourceIds,
      isLeader: jest.fn().mockResolvedValue(true),
      runAsSystem: (fn) => fn(),
      baseUrl: '',
    });

    expect(sharing.isEnabled()).toBe(false);
    await sharing.start();
    sharing.requestSync();
    expect(linkUserSourceIds).not.toHaveBeenCalled();
  });

  it('links users to their pwc_tars id before starting the sync', async () => {
    jest.useFakeTimers();
    const linkUserSourceIds = jest.fn().mockResolvedValue(2);
    const sharing = createTarsSharing({
      store: storeWith([]),
      linkUserSourceIds,
      isLeader: jest.fn().mockResolvedValue(false),
      runAsSystem: (fn) => fn(),
      baseUrl: 'http://tars.test',
    });

    await sharing.start({ config: { permissions: { tarsGroupSyncSeconds: 0 } } } as never);

    expect(linkUserSourceIds).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
