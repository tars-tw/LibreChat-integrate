const multer = require('multer');
const express = require('express');
const request = require('supertest');
const { createTarsUpload } = require('./upload');

const FILENAME = 'verify-藍鵲計畫說明書.txt';

const appWith = (upload) => {
  const app = express();
  app.post('/single', upload.single('file'), (req, res) =>
    res.json({ name: req.file.originalname, size: req.file.size }),
  );
  app.post('/array', upload.array('files'), (req, res) =>
    res.json({ names: req.files.map((file) => file.originalname) }),
  );
  app.use((err, req, res, _next) => res.status(400).json({ code: err.code }));
  return app;
};

describe('createTarsUpload', () => {
  it('keeps a UTF-8 filename intact on a single upload', async () => {
    const res = await request(appWith(createTarsUpload()))
      .post('/single')
      .attach('file', Buffer.from('內容'), FILENAME);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: FILENAME, size: Buffer.byteLength('內容') });
  });

  it('keeps every UTF-8 filename intact on a multi-file upload', async () => {
    const res = await request(appWith(createTarsUpload()))
      .post('/array')
      .attach('files', Buffer.from('a'), '甲.txt')
      .attach('files', Buffer.from('b'), '乙報告.pdf');

    expect(res.body.names).toEqual(['甲.txt', '乙報告.pdf']);
  });

  it('garbles the same filename without the charset option', async () => {
    const res = await request(appWith(multer({ storage: multer.memoryStorage() })))
      .post('/single')
      .attach('file', Buffer.from('x'), FILENAME);

    expect(res.body.name).not.toBe(FILENAME);
  });

  it('applies the limits it is given', async () => {
    const res = await request(appWith(createTarsUpload({ files: 1 })))
      .post('/array')
      .attach('files', Buffer.from('a'), 'a.txt')
      .attach('files', Buffer.from('b'), 'b.txt');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LIMIT_FILE_COUNT');
  });
});
