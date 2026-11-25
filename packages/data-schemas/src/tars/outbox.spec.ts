import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TarsOutboxStore } from './outbox';
import { createTarsOutboxStore } from './outbox';

let mongoServer: MongoMemoryServer;
let store: TarsOutboxStore;

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 19, 8, minutes));
const keep = (payload: unknown, nextAttemptAt: Date, kind: 'mirror' | 'usage' = 'usage') =>
  store.add({
    kind,
    payload,
    attempts: 1,
    nextAttemptAt,
    expiresAt: at(60),
    lastError: 'fetch failed',
  });
const collection = () => mongoose.connection.collection('tars_outbox');

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  store = createTarsOutboxStore(mongoose);
  await mongoose.models.TarsOutbox.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});

afterEach(async () => {
  await collection().deleteMany({});
});

describe('the pwc_tars outbox store', () => {
  it('keeps a write as JSON text and gives it back as it was', async () => {
    const payload = { tarsId: '42', body: { 'a.b': 1, $weird: [{ 'trace.key': true }] } };
    await keep(payload, at(1));

    const [item] = await store.due(at(5), 10);

    expect(item).toMatchObject({ kind: 'usage', payload, attempts: 1, expiresAt: at(60) });
    expect(typeof item.id).toBe('string');
    expect(typeof (await collection().findOne({}))?.payload).toBe('string');
  });

  it('gives back only what is due, oldest first, at most the limit', async () => {
    await keep({ n: 3 }, at(3));
    await keep({ n: 1 }, at(1));
    await keep({ n: 2 }, at(2), 'mirror');
    await keep({ n: 9 }, at(9));

    const numbers = async (limit: number) =>
      (await store.due(at(5), limit)).map((item) => (item.payload as { n: number }).n);

    expect(await numbers(2)).toEqual([1, 2]);
    expect(await numbers(10)).toEqual([1, 2, 3]);
  });

  it('moves a write to its next attempt, and forgets it once sent', async () => {
    await keep({}, at(1));
    const [item] = await store.due(at(1), 10);

    await store.reschedule(item.id, { attempts: 2, nextAttemptAt: at(30), lastError: 'down' });
    expect(await store.due(at(5), 10)).toEqual([]);
    const [later] = await store.due(at(30), 10);
    expect(later.attempts).toBe(2);

    await store.remove(item.id);
    expect(await collection().countDocuments()).toBe(0);
  });

  it('drops an unreadable payload instead of blocking the rest of the batch', async () => {
    await collection().insertOne({
      kind: 'usage',
      payload: '{not valid json',
      attempts: 1,
      nextAttemptAt: at(1),
      expiresAt: at(60),
    });
    await keep({ ok: true }, at(2));

    const items = await store.due(at(5), 10);

    expect(items.map((item) => item.payload)).toEqual([{ ok: true }]);
    expect(await collection().countDocuments()).toBe(1);
  });

  it('refuses a kind it does not know', async () => {
    await expect(
      store.add({
        kind: 'other' as 'usage',
        payload: {},
        attempts: 1,
        nextAttemptAt: at(1),
        expiresAt: at(60),
        lastError: '',
      }),
    ).rejects.toThrow();
  });

  it('clips a long error so one bad reply cannot bloat the collection', async () => {
    await store.add({
      kind: 'usage',
      payload: {},
      attempts: 1,
      nextAttemptAt: at(1),
      expiresAt: at(60),
      lastError: 'x'.repeat(5000),
    });

    expect((await collection().findOne({}))?.lastError).toHaveLength(1000);
  });

  it('lets Mongo clear a write a day after it expired, should nothing drain it', async () => {
    const indexes = await collection().indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 86400 }),
    );
  });
});
