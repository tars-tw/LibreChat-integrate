import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import type { Response } from 'express';
import type { WorkflowHandlerDeps } from './handlers';
import type { ServerRequest } from '~/types/http';
import { createWorkflowAccountsHandler, createWorkflowTicketHandler } from './handlers';
import { WorkflowServiceError } from './service';

const SECRET = 'workflow-handler-test-secret-0123456789abcdef';
const ORIGIN = 'http://langflow:7860';

const ADMIN = { tarsId: 'u-1', username: 'root', tarsRoleId: 1 };
const DEVELOPER = { tarsId: 'u-2', username: 'dev', tarsRoleId: 109 };
const ACCOUNTS = [
  { tarsId: 'u-1', username: 'root', lastLoginAt: '2026-10-12T01:00:00Z' },
  { tarsId: 'u-42', username: 'alice', lastLoginAt: '2026-10-11T08:00:00Z' },
];

const verify = (ticket: string): JwtPayload =>
  jwt.verify(ticket, SECRET, { issuer: 'librechat', audience: 'langflow' }) as JwtPayload;

const mockResponse = () => {
  const res = { set: jest.fn(), status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const requestOf = (user: object, body?: object) => ({ user, body }) as unknown as ServerRequest;

const depsWith = (overrides: Partial<WorkflowHandlerDeps> = {}): WorkflowHandlerDeps => ({
  readSecret: () => SECRET,
  readOrigin: () => ORIGIN,
  fetchAccounts: jest.fn().mockResolvedValue(ACCOUNTS),
  recordAudit: jest.fn().mockResolvedValue(undefined),
  readAccess: async (tarsId) => ({
    standing: 'granted',
    isAdmin: tarsId === ADMIN.tarsId,
  }),
  ...overrides,
});

const ticketFrom = (res: ReturnType<typeof mockResponse>): JwtPayload =>
  verify((res.json.mock.calls[0][0] as { ticket: string }).ticket);

describe('Workflow ticket handler', () => {
  it('signs the user into their own workspace without auditing', async () => {
    const deps = depsWith();
    const res = mockResponse();

    await createWorkflowTicketHandler(deps)(requestOf(DEVELOPER), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    const claims = ticketFrom(res);
    expect(claims).toMatchObject({ sub: 'u-2', admin: false });
    expect(claims).not.toHaveProperty('act_as');
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });

  it('lets an admin enter the system account, auditing it first', async () => {
    const deps = depsWith();
    const res = mockResponse();

    await createWorkflowTicketHandler(deps)(
      requestOf(ADMIN, { actAs: { type: 'system' } }),
      res as unknown as Response,
    );

    expect(ticketFrom(res)).toMatchObject({ sub: 'u-1', act_as_system: true });
    expect(deps.recordAudit).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({
        action_type: 'LOGIN',
        module: 'workflow',
        target_name: '系統共用帳號',
      }),
    );
    expect(deps.fetchAccounts).not.toHaveBeenCalled();
  });

  it('lets an admin enter the workspace of someone who has entered Workflow', async () => {
    const deps = depsWith();
    const res = mockResponse();

    await createWorkflowTicketHandler(deps)(
      requestOf(ADMIN, { actAs: { type: 'user', tarsId: 'u-42' } }),
      res as unknown as Response,
    );

    expect(ticketFrom(res)).toMatchObject({ sub: 'u-1', act_as: 'u-42' });
    expect(deps.fetchAccounts).toHaveBeenCalledWith(ORIGIN, SECRET);
    expect(deps.recordAudit).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({
        target_name: 'alice',
        description: '以「alice」的身分進入 Workflow',
      }),
    );
  });

  it('treats acting as oneself as an ordinary sign-in', async () => {
    const deps = depsWith();
    const res = mockResponse();

    await createWorkflowTicketHandler(deps)(
      requestOf(ADMIN, { actAs: { type: 'user', tarsId: 'u-1' } }),
      res as unknown as Response,
    );

    expect(ticketFrom(res)).not.toHaveProperty('act_as');
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses a switch requested by a non-admin', async () => {
    const deps = depsWith();
    const res = mockResponse();

    await createWorkflowTicketHandler(deps)(
      requestOf(DEVELOPER, { actAs: { type: 'system' } }),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses to switch into someone who never entered Workflow', async () => {
    const deps = depsWith();
    const res = mockResponse();

    await createWorkflowTicketHandler(deps)(
      requestOf(ADMIN, { actAs: { type: 'user', tarsId: 'u-404' } }),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });

  it('refuses the switch when it cannot be audited', async () => {
    const deps = depsWith({ recordAudit: jest.fn().mockRejectedValue(new Error('pwc_tars down')) });
    const res = mockResponse();

    await createWorkflowTicketHandler(deps)(
      requestOf(ADMIN, { actAs: { type: 'system' } }),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).not.toHaveBeenCalledWith(
      expect.objectContaining({ ticket: expect.anything() }),
    );
  });

  it('answers 502 when Langflow cannot be reached to resolve the target', async () => {
    const deps = depsWith({
      fetchAccounts: jest.fn().mockRejectedValue(new WorkflowServiceError('down')),
    });
    const res = mockResponse();

    await createWorkflowTicketHandler(deps)(
      requestOf(ADMIN, { actAs: { type: 'user', tarsId: 'u-42' } }),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('rejects a malformed actAs', async () => {
    const res = mockResponse();

    await createWorkflowTicketHandler(depsWith())(
      requestOf(ADMIN, { actAs: { type: 'user' } }),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('refuses with 503 while the shared secret is unset', async () => {
    const res = mockResponse();

    await createWorkflowTicketHandler(depsWith({ readSecret: () => null }))(
      requestOf(DEVELOPER),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Workflow sign-in is not configured' });
  });
});

describe('Workflow ticket handler — access as pwc_tars has it now', () => {
  const developerWithGrant = { ...DEVELOPER, tarsAdminMenuKeys: ['admin.langflow'] };

  it('refuses someone whose role lost Workflow since they logged in', async () => {
    const res = mockResponse();
    const deps = depsWith({ readAccess: async () => ({ standing: 'revoked', isAdmin: false }) });

    await createWorkflowTicketHandler(deps)(
      requestOf(developerWithGrant),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('admits someone granted Workflow since they logged in', async () => {
    const res = mockResponse();

    await createWorkflowTicketHandler(depsWith())(
      requestOf({ ...DEVELOPER, tarsAdminMenuKeys: [] }),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('falls back to the login-time grant while pwc_tars cannot answer', async () => {
    const offline = depsWith({ readAccess: async () => null });

    const granted = mockResponse();
    await createWorkflowTicketHandler(offline)(
      requestOf(developerWithGrant),
      granted as unknown as Response,
    );
    expect(granted.status).toHaveBeenCalledWith(200);

    const refused = mockResponse();
    await createWorkflowTicketHandler(offline)(
      requestOf({ ...DEVELOPER, tarsAdminMenuKeys: [] }),
      refused as unknown as Response,
    );
    expect(refused.status).toHaveBeenCalledWith(403);
  });

  it('stops an admin demoted since login from switching identity', async () => {
    const res = mockResponse();
    const deps = depsWith({ readAccess: async () => ({ standing: 'granted', isAdmin: false }) });

    await createWorkflowTicketHandler(deps)(
      requestOf(ADMIN, { actAs: { type: 'system' } }),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });

  it('signs the live admin role into the ticket', async () => {
    const res = mockResponse();
    const deps = depsWith({ readAccess: async () => ({ standing: 'granted', isAdmin: false }) });

    await createWorkflowTicketHandler(deps)(requestOf(ADMIN), res as unknown as Response);

    expect(ticketFrom(res)).toMatchObject({ sub: 'u-1', admin: false });
  });
});

describe('Workflow accounts handler', () => {
  it('lists everyone who has entered Workflow except the admin asking', async () => {
    const res = mockResponse();

    await createWorkflowAccountsHandler(depsWith())(requestOf(ADMIN), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ accounts: [ACCOUNTS[1]] });
  });

  it('answers 502 when Langflow cannot be reached', async () => {
    const res = mockResponse();

    await createWorkflowAccountsHandler(
      depsWith({
        fetchAccounts: jest.fn().mockRejectedValue(new WorkflowServiceError('down', 500)),
      }),
    )(requestOf(ADMIN), res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('answers 503 until both the secret and the Langflow address are configured', async () => {
    const res = mockResponse();

    await createWorkflowAccountsHandler(depsWith({ readOrigin: () => null }))(
      requestOf(ADMIN),
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
