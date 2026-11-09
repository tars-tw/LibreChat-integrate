import http from 'http';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import { logger } from '@librechat/data-schemas';
import type { AddressInfo } from 'net';
import type { MCPOAuthFlowMetadata, MCPOAuthTokens } from './types';
import type { FlowStateManager } from '~/flow/manager';
import {
  verifyIdToken,
  MCPIdTokenError,
  generateIdTokenNonce,
  MCPIdTokenKeysUnavailableError,
} from './idToken';
import { MCPOAuthHandler } from './handler';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const CLIENT = 'librechat';
const NONCE = 'expected-nonce';

const rsa = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const signingKey = rsa();
const attackerKey = rsa();
const publicJwk = { ...signingKey.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };

/** A real issuer: `/jwks` serves the keys, `/token` answers with whatever the test queues. */
let tokenResponse: Record<string, unknown> = {};
let jwksBody: unknown = { keys: [publicJwk] };
let jwksFailure: 'status' | 'oversize' | 'invalid' | 'dropped' | null = null;
let tokenRequests = 0;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/jwks' && jwksFailure === 'status') {
    res.statusCode = 503;
    return res.end('{}');
  }
  if (req.url === '/jwks' && jwksFailure === 'oversize') {
    return res.end(JSON.stringify({ keys: [], padding: 'x'.repeat(300 * 1024) }));
  }
  if (req.url === '/jwks' && jwksFailure === 'invalid') {
    return res.end('<html>bad gateway</html>');
  }
  if (req.url === '/jwks' && jwksFailure === 'dropped') {
    res.write('{"keys":');
    return setTimeout(() => res.destroy(), 10);
  }
  if (req.url === '/jwks') {
    return res.end(JSON.stringify(jwksBody));
  }
  tokenRequests += 1;
  return res.end(JSON.stringify(tokenResponse));
});

let origin = '';
let policy: { allowedAddresses: string[] };

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  policy = { allowedAddresses: [`127.0.0.1:${port}`] };
});

afterAll(() => server.close());

beforeEach(() => {
  jwksBody = { keys: [publicJwk] };
  jwksFailure = null;
  tokenRequests = 0;
});

const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: origin,
  aud: CLIENT,
  sub: 'user-1',
  nonce: NONCE,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 300,
  ...overrides,
});

const sign = (payload = claims(), key = signingKey.privateKey, kid = 'k1') =>
  jwt.sign(payload, key, { algorithm: 'RS256', keyid: kid });

const verify = (idToken: unknown, extra: Record<string, unknown> = {}) =>
  verifyIdToken({
    idToken,
    issuer: origin,
    jwksUri: `${origin}/jwks`,
    clientId: CLIENT,
    nonce: NONCE,
    ...policy,
    ...extra,
  });

