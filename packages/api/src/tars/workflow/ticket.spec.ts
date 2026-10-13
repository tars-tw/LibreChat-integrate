import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { resolveWorkflowTicketSecret, signWorkflowTicket } from './ticket';

const SECRET = 'workflow-ticket-test-secret-0123456789abcdef';

/** Verifies the ticket the way Langflow's `decode_ticket` does. */
const verify = (ticket: string): JwtPayload =>
  jwt.verify(ticket, SECRET, {
    algorithms: ['HS256'],
    issuer: 'librechat',
    audience: 'langflow',
  }) as JwtPayload;

describe('Workflow sign-in ticket', () => {
  const savedAdminRoles = process.env.TARS_ADMIN_ROLE_IDS;

  afterEach(() => {
    if (savedAdminRoles === undefined) {
      delete process.env.TARS_ADMIN_ROLE_IDS;
    } else {
      process.env.TARS_ADMIN_ROLE_IDS = savedAdminRoles;
    }
  });

  it('names the pwc_tars user and lives for one minute', () => {
    const ticket = signWorkflowTicket(
      { tarsId: 'u-42', username: 'alice', name: 'Alice', email: 'alice@x.tw', tarsRoleId: 3 },
      SECRET,
    );
    const claims = verify(ticket);

    expect(claims).toMatchObject({
      sub: 'u-42',
      preferred_username: 'alice',
      name: 'Alice',
      email: 'alice@x.tw',
      admin: false,
    });
    expect(claims.exp! - claims.iat!).toBe(60);
    expect(claims.jti).toEqual(expect.any(String));
  });

  it('marks pwc_tars admin roles as admin', () => {
    expect(verify(signWorkflowTicket({ tarsId: 'u-1', tarsRoleId: 1 }, SECRET)).admin).toBe(true);

    process.env.TARS_ADMIN_ROLE_IDS = '1,7';
    expect(verify(signWorkflowTicket({ tarsId: 'u-7', tarsRoleId: 7 }, SECRET)).admin).toBe(true);
  });

  it('gives every ticket its own id so Langflow can refuse a replay', () => {
    const user = { tarsId: 'u-42', username: 'alice' };
    expect(verify(signWorkflowTicket(user, SECRET)).jti).not.toBe(
      verify(signWorkflowTicket(user, SECRET)).jti,
    );
  });

  it('falls back to the pwc_tars id for the username and omits blank profile fields', () => {
    const claims = verify(signWorkflowTicket({ tarsId: 'u-9', name: '', email: null }, SECRET));

    expect(claims.preferred_username).toBe('u-9');
    expect(claims).not.toHaveProperty('name');
    expect(claims).not.toHaveProperty('email');
  });

  it('names the workspace an admin asked to enter', () => {
    const admin = { tarsId: 'u-1', username: 'root', tarsRoleId: 1 };

    const asSystem = verify(signWorkflowTicket(admin, SECRET, { type: 'system' }));
    expect(asSystem).toMatchObject({ sub: 'u-1', act_as_system: true });
    expect(asSystem).not.toHaveProperty('act_as');

    const asUser = verify(signWorkflowTicket(admin, SECRET, { type: 'user', tarsId: 'u-42' }));
    expect(asUser).toMatchObject({ sub: 'u-1', act_as: 'u-42' });
    expect(asUser).not.toHaveProperty('act_as_system');
  });

  it('refuses a user that is not linked to pwc_tars', () => {
    expect(() => signWorkflowTicket({ username: 'local' }, SECRET)).toThrow(/pwc_tars-linked/);
  });

  it('treats a missing or short secret as not configured', () => {
    expect(resolveWorkflowTicketSecret(undefined)).toBeNull();
    expect(resolveWorkflowTicketSecret('too-short')).toBeNull();
    expect(resolveWorkflowTicketSecret(`  ${SECRET}  `)).toBe(SECRET);
  });
});
