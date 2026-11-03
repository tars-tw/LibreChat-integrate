jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import http from 'http';
import express from 'express';
import request from 'supertest';
import type { AddressInfo } from 'net';
import type { TarsDocument } from '~/tars/knowledge';
import type { TarsSourceAgent } from './route';
import { invalidateTarsSourceDocumentsCache } from './files';
import { createTarsSourceFileHandler } from './route';
import { tarsSourceFileUrl } from './link';

const HR = '1ea10af6c442450eaa4775ef6717683c';
const DOCX = 'XX公司人力資源管理辦法（臺灣）.docx';
const BODY = 'docx bytes';

const documents: TarsDocument[] = [
  { id: 'd1', filename: DOCX, status: 2, file_path: `apps/static/uploads/${HR}/manual/${DOCX}` },
  {
    id: 'd2',
    filename: 'gone.pdf',
    status: 2,
    file_path: `apps/static/uploads/${HR}/manual/gone.pdf`,
  },
  { id: 'd3', filename: 'x.db', status: 2, file_path: 'apps/static/sqlite/default.db' },
];

const agents: Record<string, TarsSourceAgent> = {
  agent_on: { tools: ['tars_knowledge_search'], tars_source_download: true },
  agent_off: { tools: ['tars_knowledge_search'], tars_source_download: false },
  agent_no_search: { tools: ['web_search'], tars_source_download: true },
};

const findAgent = jest.fn(async (id: string) => agents[id] ?? null);
const listDocuments = jest.fn(async () => documents);

/** pwc_tars's public `/static`, serving only the one stored original. */
const served: string[] = [];
const tars = http.createServer((req, res) => {
  served.push(decodeURIComponent(req.url ?? ''));
  if (decodeURIComponent(req.url ?? '') === `/static/uploads/${HR}/manual/${DOCX}`) {
    res.end(BODY);
    return;
  }
  res.statusCode = 404;
  res.end();
});

const app = express();
app.get(
  '/api/tars/kb-files/:agentId/:knowledgeBaseId/:documentId',
  createTarsSourceFileHandler({ findAgent, listDocuments }),
);

const linkFor = (agentId: string, documentId = 'd1') =>
  tarsSourceFileUrl({ agentId, knowledgeBaseId: HR, documentId }) ?? '';

beforeAll(async () => {
  await new Promise<void>((resolve) => tars.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => tars.close(() => resolve()));
});

beforeEach(() => {
  process.env.TARS_AUTH_URL = `http://127.0.0.1:${(tars.address() as AddressInfo).port}`;
  process.env.JWT_SECRET = 'source-route-secret';
  invalidateTarsSourceDocumentsCache();
  served.length = 0;
  jest.clearAllMocks();
});

describe('createTarsSourceFileHandler', () => {
  it('downloads the cited original while the agent offers it', async () => {
    const res = await request(app).get(linkFor('agent_on')).buffer(true);

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString('utf8')).toBe(BODY);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent(DOCX)}`,
    );
    expect(findAgent).toHaveBeenCalledWith('agent_on');
  });

  it('refuses a tampered or unsigned link before reading anything', async () => {
    const forged = linkFor('agent_on').replace('/d1?', '/d2?');
    expect((await request(app).get(forged)).status).toBe(403);
    expect((await request(app).get(`/api/tars/kb-files/agent_on/${HR}/d1`)).status).toBe(403);
    expect(findAgent).not.toHaveBeenCalled();
  });

  it('closes past links once the switch is off, the search removed or the agent deleted', async () => {
    for (const agentId of ['agent_off', 'agent_no_search', 'agent_deleted']) {
      expect((await request(app).get(linkFor(agentId))).status).toBe(403);
    }
    expect(listDocuments).not.toHaveBeenCalled();
    expect(served).toEqual([]);
  });

  it('serves only a document still listed, from inside its knowledge base folder', async () => {
    expect((await request(app).get(linkFor('agent_on', 'd9'))).status).toBe(404);
    expect((await request(app).get(linkFor('agent_on', 'd3'))).status).toBe(404);
    expect(served).toEqual([]);

    expect((await request(app).get(linkFor('agent_on', 'd2'))).status).toBe(404);
    expect(served).toEqual([`/static/uploads/${HR}/manual/gone.pdf`]);
  });

  it('is absent when TARS is not configured', async () => {
    delete process.env.TARS_AUTH_URL;
    expect((await request(app).get(linkFor('agent_on'))).status).toBe(404);
  });
});
