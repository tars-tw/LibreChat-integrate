jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import {
  TARS_AGENT_DOMAIN_FORBIDDEN,
  TARS_AGENT_DOMAIN_CHECK_UNAVAILABLE,
} from 'librechat-data-provider';
import type { TTarsDomainShareGap } from 'librechat-data-provider';
import type { Response } from 'express';
import type { TarsAgentDomainRequest, TarsDomainAccess } from './domain';
import { createBindTarsAgentDomain } from './domain';

function createResponse() {
  const res = { statusCode: 200, payload: undefined as unknown };
  const response = {
    status(code: number) {
      res.statusCode = code;
      return response;
    },
    json(body: unknown) {
      res.payload = body;
      return response;
    },
  };
  return { res, response: response as unknown as Response };
}

const agentRequest = (overrides: Partial<NonNullable<TarsAgentDomainRequest['body']>> = {}) => ({
  body: { endpoint: 'agents', agent_id: 'agent_abc', domain_id: '100', ...overrides },
  user: { tarsId: '7' },
});

const HR: TTarsDomainShareGap = { id: '205', name: 'HR', is_active: true };
const access = (allowed: boolean, domain: TTarsDomainShareGap = HR): TarsDomainAccess => ({
  allowed,
  domain,
});

describe('createBindTarsAgentDomain', () => {
  const previous = process.env.TARS_AUTH_URL;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = 'http://tars.test';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (previous == null) {
      delete process.env.TARS_AUTH_URL;
    } else {
      process.env.TARS_AUTH_URL = previous;
    }
  });

  it("runs a bound agent's turn against its own brain", async () => {
    const checkDomain = jest.fn(async () => access(true));
    const bind = createBindTarsAgentDomain({ getAgentDomainId: async () => '205', checkDomain });
    const req = agentRequest();
    const next = jest.fn();

    await bind(req, createResponse().response, next);

    expect(req.body.domain_id).toBe('205');
    expect(checkDomain).toHaveBeenCalledWith('7', '205');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('leaves the chat brain in place for an unbound agent', async () => {
    const bind = createBindTarsAgentDomain({ getAgentDomainId: async () => null });
    const req = agentRequest();
    const next = jest.fn();

    await bind(req, createResponse().response, next);

    expect(req.body.domain_id).toBe('100');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['without a grant', HR],
    ['while the brain is disabled', { ...HR, is_active: false }],
    ['after the brain was deleted', { id: '205', name: null, is_active: false }],
  ])(
    'refuses a user %s, naming the brain, instead of falling back to the chat brain',
    async (_label, domain) => {
      const bind = createBindTarsAgentDomain({
        getAgentDomainId: async () => '205',
        checkDomain: async () => access(false, domain),
      });
      const req = agentRequest();
      const next = jest.fn();
      const { res, response } = createResponse();

      await bind(req, response, next);

      expect(res.statusCode).toBe(403);
      expect(res.payload).toEqual(
        expect.objectContaining({ code: TARS_AGENT_DOMAIN_FORBIDDEN, domain }),
      );
      expect(req.body.domain_id).toBe('100');
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('refuses an account not linked to pwc_tars', async () => {
    const checkDomain = jest.fn(async () => access(true));
    const bind = createBindTarsAgentDomain({ getAgentDomainId: async () => '205', checkDomain });
    const { res, response } = createResponse();

    await bind({ ...agentRequest(), user: {} }, response, jest.fn());

    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual(expect.objectContaining({ code: TARS_AGENT_DOMAIN_FORBIDDEN }));
    expect(checkDomain).not.toHaveBeenCalled();
  });

  it('stays closed, with its own code, when pwc_tars cannot answer', async () => {
    const bind = createBindTarsAgentDomain({
      getAgentDomainId: async () => '205',
      checkDomain: async () => {
        throw new Error('down');
      },
    });
    const next = jest.fn();
    const { res, response } = createResponse();

    await bind(agentRequest(), response, next);

    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual(
      expect.objectContaining({ code: TARS_AGENT_DOMAIN_CHECK_UNAVAILABLE }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("asks pwc_tars's share check about the user alone by default", async () => {
    const bodies: unknown[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe('/api/domain_settings/share_check');
      bodies.push(JSON.parse(String(init?.body)));
      return {
        status: 200,
        ok: true,
        json: async () => ({
          domain: { id: 205, name: 'HR', is_active: false },
          missing: [{ principal_type: 'user', principal_id: '7' }],
        }),
      } as unknown as globalThis.Response;
    });
    const bind = createBindTarsAgentDomain({ getAgentDomainId: async () => '205' });
    const { res, response } = createResponse();

    await bind(agentRequest(), response, jest.fn());

    expect(bodies).toEqual([
      { domain_id: '205', principals: [{ principal_type: 'user', principal_id: '7' }] },
    ]);
    expect(res.payload).toEqual(
      expect.objectContaining({ domain: { id: '205', name: 'HR', is_active: false } }),
    );
  });

  it('skips ephemeral agents, other endpoints and an unconfigured TARS without a lookup', async () => {
    const getAgentDomainId = jest.fn(async () => '205');
    const bind = createBindTarsAgentDomain({
      getAgentDomainId,
      checkDomain: async () => access(true),
    });
    const next = jest.fn();

    await bind(agentRequest({ agent_id: 'ephemeral' }), createResponse().response, next);
    await bind(agentRequest({ endpoint: 'openAI' }), createResponse().response, next);
    delete process.env.TARS_AUTH_URL;
    await bind(agentRequest(), createResponse().response, next);

    expect(getAgentDomainId).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(3);
  });
});
