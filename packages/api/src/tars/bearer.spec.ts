jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import {
  adminSaveTarsDomainMcp,
  adminUpdateTarsMcpServer,
  adminListTarsMcpServers,
  adminListTarsMcpSystemVariables,
} from './mcp/admin';
import { tarsFetch, TarsRequestError } from './client';
import { signTarsBearer } from './bearer';

const SECRET = 'pwc-tars-test-secret';
const ENV_KEYS = ['TARS_AUTH_URL', 'TARS_JWT_SECRET'] as const;

const okResponse = (body: unknown): Response =>
  ({ status: 200, ok: true, json: async () => body }) as Response;

const authorizationOf = (fetchMock: jest.SpyInstance, call = 0): string | undefined =>
  (fetchMock.mock.calls[call][1]?.headers as Record<string, string>).Authorization;

/** Verifies the header the way pwc_tars's `resolve_bearer_user` does and returns the payload. */
const decodeBearer = (header: string | undefined): JwtPayload => {
  expect(header).toMatch(/^Bearer /);
  return jwt.verify(header!.slice('Bearer '.length), SECRET, {
    algorithms: ['HS256'],
  }) as JwtPayload;
};

describe('pwc_tars admin bearer', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
    process.env.TARS_AUTH_URL = 'http://tars.test';
    process.env.TARS_JWT_SECRET = SECRET;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('signs the acting user into a 60s HS256 token', () => {
    const payload = jwt.verify(signTarsBearer('tars-admin-1', SECRET), SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;
    expect(payload.user_id).toBe('tars-admin-1');
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(60);
  });

  it('sends no Authorization unless a user is named', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(okResponse({}));
    await tarsFetch('/api/mcp/servers');
    expect(authorizationOf(fetchMock)).toBeUndefined();
  });

  it('refuses to call pwc_tars as a user when the secret is missing', async () => {
    delete process.env.TARS_JWT_SECRET;
    const fetchMock = jest.spyOn(global, 'fetch');
    const call = tarsFetch('/api/mcp/servers', {
      method: 'POST',
      body: {},
      asUser: 'tars-admin-1',
    });
    await expect(call).rejects.toBeInstanceOf(TarsRequestError);
    await expect(call).rejects.toMatchObject({
      status: 503,
      serverMessage: 'TARS_JWT_SECRET is not configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('authenticates admin mutations as the acting admin', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ success: true, data: { id: 'srv-1' } }));

    await adminUpdateTarsMcpServer('srv-1', { name: 'CRM' }, 'tars-admin-1');
    await adminSaveTarsDomainMcp({ domain_ids: [3], servers: [] }, 'tars-admin-2');

    expect(decodeBearer(authorizationOf(fetchMock, 0)).user_id).toBe('tars-admin-1');
    expect(decodeBearer(authorizationOf(fetchMock, 1)).user_id).toBe('tars-admin-2');
  });

  it('leaves the ungated listing unauthenticated', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ success: true, data: [] }));
    await adminListTarsMcpServers();
    expect(authorizationOf(fetchMock)).toBeUndefined();
  });

  it("lists the system variables resolved for the admin's own account", async () => {
    const variables = [
      { name: 'TARS_CURRENT_LOGINID', value: 'alice' },
      { name: 'TARS_CURRENT_USER_EMAIL', value: null },
    ];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ success: true, data: variables }));

    await expect(adminListTarsMcpSystemVariables('tars-admin-1')).resolves.toEqual(variables);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://tars.test/api/mcp/system-variables?user_id=tars-admin-1',
    );
  });
});
