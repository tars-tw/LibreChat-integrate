import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Constants, Tools } from 'librechat-data-provider';
import { createMethods, createModels } from '@librechat/data-schemas';
import type { AllMethods } from '@librechat/data-schemas';
import type { TarsStoredFile, TarsTurnFilesSource } from './turn';
import type { TarsGeneratedLinkMessage } from './generated';
import {
  getTarsTurnFiles,
  primeTarsTurnFiles,
  resolveTarsTurnFiles,
  buildTarsDataFilesContext,
  TARS_THREAD_MESSAGE_FIELDS,
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

const addReply = (messageId: string, parentMessageId: string, attachments: unknown[]) =>
  mongoose.models.Message.create({
    messageId,
    parentMessageId,
    conversationId: CONVO,
    user: OWNER,
    isCreatedByUser: false,
    text: messageId,
    attachments,
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
      withText ? 'file_id text' : 'file_id filename type llmDeliveryPath',
    )) as TarsStoredFile[] | null) ?? [],
  getThreadMessages: async (conversationId, fields) =>
    (await methods.getMessages({ conversationId }, fields)).map(
      ({ messageId, parentMessageId, files, attachments }): TarsGeneratedLinkMessage => ({
        messageId,
        parentMessageId: parentMessageId ?? undefined,
        files: files as TarsGeneratedLinkMessage['files'],
        attachments: attachments as TarsGeneratedLinkMessage['attachments'],
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
    await addFile('photo', 'photo.png', { llmDeliveryPath: 'provider', type: 'image/png' });
    await addFile('deck', 'deck.pdf', { llmDeliveryPath: 'provider', type: 'application/pdf' });
    await addFile('archive', 'logs.zip', { llmDeliveryPath: 'none', type: 'application/zip' });
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

  it('sorts every attachment into exactly one kind, images and kept-out files included', async () => {
    const files = await resolveTarsTurnFiles(source({ requestFileIds: ['deck', 'archive'] }));

    expect(files.textFiles).toEqual([{ id: 'notes', filename: 'notes.pdf' }]);
    expect(files.providerFiles).toEqual([{ id: 'deck', filename: 'deck.pdf' }]);
    expect(files.imageFiles).toEqual([{ id: 'photo', filename: 'photo.png' }]);
    expect(files.otherFiles).toEqual([{ id: 'archive', filename: 'logs.zip' }]);
    expect(files.dataFiles).toEqual([{ id: 'sheet-earlier', filename: 'earlier.csv' }]);
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

describe('resolveTarsTurnFiles generated links', () => {
  const report = '/api/tars/static/generate_output/kb/report.xlsx?sig=a';
  const chart = '/api/tars/static/quickchart/kb/chart.png?sig=b';
  /** The names the context block lists, in its order. */
  const listed = (context: string | null) =>
    [...(context ?? '').matchAll(/^- \w+: !?\[([^\]]+)\]/gm)].map((match) => match[1]);

  beforeEach(async () => {
    await addMessage('u1', NO_PARENT);
    await addReply('a1', 'u1', [
      {
        type: Tools.tars_trace,
        toolCallId: 'c1',
        [Tools.tars_trace]: {
          step: { tool: 'generate_file', ok: true, links: [{ type: 'file', url: report }] },
        },
      },
      {
        type: Tools.web_search,
        toolCallId: 'c2',
        [Tools.web_search]: { organic: [{ link: 'https://example.com' }] },
      },
    ]);
    await addMessage('u2', 'a1');
    await addReply('a2', 'u2', [
      {
        type: Tools.tars_trace,
        toolCallId: 'c3',
        [Tools.tars_trace]: {
          trace: [{ type: 'turn', turn: 1 }],
          links: [{ type: 'chart', url: chart }],
        },
      },
    ]);
    await addReply('a2-alt', 'u2', [
      {
        type: Tools.tars_trace,
        [Tools.tars_trace]: {
          links: [{ type: 'file', url: '/api/tars/static/generate_output/kb/x.xlsx' }],
        },
      },
    ]);
    await addMessage('u3', 'a2');
  });

  it('lists the links of the parent chain through the projected thread, with no files attached', async () => {
    const getThreadMessages = jest.fn(source().getThreadMessages);
    const files = await resolveTarsTurnFiles(source({ parentMessageId: 'u3', getThreadMessages }));

    expect(getThreadMessages).toHaveBeenCalledWith(CONVO, TARS_THREAD_MESSAGE_FIELDS);
    expect(files.dataFiles).toEqual([]);
    expect(files.generatedFilesContext).toContain('# Generated files Runtime Context');
    expect(files.generatedFilesContext).toContain(`- file: [report.xlsx](${report})`);
    expect(files.generatedFilesContext).toContain(`- chart: ![chart.png](${chart})`);
    expect(listed(files.generatedFilesContext)).toEqual(['report.xlsx', 'chart.png']);
  });

  it('loads only the link fields of the attachments', async () => {
    const [reply] = await methods.getMessages(
      { conversationId: CONVO, messageId: 'a1' },
      TARS_THREAD_MESSAGE_FIELDS,
    );

    expect(reply.attachments).toEqual([
      {
        type: Tools.tars_trace,
        [Tools.tars_trace]: { step: { links: [{ type: 'file', url: report }] } },
      },
      { type: Tools.web_search },
    ]);
  });

  it('lists nothing for a new conversation', async () => {
    const files = await resolveTarsTurnFiles(source({ parentMessageId: NO_PARENT }));
    expect(files.generatedFilesContext).toBeNull();
  });

  it('keeps only the newest links `tars.generatedLinksLimit` allows', async () => {
    const files = await resolveTarsTurnFiles(
      source({ parentMessageId: 'u3', generatedLinksLimit: 1 }),
    );
    expect(listed(files.generatedFilesContext)).toEqual(['chart.png']);
  });

  it('still resolves the spreadsheets when a stored trace is malformed', async () => {
    const later = '/api/tars/static/generate_output/kb/later.pdf?sig=c';
    /** Written past Mongoose, which would otherwise cast the attachments. */
    await mongoose.models.Message.collection.insertOne({
      messageId: 'a3',
      parentMessageId: 'u3',
      conversationId: CONVO,
      user: OWNER,
      isCreatedByUser: false,
      text: 'a3',
      attachments: [
        null,
        { type: Tools.tars_trace, [Tools.tars_trace]: { links: 'x', step: { links: 5 } } },
        { type: Tools.tars_trace, [Tools.tars_trace]: { links: [{ type: 'file', url: later }] } },
      ],
    });
    await addFile('sheet-1', 'sales.xlsx');
    await addMessage('u4', 'a3', ['sheet-1']);

    const files = await resolveTarsTurnFiles(source({ parentMessageId: 'u4' }));

    expect(files.dataFiles).toEqual([{ id: 'sheet-1', filename: 'sales.xlsx' }]);
    expect(listed(files.generatedFilesContext)).toEqual(['report.xlsx', 'chart.png', 'later.pdf']);
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
