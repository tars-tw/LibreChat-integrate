import jwt from 'jsonwebtoken';
import { createPublicKey, randomBytes } from 'crypto';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport';
import type { JsonWebKey, KeyObject } from 'crypto';
import { createHardenedOAuthFetch } from './hardenedFetch';
import { discardBody, readLimitedText } from './body';

/**
 * ID Token validation for MCP servers configured with `oauth.oidc_issuer`, per OIDC Core
 * §3.1.3.7 (authorization code) and §12.2 (refresh). The token proves who signed in, so a
 * failure ends the flow before anything is stored. Asymmetric algorithms only: a shared-secret
 * algorithm would accept a token signed with the provider's public key (algorithm confusion),
 * and `none` proves nothing.
 */

const ALLOWED_ALGORITHMS: jwt.Algorithm[] = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
];
const CLOCK_TOLERANCE_SECONDS = 60;
const JWKS_TIMEOUT_MS = 10_000;
const MAX_JWKS_BYTES = 256 * 1024;

export interface IdTokenTrust {
  issuer: string;
  jwksUri: string;
  clientId: string;
}

export interface IdTokenCheck extends IdTokenTrust {
  idToken: unknown;
  /** Required on the authorization code exchange; a refreshed ID Token may omit it (§12.2). */
  nonce?: string;
  /** The subject of the sign-in this refresh continues, which must not change (§12.2). */
  previousSubject?: string;
  allowedDomains?: string[] | null;
  allowedAddresses?: string[] | null;
  signal?: AbortSignal;
  fetchFn?: FetchLike;
}

/** Messages name the failed check only; they never carry token content. */
export class MCPIdTokenError extends Error {
  constructor(message: string) {
    super(`ID token rejected: ${message}`);
    this.name = 'MCPIdTokenError';
  }
}

/** The keys could not be read, which says nothing about whether the token is genuine. */
export class MCPIdTokenKeysUnavailableError extends MCPIdTokenError {
  constructor(message: string) {
    super(message);
    this.name = 'MCPIdTokenKeysUnavailableError';
  }
}

export function generateIdTokenNonce(): string {
  return randomBytes(32).toString('base64url');
}

async function readSigningKeys(check: IdTokenCheck): Promise<JsonWebKey[]> {
  const fetchFn =
    check.fetchFn ??
    createHardenedOAuthFetch({
      allowedDomains: check.allowedDomains,
      allowedAddresses: check.allowedAddresses,
    });
  const timeout = AbortSignal.timeout(JWKS_TIMEOUT_MS);
  let response: Response;
  let body: string | null;
  try {
    response = await fetchFn(check.jwksUri, {
      headers: { Accept: 'application/json' },
      signal: check.signal ? AbortSignal.any([check.signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await discardBody(response);
      throw new MCPIdTokenKeysUnavailableError(`signing keys endpoint returned ${response.status}`);
    }
    body = await readLimitedText(response, MAX_JWKS_BYTES);
  } catch (error) {
    if (error instanceof MCPIdTokenKeysUnavailableError) {
      throw error;
    }
    throw new MCPIdTokenKeysUnavailableError('signing keys could not be fetched');
  }
  if (body === null) {
    throw new MCPIdTokenKeysUnavailableError('signing keys document is too large');
  }
  let document: { keys?: unknown } | null = null;
  try {
    document = JSON.parse(body) as { keys?: unknown } | null;
  } catch {
    throw new MCPIdTokenKeysUnavailableError('signing keys document is not valid JSON');
  }
  if (!Array.isArray(document?.keys)) {
    throw new MCPIdTokenKeysUnavailableError('signing keys document has no keys');
  }
  /** A malformed entry says nothing about the token either, and would break the key lookup. */
  if (document.keys.some((key) => typeof key !== 'object' || key === null)) {
    throw new MCPIdTokenKeysUnavailableError('signing keys document has a malformed key');
  }
  return document.keys as JsonWebKey[];
}

function selectSigningKey(keys: JsonWebKey[], kid?: string): KeyObject {
  const signing = keys.filter((key) => key.use !== 'enc');
  const matches = kid != null ? signing.filter((key) => key.kid === kid) : signing;
  if (matches.length !== 1) {
    throw new MCPIdTokenError('no unique signing key matches the token');
  }
  try {
    return createPublicKey({ key: matches[0], format: 'jwk' });
  } catch {
    throw new MCPIdTokenError('signing key is not usable');
  }
}

function assertClaims(claims: jwt.JwtPayload, check: IdTokenCheck): void {
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new MCPIdTokenError('sub is missing');
  }
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
    throw new MCPIdTokenError('exp or iat is missing');
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (audiences.length > 1 && claims.azp == null) {
    throw new MCPIdTokenError('azp is required with several audiences');
  }
  if (claims.azp != null && claims.azp !== check.clientId) {
    throw new MCPIdTokenError('azp does not match the client');
  }
  if (check.nonce != null && claims.nonce !== check.nonce) {
    throw new MCPIdTokenError('nonce does not match this sign-in');
  }
  if (check.previousSubject != null && claims.sub !== check.previousSubject) {
    throw new MCPIdTokenError('sub changed on refresh');
  }
}

/** `jwt.decode` throws on a non-JSON payload, and that error quotes the payload. */
function decodeIdToken(idToken: string): jwt.Jwt | null {
  try {
    return jwt.decode(idToken, { complete: true });
  } catch {
    return null;
  }
}

/** Verifies the token and returns its subject, or throws {@link MCPIdTokenError}. */
export async function verifyIdToken(check: IdTokenCheck): Promise<string> {
  if (typeof check.idToken !== 'string' || check.idToken === '') {
    throw new MCPIdTokenError('the provider returned no ID token');
  }
  const decoded = decodeIdToken(check.idToken);
  if (!decoded || typeof decoded.payload === 'string') {
    throw new MCPIdTokenError('it is not a signed JWT');
  }
  /** `crit` names extensions the verifier must understand; this one understands none. */
  if ((decoded.header as jwt.JwtHeader & { crit?: unknown }).crit != null) {
    throw new MCPIdTokenError('it requires an unsupported extension');
  }
  if (!ALLOWED_ALGORITHMS.includes(decoded.header.alg as jwt.Algorithm)) {
    throw new MCPIdTokenError('its signing algorithm is not accepted');
  }

  const key = selectSigningKey(await readSigningKeys(check), decoded.header.kid);
  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(check.idToken, key, {
      algorithms: ALLOWED_ALGORITHMS,
      issuer: check.issuer,
      audience: check.clientId,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }) as jwt.JwtPayload;
  } catch (error) {
    /** jsonwebtoken's messages name the failed claim, never the token itself. */
    throw new MCPIdTokenError(error instanceof Error ? error.message : 'verification failed');
  }
  assertClaims(claims, check);
  return claims.sub as string;
}
