jest.mock('@librechat/data-schemas', () => {
  process.env.CREDS_KEY = process.env.CREDS_KEY || 'a'.repeat(64);
  return jest.requireActual('@librechat/data-schemas');
});

import http from 'http';
import { decryptV3 } from '@librechat/data-schemas';
import { MCPOptionsSchema } from 'librechat-data-provider';
import type { AddressInfo } from 'net';
import {
  buildTarsOidcEntry,
  sealTarsOidcInput,
  testTarsOidcServer,
  redactTarsOidcServer,
  discoverTarsOidcProvider,
} from './oidc';

const MCP_URL = 'https://mcp.example.com/mcp';
const BASE = { chatMenu: true, title: 'Issues', description: '', timeout: 1000 };

/** A real discovery endpoint, so the hardened fetch and its allowlist are exercised for real. */
function startProvider(document: (origin: string) => unknown, status = 200) {
  const server = http.createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/redirect/.well-known/openid-configuration') {
      res.statusCode = 302;
      res.setHeader('location', '/.well-known/openid-configuration');
      return res.end();
    }
    return res.end(JSON.stringify(document(`http://127.0.0.1:${port}`)));
  });
  return new Promise<{ issuer: string; policy: { allowedAddresses: string[] }; close: () => void }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          issuer: `http://127.0.0.1:${port}`,
          policy: { allowedAddresses: [`127.0.0.1:${port}`] },
          close: () => server.close(),
        });
      });
    },
  );
}

