jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { logger } from '@librechat/data-schemas';
import type { TarsOutboxItem, TarsOutboxStore } from '@librechat/data-schemas';
import {
  deferTarsWrite,
  drainTarsOutbox,
  createTarsOutbox,
  configureTarsOutbox,
  isRetryableTarsError,
  tarsOutboxRetryDelayMs,
} from './outbox';
import { TarsRequestError } from './client';

type Kept = TarsOutboxItem & { nextAttemptAt: Date; lastError: string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** An in-memory store with the shape the Mongo one has. */
function memoryStore() {
  const items = new Map<string, Kept>();
  let seq = 0;
  const store: TarsOutboxStore = {
    add: async (item) => {
      seq += 1;
      items.set(String(seq), { id: String(seq), ...item });
    },
    due: async (now, limit) =>
      [...items.values()]
        .filter((item) => item.nextAttemptAt <= now)
        .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
        .slice(0, limit),
    reschedule: async (id, update) => {
      const item = items.get(id);
      if (item) {
        items.set(id, { ...item, ...update });
      }
    },
    remove: async (id) => {
      items.delete(id);
    },
  };
  return { store, items };
}

const network = () => new Error('fetch failed');
const later = (ms: number) => new Date(Date.now() + ms);
const runAsSystem = jest.fn(<T>(fn: () => Promise<T>) => fn()) as <T>(
  fn: () => Promise<T>,
) => Promise<T>;
/** Lets the scheduler's leader check and drain settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('tars outbox', () => {
  afterEach(() => {
    configureTarsOutbox(null);
    jest.clearAllMocks();
  });

  describe('isRetryableTarsError', () => {
    it.each([
      ['no reply at all', network(), true],
      ['a 5xx', new TarsRequestError(502, '/x'), true],
      ['a 429', new TarsRequestError(429, '/x'), true],
      ['a 4xx', new TarsRequestError(400, '/x'), false],
      ['a 401', new TarsRequestError(401, '/x'), false],
    ])('says %s is %s', (_case, error, retryable) => {
      expect(isRetryableTarsError(error)).toBe(retryable);
    });
  });

  it('waits longer after each failure, up to an hour', () => {
    expect([1, 2, 3, 7, 50].map(tarsOutboxRetryDelayMs)).toEqual([
      60_000, 120_000, 240_000, 3_600_000, 3_600_000,
    ]);
  });

  describe('deferTarsWrite', () => {
    it('keeps a write that failed for a reason worth retrying, until a week from now', async () => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);

      await expect(deferTarsWrite('usage', { tarsId: '42' }, network())).resolves.toBe(true);

      const [kept] = [...items.values()];
      expect(kept).toMatchObject({ kind: 'usage', payload: { tarsId: '42' }, attempts: 1 });
      expect(kept.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
      expect(kept.expiresAt.getTime()).toBeGreaterThan(Date.now() + WEEK_MS - 60_000);
      expect(kept.lastError).toBe('fetch failed');
    });

    it('keeps it as long as the configured age', async () => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store, 60 * 60_000);

      await deferTarsWrite('usage', {}, network());

      const [kept] = [...items.values()];
      expect(kept.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
    });

    it('does not keep a write pwc_tars refused', async () => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);

      await expect(deferTarsWrite('usage', {}, new TarsRequestError(400, '/x'))).resolves.toBe(
        false,
      );
      expect(items.size).toBe(0);
    });

    it('keeps nothing without a store, and never throws when the store fails', async () => {
      await expect(deferTarsWrite('usage', {}, network())).resolves.toBe(false);

      configureTarsOutbox({
        ...memoryStore().store,
        add: async () => Promise.reject(new Error('mongo down')),
      });
      await expect(deferTarsWrite('usage', {}, network())).resolves.toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('drainTarsOutbox', () => {
    it('sends what is due and forgets it once sent', async () => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);
      await deferTarsWrite('usage', { n: 1 }, network());
      await deferTarsWrite('mirror', { n: 2 }, network());
      const usage = jest.fn(async () => undefined);
      const mirror = jest.fn(async () => undefined);

      const counts = await drainTarsOutbox({ usage, mirror }, { now: later(61_000) });

      expect(counts).toEqual({ delivered: 2, retried: 0, dropped: 0 });
      expect(usage).toHaveBeenCalledWith({ n: 1 });
      expect(mirror).toHaveBeenCalledWith({ n: 2 });
      expect(items.size).toBe(0);
    });

    it('leaves what is not due yet', async () => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);
      await deferTarsWrite('usage', {}, network());
      const usage = jest.fn(async () => undefined);

      await drainTarsOutbox({ usage });

      expect(usage).not.toHaveBeenCalled();
      expect(items.size).toBe(1);
    });

    it('sends at most the batch size per round', async () => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);
      for (let n = 0; n < 3; n += 1) {
        await deferTarsWrite('usage', { n }, network());
      }
      const usage = jest.fn(async () => undefined);

      await drainTarsOutbox({ usage }, { now: later(61_000), limit: 2 });

      expect(usage).toHaveBeenCalledTimes(2);
      expect(items.size).toBe(1);
    });

    it('tries again later, and later still, while pwc_tars stays down', async () => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);
      await deferTarsWrite('usage', {}, network());
      const now = later(61_000);

      const counts = await drainTarsOutbox(
        { usage: async () => Promise.reject(network()) },
        { now },
      );

      expect(counts).toEqual({ delivered: 0, retried: 1, dropped: 0 });
      const [kept] = [...items.values()];
      expect(kept.attempts).toBe(2);
      expect(kept.nextAttemptAt.getTime()).toBe(now.getTime() + 120_000);
    });

    it.each([
      ['does not answer', network()],
      ['asks to slow down', new TarsRequestError(429, '/x')],
    ])('ends the round when pwc_tars %s, leaving the rest due', async (_case, error) => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);
      await deferTarsWrite('usage', { n: 1 }, network());
      await deferTarsWrite('usage', { n: 2 }, network());
      const usage = jest.fn(async () => Promise.reject(error));
      const now = later(61_000);

      const counts = await drainTarsOutbox({ usage }, { now });

      expect(counts).toEqual({ delivered: 0, retried: 1, dropped: 0 });
      expect(usage).toHaveBeenCalledTimes(1);
      expect((await store.due(now, 10)).map((item) => item.payload)).toEqual([{ n: 2 }]);
      expect(items.size).toBe(2);
    });

    it('goes on past a write pwc_tars answered with a 5xx', async () => {
      const { store } = memoryStore();
      configureTarsOutbox(store);
      await deferTarsWrite('usage', { n: 1 }, network());
      await deferTarsWrite('usage', { n: 2 }, network());
      const usage = jest
        .fn()
        .mockRejectedValueOnce(new TarsRequestError(503, '/x'))
        .mockResolvedValueOnce(undefined);

      const counts = await drainTarsOutbox({ usage }, { now: later(61_000) });

      expect(counts).toEqual({ delivered: 1, retried: 1, dropped: 0 });
    });

    it.each([
      ['pwc_tars refuses it', new TarsRequestError(400, '/x'), {}],
      ['it has been failing for too long', network(), { expiresAt: later(-1) }],
    ])('gives up a write when %s, and says so', async (_case, error, fields) => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);
      await deferTarsWrite('usage', {}, network());
      const [kept] = [...items.values()];
      items.set(kept.id, { ...kept, ...fields });

      const counts = await drainTarsOutbox(
        { usage: async () => Promise.reject(error) },
        { now: later(61_000) },
      );

      expect(counts).toEqual({ delivered: 0, retried: 0, dropped: 1 });
      expect(items.size).toBe(0);
      expect(jest.mocked(logger.error).mock.calls[0][0]).toContain('did not reach pwc_tars');
    });

    it('gives up a kind it has no handler for', async () => {
      const { store, items } = memoryStore();
      configureTarsOutbox(store);
      await deferTarsWrite('mirror', {}, network());

      const counts = await drainTarsOutbox({}, { now: later(61_000) });

      expect(counts.dropped).toBe(1);
      expect(items.size).toBe(0);
    });

    it('does nothing without a store', async () => {
      await expect(drainTarsOutbox({})).resolves.toEqual({ delivered: 0, retried: 0, dropped: 0 });
    });

    it('never throws when loading due writes fails', async () => {
      configureTarsOutbox({
        ...memoryStore().store,
        due: async () => Promise.reject(new Error('mongo down')),
      });

      await expect(drainTarsOutbox({})).resolves.toEqual({ delivered: 0, retried: 0, dropped: 0 });
      expect(logger.error).toHaveBeenCalled();
    });

    it('continues draining remaining writes when rescheduling one fails', async () => {
      const { store } = memoryStore();
      configureTarsOutbox({
        ...store,
        reschedule: async () => Promise.reject(new Error('mongo write error')),
      });
      await deferTarsWrite('usage', { n: 1 }, network());
      await deferTarsWrite('usage', { n: 2 }, network());

      const usage = jest
        .fn()
        .mockRejectedValueOnce(new TarsRequestError(502, '/x'))
        .mockResolvedValueOnce(undefined);

      const counts = await drainTarsOutbox({ usage }, { now: later(61_000) });

      expect(counts).toEqual({ delivered: 1, retried: 0, dropped: 0 });
      expect(usage).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('createTarsOutbox', () => {
    it('configures the store at once and retries only on the leader', async () => {
      const { store } = memoryStore();
      const usage = jest.fn(async () => undefined);
      const isLeader = jest.fn(async () => false);
      const outbox = createTarsOutbox({ store, handlers: { usage }, isLeader, runAsSystem });

      // Any instance keeps failed writes; only the leader sends them.
      await expect(deferTarsWrite('usage', {}, network())).resolves.toBe(true);
      outbox.start();
      await settle();
      outbox.stop();

      expect(isLeader).toHaveBeenCalled();
      expect(runAsSystem).not.toHaveBeenCalled();
      expect(usage).not.toHaveBeenCalled();
    });

    it('sends on the leader as the system tenant, in rounds of the configured size', async () => {
      const { store } = memoryStore();
      const due = jest.spyOn(store, 'due');
      const outbox = createTarsOutbox({
        store,
        handlers: {},
        isLeader: async () => true,
        runAsSystem,
        config: { batchSize: 7, maxAgeMs: 60 * 60_000 },
      });

      outbox.start();
      await settle();
      outbox.stop();

      expect(runAsSystem).toHaveBeenCalledTimes(1);
      expect(due).toHaveBeenCalledWith(expect.any(Date), 7);
    });

    it('keeps nothing and sends nothing when turned off', async () => {
      const { store } = memoryStore();
      const isLeader = jest.fn(async () => true);
      const outbox = createTarsOutbox({
        store,
        handlers: {},
        isLeader,
        runAsSystem,
        config: { enabled: false },
      });

      await expect(deferTarsWrite('usage', {}, network())).resolves.toBe(false);
      outbox.start();
      await settle();

      expect(isLeader).not.toHaveBeenCalled();
    });
  });
});
