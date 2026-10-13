import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { isTarsAdminRole } from '~/auth/tars';

/** Shared with Langflow, which verifies tickets and service tokens with the same value. */
export const WORKFLOW_TICKET_SECRET_ENV = 'TARS_LANGFLOW_SSO_SECRET';

/** Langflow refuses shorter secrets, so a short one is treated as unset here too. */
export const MIN_WORKFLOW_SECRET_LENGTH = 32;

/**
 * Seconds a ticket stays redeemable. The iframe redeems it the moment the page receives it,
 * so this only bounds a leaked URL; Langflow additionally refuses any ticket living over 5
 * minutes and lets each one through once. A security bound, so deliberately not configurable.
 */
const TICKET_TTL_SECONDS = 60;

/** The parts of a LibreChat user a ticket carries to Langflow. */
export interface WorkflowTicketUser {
  tarsId?: string | null;
  username?: string | null;
  name?: string | null;
  email?: string | null;
  tarsRoleId?: number | null;
}

/** Whose workspace a pwc_tars admin enters instead of their own. */
export type WorkflowActAs = { type: 'system' } | { type: 'user'; tarsId: string };

/** Claims beside the registered ones (`iss`, `aud`, `sub`, `jti`, `iat`, `exp`). */
interface WorkflowTicketClaims {
  preferred_username: string;
  admin: boolean;
  name?: string;
  email?: string;
  act_as?: string;
  act_as_system?: boolean;
}

/** The shared secret, or null while it is missing or too short to be accepted by Langflow. */
export function resolveWorkflowTicketSecret(
  value: string | undefined = process.env[WORKFLOW_TICKET_SECRET_ENV],
): string | null {
  const secret = value?.trim() ?? '';
  return secret.length >= MIN_WORKFLOW_SECRET_LENGTH ? secret : null;
}

const actAsClaims = (
  actAs?: WorkflowActAs,
): Pick<WorkflowTicketClaims, 'act_as' | 'act_as_system'> => {
  if (actAs?.type === 'system') {
    return { act_as_system: true };
  }
  if (actAs?.type === 'user') {
    return { act_as: actAs.tarsId };
  }
  return {};
};

/**
 * Signs the one-time ticket the embedded Langflow (Workflow page) trades for its own session.
 * `sub` is always the person at the browser (`sys_user.id`); without `actAs` the session is on
 * their own account, and `admin` (the pwc_tars admin role, live when the caller knows it) makes
 * that account a Langflow superuser. With `actAs` (admins only — Langflow refuses it otherwise) the session is on the
 * system account or the named user's account instead.
 */
export function signWorkflowTicket(
  user: WorkflowTicketUser,
  secret: string,
  actAs?: WorkflowActAs,
  isAdmin: boolean = isTarsAdminRole(user.tarsRoleId ?? null),
): string {
  if (!user.tarsId) {
    throw new Error('A Workflow ticket needs a pwc_tars-linked user');
  }
  const claims: WorkflowTicketClaims = {
    preferred_username: user.username || user.tarsId,
    admin: isAdmin,
    ...(user.name ? { name: user.name } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...actAsClaims(actAs),
  };
  return jwt.sign(claims, secret, {
    algorithm: 'HS256',
    issuer: 'librechat',
    audience: 'langflow',
    subject: String(user.tarsId),
    jwtid: randomUUID(),
    expiresIn: TICKET_TTL_SECONDS,
  });
}
