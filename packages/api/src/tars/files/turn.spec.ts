import mongoose from 'mongoose';
import { Constants } from 'librechat-data-provider';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMethods, createModels } from '@librechat/data-schemas';
import type { AllMethods } from '@librechat/data-schemas';
import type { TarsStoredFile, TarsTurnFilesSource } from './turn';
import type { ThreadMessage } from '~/utils/message';
import {
  getTarsTurnFiles,
  primeTarsTurnFiles,
  resolveTarsTurnFiles,
  buildTarsDataFilesContext,
} from './turn';

const OWNER = new mongoose.Types.ObjectId().toString();
const STRANGER = new mongoose.Types.ObjectId().toString();
const CONVO = 'convo-1';
const NO_PARENT = String(Constants.NO_PARENT);

let mongoServer: MongoMemoryServer;
let methods: AllMethods;

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
  await mongoose.connection.dropDatabase();
  process.env.TARS_AUTH_URL = 'http://tars.test';
});

const addFile = (file_id: string, filename: string, extra: Record<string, unknown> = {}) =>
  mongoose.models.File.create({
    user: OWNER,
    file_id,
    filename,
    filepath: `/uploads/${OWNER}/${file_id}`,
    bytes: 10,
    type: 'application/octet-stream',
    ...extra,
  });

const addMessage = (messageId: string, parentMessageId: string, fileIds: string[] = []) =>
  mongoose.models.Message.create({
    messageId,
    parentMessageId,
    conversationId: CONVO,
    user: OWNER,
    isCreatedByUser: true,
    text: messageId,
    files: fileIds.map((file_id) => ({ file_id })),
  });

/** Wired the way `initializeAgent` wires it, against the real File / Message collections. */
const source = (overrides: Partial<TarsTurnFilesSource> = {}): TarsTurnFilesSource => ({
  requestFileIds: [],
  conversationId: CONVO,
  parentMessageId: 'm2',
  findOwnedFiles: async (fileIds, withText) =>
    ((await methods.getFiles(
      { file_id: { $in: fileIds }, user: OWNER },
      {},
      withText ? 'file_id text' : 'file_id filename llmDeliveryPath',
    )) as TarsStoredFile[] | null) ?? [],
  getThreadMessages: async (conversationId) =>
    (await methods.getMessages({ conversationId }, 'messageId parentMessageId files')).map(
      ({ messageId, parentMessageId, files }): ThreadMessage => ({
        messageId,
        parentMessageId: parentMessageId ?? undefined,
        files: files as ThreadMessage['files'],
      }),
    ),
  ...overrides,
});

describe('resolveTarsTurnFiles', () => {
  beforeEach(async () => {
    await addFile('sheet-now', 'now.xlsx');
    await addFile('sheet-earlier', 'earlier.csv');
    await addFile('sheet-sibling', 'sibling.xls');
    await addFile('notes', 'notes.pdf', { llmDeliveryPath: 'text', text: ' 會議紀錄 ' });
    await addFile('photo', 'photo.png', { llmDeliveryPath: 'provider' });
    await mongoose.models.File.create({
      user: STRANGER,
      file_id: 'foreign-sheet',
      filename: 'foreign.xlsx',
      filepath: '/uploads/x',
      bytes: 1,
      type: 'text/csv',
    });
    await addMessage('m1', NO_PARENT, ['sheet-earlier', 'notes', 'photo']);
    await addMessage('m2', 'm1');
    await addMessage('m2-alt', 'm1', ['sheet-sibling']);
  });

  it('keeps the spreadsheets of this message and of its parent chain, never a sibling branch', async () => {
    const files = await resolveTarsTurnFiles(source({ requestFileIds: ['sheet-now'] }));

    expect(files.dataFiles).toEqual([
      { id: 'sheet-now', filename: 'now.xlsx' },
      { id: 'sheet-earlier', filename: 'earlier.csv' },
    ]);
    await expect(files.loadFileInput()).resolves.toBe('會議紀錄');
  });

  it("skips another user's file even when a message references it", async () => {
    const files = await resolveTarsTurnFiles(
      source({ requestFileIds: ['foreign-sheet'], parentMessageId: NO_PARENT }),
    );
    expect(files.dataFiles).toEqual([]);
  });

  it('reads only the request files for a new conversation', async () => {
    const getThreadMessages = jest.fn();
    const files = await resolveTarsTurnFiles(
      source({
        requestFileIds: ['sheet-now'],
        parentMessageId: NO_PARENT,
        getThreadMessages,
      }),
    );
    expect(files.dataFiles.map((file) => file.id)).toEqual(['sheet-now']);
    expect(getThreadMessages).not.toHaveBeenCalled();
  });
});

describe('primeTarsTurnFiles', () => {
  it('resolves once per request and keeps the result for the tool factories', async () => {
    await addFile('sheet-now', 'now.xlsx');
    const req = {};
    const findOwnedFiles = jest.fn(source().findOwnedFiles);
    const params = source({ requestFileIds: ['sheet-now'], findOwnedFiles });

    const [first, second] = await Promise.all([
      primeTarsTurnFiles(req, params),
      primeTarsTurnFiles(req, params),
    ]);
    expect(first).toBe(second);
    expect(findOwnedFiles).toHaveBeenCalledTimes(1);
    expect(getTarsTurnFiles(req)?.dataFiles).toEqual([{ id: 'sheet-now', filename: 'now.xlsx' }]);
  });

  it('stays empty when TARS is not configured or the lookup fails', async () => {
    delete process.env.TARS_AUTH_URL;
    const findOwnedFiles = jest.fn();
    await expect(
      primeTarsTurnFiles({}, source({ requestFileIds: ['x'], findOwnedFiles })),
    ).resolves.toMatchObject({ dataFiles: [] });
    expect(findOwnedFiles).not.toHaveBeenCalled();

    process.env.TARS_AUTH_URL = 'http://tars.test';
    const failing = source({
      requestFileIds: ['x'],
      findOwnedFiles: () => Promise.reject(new Error('mongo down')),
    });
    await expect(primeTarsTurnFiles({}, failing)).resolves.toMatchObject({ dataFiles: [] });
  });
});

describe('buildTarsDataFilesContext', () => {
  it('lists the spreadsheets by name, or nothing without any', () => {
    expect(buildTarsDataFilesContext([])).toBeNull();
    expect(buildTarsDataFilesContext([{ id: 'a', filename: '銷售.xlsx' }])).toContain(
      '- 銷售.xlsx',
    );
  });
});
