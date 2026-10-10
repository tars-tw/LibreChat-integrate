const express = require('express');
const request = require('supertest');

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  isTarsConfigured: () => true,
  fetchTarsReleaseNotes: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
  requireTarsMenuAccess: jest.requireActual('~/server/middleware/requireTarsMenuAccess'),
}));

const { fetchTarsReleaseNotes } = require('@librechat/api');
const aboutRouter = require('./about');

const NOTE = { id: '1', version: 'v1.0.0', title: 'Release', content: '', is_published: true };

const app = express().use('/api/tars', aboutRouter);

const getAs = (user) => request(app).get('/api/tars/home').set('x-test-user', JSON.stringify(user));

describe('GET /api/tars/home', () => {
  beforeEach(() => {
    fetchTarsReleaseNotes.mockReset().mockResolvedValue([NOTE]);
  });

  it('serves a tars admin', async () => {
    const res = await getAs({ tarsId: '1', tarsRoleId: 1, tarsAdminMenuKeys: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ releaseNotes: [NOTE] });
  });

  it('serves a non-admin whose role or group grants 關於', async () => {
    const res = await getAs({
      tarsId: 'u-1',
      tarsRoleId: 109,
      tarsAdminMenuKeys: ['kb.list', 'admin.about'],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ releaseNotes: [NOTE] });
  });

  it('refuses a non-admin without the 關於 grant', async () => {
    const res = await getAs({ tarsId: 'u-2', tarsRoleId: 109, tarsAdminMenuKeys: ['kb.list'] });

    expect(res.status).toBe(403);
    expect(fetchTarsReleaseNotes).not.toHaveBeenCalled();
  });

  it('refuses an account not linked to pwc_tars', async () => {
    const res = await getAs({ tarsAdminMenuKeys: ['admin.about'] });

    expect(res.status).toBe(403);
  });
});
