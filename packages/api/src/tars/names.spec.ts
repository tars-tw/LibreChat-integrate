import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { logger, createMethods, createModels } from '@librechat/data-schemas';
import type { AllMethods, IUser } from '@librechat/data-schemas';
import { backfillTarsDisplayNames } from './names';

let mongoServer: MongoMemoryServer;
let methods: AllMethods;

const seedUser = async (fields: Partial<IUser> & { email: string }): Promise<string> => {
  const { insertedId } = await mongoose.connection
    .db!.collection('users')
    .insertOne({ provider: 'tars', ...fields });
  return insertedId.toString();
};

const readUser = (id: string) =>
  mongoose.connection.db!.collection('users').findOne({ _id: new mongoose.Types.ObjectId(id) });

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  jest.restoreAllMocks();
  await mongoose.connection.dropDatabase();
});

describe('backfillTarsDisplayNames', () => {
  it('sets an empty or missing name to the username and refreshes its search tokens', async () => {
    const empty = await seedUser({ email: 'a@x.io', name: '', username: 'jdoe' });
    const missing = await seedUser({ email: 'b@x.io', username: 'asmith' });
    const info = jest.spyOn(logger, 'info');

    const result = await backfillTarsDisplayNames(methods);

    expect(result).toEqual({ pending: 2, updated: 2 });
    const emptyUser = await readUser(empty);
    expect(emptyUser?.name).toBe('jdoe');
    expect(emptyUser?.nameTokens).toContain('jdoe');
    expect((await readUser(missing))?.name).toBe('asmith');
    expect(info).toHaveBeenCalledWith(expect.stringContaining(`Set the name of user ${empty}`));
    expect(info).toHaveBeenCalledWith(expect.stringContaining(`Set the name of user ${missing}`));
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('jdoe'));
  });

  it('sets a whitespace-only name to the username', async () => {
    const id = await seedUser({ email: 'a@x.io', name: '   ', username: 'jdoe' });

    const result = await backfillTarsDisplayNames(methods);

    expect(result).toEqual({ pending: 1, updated: 1 });
    expect((await readUser(id))?.name).toBe('jdoe');
  });

  it('leaves named, non-tars and username-less accounts unchanged', async () => {
    const named = await seedUser({ email: 'a@x.io', name: 'John', username: 'jdoe' });
    const local = await seedUser({
      email: 'b@x.io',
      name: '',
      username: 'local',
      provider: 'local',
    });
    const noUsername = await seedUser({ email: 'c@x.io', name: '', username: '' });

    const result = await backfillTarsDisplayNames(methods);

    expect(result).toEqual({ pending: 0, updated: 0 });
    expect((await readUser(named))?.name).toBe('John');
    expect((await readUser(local))?.name).toBe('');
    expect((await readUser(noUsername))?.name).toBe('');
  });

  it('reports without writing on a dry run', async () => {
    const id = await seedUser({ email: 'a@x.io', name: '', username: 'jdoe' });
    const info = jest.spyOn(logger, 'info');

    const result = await backfillTarsDisplayNames(methods, { dryRun: true });

    expect(result).toEqual({ pending: 1, updated: 0 });
    expect((await readUser(id))?.name).toBe('');
    expect(info).toHaveBeenCalledWith(expect.stringContaining(`Would set the name of user ${id}`));
  });

  it('finds nothing to do on a second run', async () => {
    await seedUser({ email: 'a@x.io', name: '', username: 'jdoe' });
    await backfillTarsDisplayNames(methods);

    const result = await backfillTarsDisplayNames(methods);

    expect(result).toEqual({ pending: 0, updated: 0 });
  });

  it('keeps a name written by a login after the accounts were read', async () => {
    const id = await seedUser({ email: 'a@x.io', name: '', username: 'jdoe' });
    const findUsers: AllMethods['findUsers'] = async (...args) => {
      const users = await methods.findUsers(...args);
      await methods.updateUser(id, { name: 'John' });
      return users;
    };

    const warn = jest.spyOn(logger, 'warn');

    const result = await backfillTarsDisplayNames({ findUsers, updateUser: methods.updateUser });

    expect(result).toEqual({ pending: 1, updated: 0 });
    expect((await readUser(id))?.name).toBe('John');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Left user ${id} unchanged`));
  });

  it('keeps the expiry of an account that has one', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    const id = await seedUser({ email: 'a@x.io', name: '', username: 'jdoe', expiresAt });

    await backfillTarsDisplayNames(methods);

    expect((await readUser(id))?.expiresAt).toEqual(expiresAt);
  });
});