describe('verifyIdToken', () => {
  it('accepts a valid token and returns its subject', async () => {
    await expect(verify(sign())).resolves.toBe('user-1');
  });

  it.each([
    ['a missing token', undefined],
    ['a non-JWT', 'not-a-jwt'],
  ])('rejects %s', async (_label, token) => {
    await expect(verify(token)).rejects.toBeInstanceOf(MCPIdTokenError);
  });

  it('rejects a signature from another key', async () => {
    await expect(verify(sign(claims(), attackerKey.privateKey))).rejects.toBeInstanceOf(
      MCPIdTokenError,
    );
  });

  it('rejects an unsigned token', async () => {
    await expect(verify(jwt.sign(claims(), '', { algorithm: 'none' }))).rejects.toThrow(
      'algorithm',
    );
  });

  it('rejects HS256 signed with the provider public key (algorithm confusion)', async () => {
    const pem = signingKey.publicKey.export({ type: 'spki', format: 'pem' });
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'k1' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims())).toString('base64url');
    const { createHmac } = jest.requireActual<typeof import('crypto')>('crypto');
    const mac = createHmac('sha256', pem).update(`${header}.${body}`).digest('base64url');
    await expect(verify(`${header}.${body}.${mac}`)).rejects.toThrow('algorithm');
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example.com' }],
    ['another audience', { aud: 'other-client' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['the wrong nonce (replay)', { nonce: 'stolen' }],
    ['no nonce', { nonce: undefined }],
    ['several audiences with no azp', { aud: [CLIENT, 'other'] }],
    ['an azp for another client', { azp: 'other-client' }],
    ['no subject', { sub: undefined }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(verify(sign(claims(overrides)))).rejects.toBeInstanceOf(MCPIdTokenError);
  });

  it('accepts several audiences when azp names this client', async () => {
    await expect(verify(sign(claims({ aud: [CLIENT, 'other'], azp: CLIENT })))).resolves.toBe(
      'user-1',
    );
  });

  it('rejects a kid the provider does not publish, and ambiguous keys without one', async () => {
    await expect(verify(sign(claims(), signingKey.privateKey, 'unknown'))).rejects.toThrow(
      'signing key',
    );
    jwksBody = { keys: [publicJwk, { ...publicJwk, kid: 'k2' }] };
    const unkeyed = jwt.sign(claims(), signingKey.privateKey, { algorithm: 'RS256' });
    await expect(verify(unkeyed)).rejects.toThrow('signing key');
  });

  it('rejects an unusable JWKS document', async () => {
    jwksBody = { nothing: true };
    await expect(verify(sign())).rejects.toThrow('no keys');
  });

  it('does not fetch keys from an address the operator has not allowed', async () => {
    await expect(verify(sign(), { allowedAddresses: [] })).rejects.toThrow('could not be fetched');
  });

  it('rejects a changed subject on refresh, and allows the nonce to be absent there', async () => {
    const refreshed = sign(claims({ nonce: undefined }));
    await expect(verify(refreshed, { nonce: undefined, previousSubject: 'user-1' })).resolves.toBe(
      'user-1',
    );
    await expect(
      verify(refreshed, { nonce: undefined, previousSubject: 'someone-else' }),
    ).rejects.toThrow('sub changed');
  });

  it('never puts token content in the error', async () => {
    const token = sign(claims({ iss: 'https://evil.example.com' }));
    const error = await verify(token).catch((e: Error) => e);
    expect(String(error)).not.toContain(token);
  });

  it('rejects a non-JSON payload without quoting it', async () => {
    const part = (text: string) => Buffer.from(text).toString('base64url');
    const header = part(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }));
    const error = await verify(`${header}.${part('secret-not-json')}.${part('sig')}`).catch(
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(MCPIdTokenError);
    expect(String(error)).not.toContain('secret-not-json');
  });

  it('rejects a token requiring an extension it does not understand', async () => {
    const token = jwt.sign(claims(), signingKey.privateKey, {
      algorithm: 'RS256',
      keyid: 'k1',
      header: { alg: 'RS256', crit: ['exp'] } as jwt.JwtHeader,
    });
    await expect(verify(token)).rejects.toThrow('unsupported extension');
  });

  it.each([
    ['a failing status', 'status', 'returned 503'],
    ['an oversized document', 'oversize', 'too large'],
    ['a document that is not JSON', 'invalid', 'not valid JSON'],
    ['a connection dropped mid-body', 'dropped', 'could not be fetched'],
  ] as const)('reports %s as keys being unavailable', async (_label, failure, message) => {
    jwksFailure = failure;
    const error = await verify(sign()).catch((e: Error) => e);
    expect(error).toBeInstanceOf(MCPIdTokenKeysUnavailableError);
    expect(String(error)).toContain(message);
  });

  it.each([[null], ['not-a-key'], [42]])(
    'reports a malformed key entry (%p) as keys being unavailable',
    async (entry) => {
      jwksBody = { keys: [entry, publicJwk] };
      const error = await verify(sign()).catch((e: Error) => e);
      expect(error).toBeInstanceOf(MCPIdTokenKeysUnavailableError);
      expect(String(error)).toContain('malformed key');
    },
  );

  it('treats a key it cannot use as a rejection, not an outage', async () => {
    jwksBody = { keys: [{ kid: 'k1', kty: 'oct', k: 'AAAA' }] };
    const error = await verify(sign()).catch((e: Error) => e);
    expect(error).toBeInstanceOf(MCPIdTokenError);
    expect(error).not.toBeInstanceOf(MCPIdTokenKeysUnavailableError);
    expect(String(error)).toContain('not usable');
  });

  it('generates unguessable, distinct nonces', () => {
    expect(generateIdTokenNonce()).not.toBe(generateIdTokenNonce());
    expect(generateIdTokenNonce().length).toBeGreaterThanOrEqual(43);
  });
});