const goodDocument = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/authorize`,
  token_endpoint: `${origin}/token`,
  jwks_uri: `${origin}/jwks`,
  scopes_supported: ['openid', 'offline_access'],
  id_token_signing_alg_values_supported: ['RS256'],
  revocation_endpoint: `${origin}/revoke`,
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'private_key_jwt'],
});

const oidcInput = (issuer: string, auth: Record<string, unknown> = {}) => ({
  name: 'Issues',
  type: 'external' as const,
  connection_config: {
    transport: 'streamable_http',
    url: MCP_URL,
    auth: { type: 'oidc', issuer, client_id: 'librechat', ...auth },
  },
});

describe('discoverTarsOidcProvider', () => {
  it('pins the endpoints of a valid document', async () => {
    const provider = await startProvider(goodDocument);
    await expect(discoverTarsOidcProvider(provider.issuer, provider.policy)).resolves.toEqual({
      offersOfflineAccess: true,
      allowsRefreshGrant: true,
      endpoints: {
        authorization_url: `${provider.issuer}/authorize`,
        token_url: `${provider.issuer}/token`,
        jwks_uri: `${provider.issuer}/jwks`,
        revocation_endpoint: `${provider.issuer}/revoke`,
        token_endpoint_auth_methods: ['client_secret_post'],
      },
    });
    provider.close();
  });

  it('refuses a document naming another issuer (mix-up)', async () => {
    const provider = await startProvider((origin) => ({
      ...goodDocument(origin),
      issuer: 'https://evil.example.com',
    }));
    await expect(discoverTarsOidcProvider(provider.issuer, provider.policy)).rejects.toThrow(
      'issuer',
    );
    provider.close();
  });

  it('refuses a provider without S256 or the code flow', async () => {
    const plain = await startProvider((origin) => ({
      ...goodDocument(origin),
      code_challenge_methods_supported: ['plain'],
    }));
    await expect(discoverTarsOidcProvider(plain.issuer, plain.policy)).rejects.toThrow('S256');
    plain.close();
    const implicit = await startProvider((origin) => ({
      ...goodDocument(origin),
      response_types_supported: ['token'],
    }));
    await expect(discoverTarsOidcProvider(implicit.issuer, implicit.policy)).rejects.toThrow(
      '授權碼',
    );
    implicit.close();
  });

  it('refuses a document pointing its token endpoint at plain http elsewhere', async () => {
    const provider = await startProvider((origin) => ({
      ...goodDocument(origin),
      token_endpoint: 'http://attacker.example.com/token',
    }));
    await expect(discoverTarsOidcProvider(provider.issuer, provider.policy)).rejects.toThrow(
      'https',
    );
    provider.close();
  });

  it('refuses a provider with no JWKS or only symmetric ID Tokens', async () => {
    const noKeys = await startProvider((origin) => ({
      ...goodDocument(origin),
      jwks_uri: undefined,
    }));
    await expect(discoverTarsOidcProvider(noKeys.issuer, noKeys.policy)).rejects.toThrow(
      'jwks_uri',
    );
    noKeys.close();
    const symmetric = await startProvider((origin) => ({
      ...goodDocument(origin),
      id_token_signing_alg_values_supported: ['HS256'],
    }));
    await expect(discoverTarsOidcProvider(symmetric.issuer, symmetric.policy)).rejects.toThrow(
      '非對稱',
    );
    symmetric.close();
  });

  it('does not reach a private address the operator has not allowlisted', async () => {
    const provider = await startProvider(goodDocument);
    const http_ = await discoverTarsOidcProvider(provider.issuer, {}).catch((e: Error) => e);
    expect(http_).toBeInstanceOf(Error);
    const fetchFn = jest.fn();
    await expect(
      discoverTarsOidcProvider('http://169.254.169.254/latest', {}, fetchFn),
    ).rejects.toThrow('https');
    expect(fetchFn).not.toHaveBeenCalled();
    provider.close();
  });

  it('does not follow redirects', async () => {
    const provider = await startProvider(goodDocument);
    await expect(
      discoverTarsOidcProvider(`${provider.issuer}/redirect`, provider.policy),
    ).rejects.toThrow('無法連線');
    provider.close();
  });

  it('refuses an issuer that is not a URL or carries a query', async () => {
    await expect(discoverTarsOidcProvider('not a url', {})).rejects.toThrow('不是有效的 URL');
    await expect(discoverTarsOidcProvider('https://idp.example.com?x=1', {})).rejects.toThrow(
      '查詢參數',
    );
  });

  it('reports a provider that cannot be reached', async () => {
    const provider = await startProvider(goodDocument);
    provider.close();
    await expect(discoverTarsOidcProvider(provider.issuer, provider.policy)).rejects.toThrow(
      '無法連線',
    );
  });

  it('reports a failing status', async () => {
    const provider = await startProvider(goodDocument, 503);
    await expect(discoverTarsOidcProvider(provider.issuer, provider.policy)).rejects.toThrow('503');
    provider.close();
  });

  it('reports a document that is not a JSON object', async () => {
    const provider = await startProvider(() => ['not', 'an', 'object']);
    await expect(discoverTarsOidcProvider(provider.issuer, provider.policy)).rejects.toThrow(
      '格式錯誤',
    );
    provider.close();
  });

  it('reports a connection dropped mid-document as a configuration error', async () => {
    const server = http.createServer((_req, res) => {
      res.write('{"issuer":');
      setTimeout(() => res.destroy(), 10);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await expect(
      discoverTarsOidcProvider(`http://127.0.0.1:${port}`, {
        allowedAddresses: [`127.0.0.1:${port}`],
      }),
    ).rejects.toThrow('無法讀取');
    server.close();
  });

  it('refuses an oversized document', async () => {
    const provider = await startProvider((origin) => ({
      ...goodDocument(origin),
      padding: 'x'.repeat(300 * 1024),
    }));
    await expect(discoverTarsOidcProvider(provider.issuer, provider.policy)).rejects.toThrow(
      '過大',
    );
    provider.close();
  });
});

