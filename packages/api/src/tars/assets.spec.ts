jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import express from 'express';
import request from 'supertest';

import type { Express } from 'express';

import { rewriteTarsAssetLinks, sendTarsAsset, TARS_ASSET_ROUTE } from './assets';

const BASE_URL = 'http://tars.test';
const CHART_PATH = '/static/quickchart/default/chart_1_abc.png';
const XLSX_PATH = '/static/generate_output/kb_1/%E5%A0%B1%E8%A1%A8_ab.xlsx';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIGNED = /\?sig=[\w-]{22}$/;

/** Mounted exactly as `api/server/index.js` + `routes/tars/assets.js` do. */
function appWithRelay(): Express {
  const app = express();
  const router = express.Router();
  router.get('/:dir/*splat', sendTarsAsset);
  app.use(TARS_ASSET_ROUTE, router);
  return app;
}

const mockTars = (status: number) =>
  jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(PNG, { status }));

beforeEach(() => {
  process.env.TARS_AUTH_URL = BASE_URL;
  process.env.JWT_SECRET = 'relay-test-secret';
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('rewriteTarsAssetLinks', () => {
  it('points a chart on any pwc_tars host at the signed relay', () => {
    const relayed = rewriteTarsAssetLinks(`![chart](http://202.5.253.240:85${CHART_PATH})`);
    expect(relayed).toMatch(
      /^!\[chart\]\(\/api\/tars\/static\/quickchart\/default\/chart_1_abc\.png\?sig=[\w-]{22}\)$/,
    );
  });

  it('signs one file the same whatever host or form pwc_tars wrote it in', () => {
    const relayed = rewriteTarsAssetLinks(CHART_PATH);
    expect(relayed).toMatch(SIGNED);
    expect(rewriteTarsAssetLinks(`http://localhost:5000${CHART_PATH}`)).toBe(relayed);
    expect(rewriteTarsAssetLinks(`https://tars.example.com${CHART_PATH}?v=2`)).toBe(relayed);
    expect(rewriteTarsAssetLinks(relayed)).toBe(relayed);
  });

  it('keeps a percent-encoded file name as pwc_tars wrote it', () => {
    const relayed = rewriteTarsAssetLinks(`[下載完整結果 (xlsx)](http://h${XLSX_PATH})`);
    expect(relayed).toContain(
      `(${TARS_ASSET_ROUTE}/generate_output/kb_1/%E5%A0%B1%E8%A1%A8_ab.xlsx?sig=`,
    );
  });

  it('leaves everything outside the relayed directories and types alone', () => {
    const untouched = [
      'http://h/static/uploads/kb_1/contract.pdf',
      'http://h/static/quickchart/default/payload.svg',
      'http://h/static/quickchart/default/../../uploads/kb_1/a.png',
      'http://x.test/c.png',
    ].join('\n');
    expect(rewriteTarsAssetLinks(untouched)).toBe(untouched);
  });

  it('leaves links pointing at pwc_tars when there is no secret to sign with', () => {
    delete process.env.JWT_SECRET;
    expect(rewriteTarsAssetLinks(`http://h${CHART_PATH}`)).toBe(`http://h${CHART_PATH}`);
  });
});

describe('sendTarsAsset', () => {
  it('relays a signed chart under its own content type', async () => {
    const fetchMock = mockTars(200);
    const response = await request(appWithRelay()).get(rewriteTarsAssetLinks(CHART_PATH));

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-disposition']).toMatch(/^inline;/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(response.body as Buffer, Buffer.from(PNG))).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}${CHART_PATH}`, expect.any(Object));
  });

  it('fetches a non-ASCII file name from pwc_tars re-encoded, as a download', async () => {
    const fetchMock = mockTars(200);
    const response = await request(appWithRelay()).get(rewriteTarsAssetLinks(XLSX_PATH));

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''%E5%A0%B1%E8%A1%A8_ab.xlsx",
    );
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}${XLSX_PATH}`, expect.any(Object));
  });

  it('refuses a missing, forged, or borrowed signature without asking pwc_tars', async () => {
    const fetchMock = mockTars(200);
    const app = appWithRelay();
    const signature = rewriteTarsAssetLinks(CHART_PATH).split('?sig=')[1];
    const otherChart = `${TARS_ASSET_ROUTE}/quickchart/default/chart_2_def.png`;

    await request(app).get(`${TARS_ASSET_ROUTE}/quickchart/default/chart_1_abc.png`).expect(403);
    await request(app)
      .get(`${TARS_ASSET_ROUTE}/quickchart/default/chart_1_abc.png?sig=${'x'.repeat(22)}`)
      .expect(403);
    await request(app).get(`${otherChart}?sig=${signature}`).expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never reaches outside the relayed directories', async () => {
    const fetchMock = mockTars(200);
    const app = appWithRelay();

    await request(app).get(`${TARS_ASSET_ROUTE}/uploads/kb_1/contract.pdf?sig=x`).expect(404);
    await request(app)
      .get(`${TARS_ASSET_ROUTE}/quickchart/..%2F..%2Fuploads%2Fkb_1%2Fa.png?sig=x`)
      .expect(404);
    await request(app).get(`${TARS_ASSET_ROUTE}/quickchart/default/payload.svg?sig=x`).expect(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes a missing file through as 404 and any other pwc_tars failure as 502', async () => {
    const app = appWithRelay();
    const relayed = rewriteTarsAssetLinks(CHART_PATH);

    mockTars(404);
    const missing = await request(app).get(relayed);
    jest.restoreAllMocks();

    mockTars(500);
    const failed = await request(app).get(relayed);
    jest.restoreAllMocks();

    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const unreachable = await request(app).get(relayed);

    expect([missing.status, failed.status, unreachable.status]).toEqual([404, 502, 502]);
  });
});
