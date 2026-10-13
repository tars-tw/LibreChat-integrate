const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  isTarsConfigured: () => true,
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
  requireTarsMenuAccess: jest.requireActual('~/server/middleware/requireTarsMenuAccess'),
  requireTarsAdmin: jest.requireActual('~/server/middleware/requireTarsAdmin'),
}));

const SECRET = 'workflow-route-test-secret-0123456789abcdef';

const workflowRouter = require('./workflow');

/** The app parses JSON bodies globally (`api/server/index.js`). */
const app = express().use(express.json()).use('/api/tars', workflowRouter);

const postAs = (user) =>
  request(app).post('/api/tars/workflow/ticket').set('x-test-user', JSON.stringify(user));

const claimsOf = (res) =>
  jwt.verify(res.body.ticket, SECRET, { issuer: 'librechat', audience: 'langflow' });

describe('POST /api/tars/workflow/ticket', () => {
  const saved = process.env.TARS_LANGFLOW_SSO_SECRET;

  beforeEach(() => {
    process.env.TARS_LANGFLOW_SSO_SECRET = SECRET;
  });

  afterAll(() => {
    if (saved === undefined) {
      delete process.env.TARS_LANGFLOW_SSO_SECRET;
    } else {
      process.env.TARS_LANGFLOW_SSO_SECRET = saved;
    }
  });

  it('signs a ticket for a role granted Workflow', async () => {
    const res = await postAs({
      tarsId: 'u-1',
      username: 'alice',
      tarsRoleId: 109,
      tarsAdminMenuKeys: ['admin.langflow'],
    });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(claimsOf(res)).toMatchObject({ sub: 'u-1', preferred_username: 'alice', admin: false });
  });

  it('signs an admin ticket for a tars admin without an explicit grant', async () => {
    const res = await postAs({
      tarsId: '1',
      username: 'root',
      tarsRoleId: 1,
      tarsAdminMenuKeys: [],
    });

    expect(res.status).toBe(200);
    expect(claimsOf(res)).toMatchObject({ sub: '1', admin: true });
  });

  it('refuses a user whose roles do not grant Workflow', async () => {
    const res = await postAs({ tarsId: 'u-2', tarsRoleId: 109, tarsAdminMenuKeys: ['kb.list'] });

    expect(res.status).toBe(403);
    expect(res.body.ticket).toBeUndefined();
  });

  it('answers 503 until the shared secret is configured', async () => {
    delete process.env.TARS_LANGFLOW_SSO_SECRET;

    const res = await postAs({ tarsId: '1', tarsRoleId: 1 });

    expect(res.status).toBe(503);
  });

  it('refuses an identity switch requested by a non-admin', async () => {
    const res = await request(app)
      .post('/api/tars/workflow/ticket')
      .set(
        'x-test-user',
        JSON.stringify({ tarsId: 'u-1', tarsRoleId: 109, tarsAdminMenuKeys: ['admin.langflow'] }),
      )
      .send({ actAs: { type: 'system' } });

    expect(res.status).toBe(403);
    expect(res.body.ticket).toBeUndefined();
  });
});

describe('GET /api/tars/workflow/accounts', () => {
  const getAs = (user) =>
    request(app).get('/api/tars/workflow/accounts').set('x-test-user', JSON.stringify(user));

  it('is closed to anyone but a pwc_tars admin, even with the Workflow grant', async () => {
    const res = await getAs({
      tarsId: 'u-1',
      tarsRoleId: 109,
      tarsAdminMenuKeys: ['admin.langflow'],
    });

    expect(res.status).toBe(403);
  });
});
