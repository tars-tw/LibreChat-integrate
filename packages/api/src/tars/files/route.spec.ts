import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';
import type { TarsDownloadableFile } from './route';
import { createTarsFileHandler } from './route';
import { signTarsDataFileRefs } from './sign';

const CSV = 'region,amount\nnorth,10\n';

const stored: Record<string, TarsDownloadableFile & { user: string }> = {
  'sheet-1': { file_id: 'sheet-1', filename: '銷售 Q3.csv', user: 'user-1' },
  'doc-1': { file_id: 'doc-1', filename: 'notes.pdf', user: 'user-1' },
};

const findFile = jest.fn(async (fileId: string, userId: string) => {
  const file = stored[fileId];
  return file && file.user === userId ? file : null;
});
const openStream = jest.fn(async () => Readable.from([CSV]));

const app = express();
app.get('/api/tars/files/:fileId', createTarsFileHandler({ findFile, openStream }));

const pathFor = (fileId: string, userId = 'user-1') =>
  signTarsDataFileRefs([{ id: fileId, filename: 'x.csv' }], userId)[0].path;

beforeEach(() => {
  process.env.TARS_AUTH_URL = 'http://tars.test';
  process.env.JWT_SECRET = 'route-test-secret';
  jest.clearAllMocks();
});

describe('createTarsFileHandler', () => {
  it("streams the owner's spreadsheet for a valid reference", async () => {
    const res = await request(app).get(pathFor('sheet-1'));

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString('utf8')).toBe(CSV);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('銷售 Q3.csv'));
    expect(findFile).toHaveBeenCalledWith('sheet-1', 'user-1');
  });

  it('refuses a tampered or unsigned reference before any lookup', async () => {
    const tampered = pathFor('sheet-1').replace('u=user-1', 'u=user-2');
    expect((await request(app).get(tampered)).status).toBe(403);
    expect((await request(app).get('/api/tars/files/sheet-1')).status).toBe(403);
    expect(findFile).not.toHaveBeenCalled();
  });

  it("does not serve another user's file or a non-spreadsheet", async () => {
    expect((await request(app).get(pathFor('sheet-1', 'user-2'))).status).toBe(404);
    expect((await request(app).get(pathFor('doc-1'))).status).toBe(404);
    expect(openStream).not.toHaveBeenCalled();
  });

  it('is absent when TARS is not configured', async () => {
    delete process.env.TARS_AUTH_URL;
    expect((await request(app).get(pathFor('sheet-1'))).status).toBe(404);
  });
});