describe('sealTarsOidcInput', () => {
  it('passes other auth types through untouched', async () => {
    const input = {
      type: 'external',
      connection_config: { transport: 'stdio', auth: { type: 'bearer', value: 'x' } },
    };
    await expect(sealTarsOidcInput(input)).resolves.toBe(input);
  });

  it('encrypts the secret, adds openid and ignores caller-supplied endpoints', async () => {
    const provider = await startProvider(goodDocument);
    const sealed = await sealTarsOidcInput(
      oidcInput(provider.issuer, {
        client_secret: 'top-secret',
        scope: 'profile',
        token_url: 'https://attacker.example.com/token',
        client_secret_enc: 'forged',
      }),
      { policy: provider.policy },
    );
    const auth = sealed.connection_config.auth as Record<string, string>;
    expect(JSON.stringify(sealed)).not.toContain('top-secret');
    expect(decryptV3(auth.client_secret_enc)).toBe('top-secret');
    expect(auth.token_url).toBe(`${provider.issuer}/token`);
    expect(auth.scope).toBe('openid profile');
    provider.close();
  });

  it.each([
    ['client_id', { client_id: '${JWT_SECRET}' }],
    ['scope', { scope: 'openid {{LIBRECHAT_OPENID_ACCESS_TOKEN}}' }],
    ['client_secret', { client_secret: '${CREDS_KEY}' }],
    ['audience', { audience: '{{LIBRECHAT_USER_EMAIL}}' }],
  ])('refuses a placeholder in %s', async (_field, auth) => {
    const provider = await startProvider(goodDocument);
    await expect(
      sealTarsOidcInput(oidcInput(provider.issuer, auth), { policy: provider.policy }),
    ).rejects.toThrow('不允許');
    provider.close();
  });

  it('refuses a placeholder or credentials in the server URL', async () => {
    const provider = await startProvider(goodDocument);
    const withUrl = (url: string) => {
      const input = oidcInput(provider.issuer);
      return { ...input, connection_config: { ...input.connection_config, url } };
    };
    await expect(
      sealTarsOidcInput(withUrl('https://e.example.com/?t={{LIBRECHAT_OPENID_TOKEN}}'), {
        policy: provider.policy,
      }),
    ).rejects.toThrow('不允許');
    await expect(
      sealTarsOidcInput(withUrl('https://user:pw@e.example.com/mcp'), { policy: provider.policy }),
    ).rejects.toThrow('帳號密碼');
    await expect(
      sealTarsOidcInput(withUrl('http://e.example.com/mcp'), { policy: provider.policy }),
    ).rejects.toThrow('https');
    provider.close();
  });

  it('refuses stdio, non-external servers and static headers', async () => {
    const input = oidcInput('https://idp.example.com');
    await expect(
      sealTarsOidcInput({
        ...input,
        connection_config: { ...input.connection_config, transport: 'stdio' },
      }),
    ).rejects.toThrow('streamable_http');
    await expect(sealTarsOidcInput({ ...input, type: 'custom_api' as never })).rejects.toThrow(
      'streamable_http',
    );
    await expect(
      sealTarsOidcInput({
        ...input,
        connection_config: { ...input.connection_config, headers: { Authorization: 'x' } },
      }),
    ).rejects.toThrow('標頭');
  });

  it('keeps a stored secret only while the issuer is unchanged', async () => {
    const provider = await startProvider(goodDocument);
    const first = await sealTarsOidcInput(oidcInput(provider.issuer, { client_secret: 's3cret' }), {
      policy: provider.policy,
    });
    const previous = { id: 's', type: 'external', connection_config: first.connection_config };
    const kept = await sealTarsOidcInput(oidcInput(provider.issuer, { client_secret: '' }), {
      policy: provider.policy,
      previous,
    });
    const keptAuth = kept.connection_config.auth as Record<string, string>;
    expect(decryptV3(keptAuth.client_secret_enc)).toBe('s3cret');

    const other = await startProvider(goodDocument);
    await expect(
      sealTarsOidcInput(oidcInput(other.issuer, { client_secret: '' }), {
        policy: {
          allowedAddresses: [...provider.policy.allowedAddresses, ...other.policy.allowedAddresses],
        },
        previous,
      }),
    ).rejects.toThrow('重新輸入');
    provider.close();
    other.close();
  });
});

describe('scope defaults', () => {
  const scopeOf = async (auth: Record<string, unknown>, offline: boolean) => {
    const provider = await startProvider((origin) => ({
      ...goodDocument(origin),
      scopes_supported: offline ? ['openid', 'offline_access'] : ['openid'],
    }));
    const sealed = await sealTarsOidcInput(oidcInput(provider.issuer, auth), {
      policy: provider.policy,
    });
    provider.close();
    return (sealed.connection_config.auth as Record<string, string>).scope;
  };

  it('asks for a refresh token when left blank and the provider offers it', async () => {
    await expect(scopeOf({}, true)).resolves.toBe('openid offline_access');
    await expect(scopeOf({}, false)).resolves.toBe('openid');
  });

  it('respects a scope the admin entered', async () => {
    await expect(scopeOf({ scope: 'openid profile' }, true)).resolves.toBe('openid profile');
  });
});

