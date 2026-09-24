import jwt from 'jsonwebtoken';

const BEARER_TTL = '60s';

/**
 * Mints the pwc_tars session token its `@admin_required` routes accept (`{user_id}`, HS256),
 * so LibreChat can act as the signed-in admin without holding that admin's pwc_tars session.
 * `secret` is pwc_tars's own signing key (`SysConst.DEFAULT_SECRET_KEY`); the token lives for
 * one proxied request rather than pwc_tars's multi-hour session.
 */
export function signTarsBearer(tarsUserId: string, secret: string): string {
  return jwt.sign({ user_id: tarsUserId }, secret, { expiresIn: BEARER_TTL, algorithm: 'HS256' });
}