describe('MCPOAuthHandler', () => {
  const config = () => ({
    client_id: CLIENT,
    scope: 'openid',
    authorization_url: `${origin}/authorize`,
    token_url: `${origin}/token`,
    oidc_issuer: origin,
    oidc_jwks_uri: `${origin}/jwks`,
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });

  const start = () =>
    MCPOAuthHandler.initiateOAuthFlow(
      'tars_secure',
      'https://mcp.example.com/mcp',
      'user',
      {},
      config(),
      null,
      undefined,
      policy.allowedAddresses,
    );

  const flowManagerFor = (metadata: MCPOAuthFlowMetadata) => {
    const state = { status: 'PENDING', createdAt: Date.now(), metadata };
    return {
      getFlowState: jest.fn().mockResolvedValue(state),
      completeFlowIfCurrent: jest.fn().mockResolvedValue('updated'),
      failFlowIfCurrent: jest.fn().mockResolvedValue(true),
    } as unknown as FlowStateManager<MCPOAuthTokens>;
  };

  const complete = (metadata: MCPOAuthFlowMetadata, persist: jest.Mock) =>
    MCPOAuthHandler.completeOAuthFlow('flow', 'code', flowManagerFor(metadata), {}, persist);

  const baseTokens = { access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' };
  const persisting = () =>
    jest.fn(async (tokens: MCPOAuthTokens, done: (t: MCPOAuthTokens) => Promise<void>) => {
      await done(tokens);
      return tokens;
    });

  it('sends a fresh nonce on each authorization request', async () => {
    const [a, b] = [await start(), await start()];
    const nonce = new URL(a.authorizationUrl).searchParams.get('nonce');
    expect(nonce).toBe(a.flowMetadata.idTokenCheck?.nonce);
    expect(nonce).not.toBe(new URL(b.authorizationUrl).searchParams.get('nonce'));
  });

  it('refuses a partial or non-pinned configuration', async () => {
    await expect(
      MCPOAuthHandler.initiateOAuthFlow(
        's',
        'https://mcp.example.com/mcp',
        'user',
        {},
        { ...config(), oidc_jwks_uri: undefined },
        null,
        undefined,
        policy.allowedAddresses,
      ),
    ).rejects.toThrow('oidc_issuer requires');
  });

  it('stores tokens only after the ID Token passes, without keeping the ID Token', async () => {
    const { flowMetadata } = await start();
    const nonce = flowMetadata.idTokenCheck?.nonce;
    tokenResponse = { ...baseTokens, id_token: sign(claims({ nonce })) };
    const persist = persisting();
    const tokens = await complete(flowMetadata, persist);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(tokens.id_token_subject).toBe('user-1');
    expect(tokens).not.toHaveProperty('id_token');
  });

  it.each([
    ['no ID Token', () => ({ ...baseTokens })],
    [
      'a forged signature',
      () => ({ ...baseTokens, id_token: sign(claims(), attackerKey.privateKey) }),
    ],
    ['a replayed nonce', () => ({ ...baseTokens, id_token: sign(claims({ nonce: 'old' })) })],
  ])('stores nothing when the provider returns %s', async (_label, response) => {
    const { flowMetadata } = await start();
    tokenResponse = response();
    const persist = persisting();
    await expect(complete(flowMetadata, persist)).rejects.toBeInstanceOf(MCPIdTokenError);
    expect(tokenRequests).toBe(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it('stores nothing on a sign-in while the signing keys are unreachable', async () => {
    const { flowMetadata } = await start();
    const nonce = flowMetadata.idTokenCheck?.nonce;
    tokenResponse = { ...baseTokens, id_token: sign(claims({ nonce })) };
    jwksFailure = 'status';
    const persist = persisting();
    await expect(complete(flowMetadata, persist)).rejects.toBeInstanceOf(
      MCPIdTokenKeysUnavailableError,
    );
    expect(persist).not.toHaveBeenCalled();
  });

  const refresh = (idTokenSubject?: string) =>
    MCPOAuthHandler.refreshOAuthTokens(
      'old-rt',
      {
        serverName: 'tars_secure',
        clientInfo: { client_id: CLIENT },
        storedTokenEndpoint: `${origin}/token`,
        clientSource: 'configured',
        storedServerUrl: 'https://mcp.example.com/mcp',
        serverUrl: 'https://mcp.example.com/mcp',
        idTokenSubject,
      },
      {},
      config(),
      null,
      policy.allowedAddresses,
    );

  it('keeps the subject through a refresh that returns no ID Token', async () => {
    tokenResponse = { ...baseTokens };
    await expect(refresh('user-1')).resolves.toMatchObject({ id_token_subject: 'user-1' });
  });

  it('validates a refreshed ID Token and strips it', async () => {
    tokenResponse = { ...baseTokens, id_token: sign(claims({ nonce: undefined })) };
    const tokens = await refresh('user-1');
    expect(tokens.id_token_subject).toBe('user-1');
    expect(tokens).not.toHaveProperty('id_token');
  });

  it('fails the refresh when the ID Token is forged or names someone else', async () => {
    tokenResponse = {
      ...baseTokens,
      id_token: sign(claims({ nonce: undefined }), attackerKey.privateKey),
    };
    await expect(refresh('user-1')).rejects.toBeInstanceOf(MCPIdTokenError);
    tokenResponse = { ...baseTokens, id_token: sign(claims({ nonce: undefined, sub: 'other' })) };
    await expect(refresh('user-1')).rejects.toThrow('sub changed');
  });

  it('keeps a rotated refresh token while the signing keys are unreachable', async () => {
    const warn = jest.spyOn(logger, 'warn');
    tokenResponse = {
      ...baseTokens,
      refresh_token: 'rotated-rt',
      id_token: sign(claims({ nonce: undefined })),
    };
    jwksFailure = 'dropped';
    const tokens = await refresh('user-1');
    expect(tokens.refresh_token).toBe('rotated-rt');
    expect(tokens.id_token_subject).toBe('user-1');
    expect(tokens).not.toHaveProperty('id_token');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps a rotated refresh token when the keys document holds a malformed entry', async () => {
    tokenResponse = {
      ...baseTokens,
      refresh_token: 'rotated-rt',
      id_token: sign(claims({ nonce: undefined })),
    };
    jwksBody = { keys: [null] };
    const tokens = await refresh('user-1');
    expect(tokens.refresh_token).toBe('rotated-rt');
    expect(tokens.id_token_subject).toBe('user-1');
  });

  describe('on the pre-configured refresh path', () => {
    /** No stored client: the request goes to `config.token_url` under `config.client_id`. */
    const refreshPreconfigured = (idTokenSubject?: string) =>
      MCPOAuthHandler.refreshOAuthTokens(
        'old-rt',
        {
          serverName: 'tars_secure',
          serverUrl: 'https://mcp.example.com/mcp',
          idTokenSubject,
        },
        {},
        config(),
        null,
        policy.allowedAddresses,
      );

    it('keeps the subject through a refresh that returns no ID Token', async () => {
      tokenResponse = { ...baseTokens };
      await expect(refreshPreconfigured('user-1')).resolves.toMatchObject({
        id_token_subject: 'user-1',
      });
      expect(tokenRequests).toBe(1);
    });

    it('validates a refreshed ID Token and strips it', async () => {
      tokenResponse = { ...baseTokens, id_token: sign(claims({ nonce: undefined })) };
      const tokens = await refreshPreconfigured('user-1');
      expect(tokens.id_token_subject).toBe('user-1');
      expect(tokens).not.toHaveProperty('id_token');
    });

    it('fails the refresh when the ID Token is forged or names someone else', async () => {
      tokenResponse = {
        ...baseTokens,
        id_token: sign(claims({ nonce: undefined }), attackerKey.privateKey),
      };
      await expect(refreshPreconfigured('user-1')).rejects.toBeInstanceOf(MCPIdTokenError);
      tokenResponse = { ...baseTokens, id_token: sign(claims({ nonce: undefined, sub: 'other' })) };
      await expect(refreshPreconfigured('user-1')).rejects.toThrow('sub changed');
    });

    it('keeps a rotated refresh token while the signing keys are unreachable', async () => {
      tokenResponse = {
        ...baseTokens,
        refresh_token: 'rotated-rt',
        id_token: sign(claims({ nonce: undefined })),
      };
      jwksFailure = 'status';
      const tokens = await refreshPreconfigured('user-1');
      expect(tokens.refresh_token).toBe('rotated-rt');
      expect(tokens.id_token_subject).toBe('user-1');
      expect(tokens).not.toHaveProperty('id_token');
    });
  });
});