describe('redactTarsOidcServer', () => {
  it('drops the ciphertext and reports only that a secret exists', () => {
    const redacted = redactTarsOidcServer({
      connection_config: { auth: { type: 'oidc', issuer: 'i', client_secret_enc: 'v3:abc' } },
    });
    expect(JSON.stringify(redacted)).not.toContain('v3:abc');
    expect(redacted.connection_config.auth).toMatchObject({ has_client_secret: true });
  });

  it('leaves other servers as they are', () => {
    const server = { connection_config: { auth: { type: 'bearer', value: 'x' } } };
    expect(redactTarsOidcServer(server)).toBe(server);
  });
});

describe('buildTarsOidcEntry', () => {
  const stored = async (auth: Record<string, unknown> = {}) => {
    const provider = await startProvider(goodDocument);
    const sealed = await sealTarsOidcInput(oidcInput(provider.issuer, auth), {
      policy: provider.policy,
    });
    return {
      provider,
      server: { id: 's', type: 'external', connection_config: sealed.connection_config },
    };
  };

  it('builds a direct entry that passes the schema and carries no gateway credentials', async () => {
    const { provider, server } = await stored({ client_secret: 's3cret', audience: 'api://mcp' });
    const entry = buildTarsOidcEntry(server, BASE, provider.policy);
    expect(entry).toMatchObject({
      type: 'streamable-http',
      url: MCP_URL,
      requiresOAuth: true,
      startup: false,
    });
    expect(entry).not.toHaveProperty('headers');
    expect(entry?.oauth).toMatchObject({
      client_secret: 's3cret',
      audience: 'api://mcp',
      token_url: `${provider.issuer}/token`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      oidc_issuer: provider.issuer,
      oidc_jwks_uri: `${provider.issuer}/jwks`,
    });
    expect(MCPOptionsSchema.safeParse(entry).success).toBe(true);
    provider.close();
  });

  it('builds a public client without a secret', async () => {
    const { provider, server } = await stored();
    const entry = buildTarsOidcEntry(server, BASE, provider.policy);
    expect(entry?.oauth).not.toHaveProperty('client_secret');
    expect(MCPOptionsSchema.safeParse(entry).success).toBe(true);
    provider.close();
  });

  it.each([
    ['a tampered ciphertext', { client_secret_enc: 'not-a-ciphertext' }],
    ['a placeholder written from elsewhere', { client_id: '${JWT_SECRET}' }],
    ['an unpinned http token endpoint', { token_url: 'http://attacker.example.com/token' }],
  ])('skips a stored row with %s', async (_label, override) => {
    const { provider, server } = await stored();
    const connection = server.connection_config as Record<string, unknown>;
    const entry = buildTarsOidcEntry(
      {
        ...server,
        connection_config: {
          ...connection,
          auth: { ...(connection.auth as object), ...override },
        },
      },
      BASE,
      provider.policy,
    );
    expect(entry).toBeNull();
    provider.close();
  });
});

describe('testTarsOidcServer', () => {
  it('reports success while the pinned endpoints still match, and fails once they move', async () => {
    const provider = await startProvider(goodDocument);
    const sealed = await sealTarsOidcInput(oidcInput(provider.issuer), { policy: provider.policy });
    const server = { id: 's', type: 'external', connection_config: sealed.connection_config };
    await expect(testTarsOidcServer(server, provider.policy)).resolves.toMatchObject({
      connected: true,
      refresh_token_expected: true,
    });
    const auth = sealed.connection_config.auth as Record<string, unknown>;
    await expect(
      testTarsOidcServer(
        {
          ...server,
          connection_config: {
            ...sealed.connection_config,
            auth: { ...auth, token_url: 'https://old.example.com/token' },
          },
        },
        provider.policy,
      ),
    ).rejects.toThrow('變更');
    provider.close();
  });
});
