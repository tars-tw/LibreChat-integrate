import type { Response } from 'express';
import type { TarsAgentDomainRequest } from './domain';
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

describe('createBindTarsAgentDomain', () => {
  const previous = process.env.TARS_AUTH_URL;

  beforeEach(() => {
    process.env.TARS_AUTH_URL = 'http://tars.test';
  });

  afterAll(() => {
    if (previous == null) {
      delete process.env.TARS_AUTH_URL;
    } else {
      process.env.TARS_AUTH_URL = previous;
    }
  });

  it("runs a bound agent's turn against its own brain", async () => {
    const canUseDomain = jest.fn(async () => true);
    const bind = createBindTarsAgentDomain({ getAgentDomainId: async () => '205', canUseDomain });
    const req = agentRequest();
    const next = jest.fn();

    await bind(req, createResponse().response, next);

    expect(req.body.domain_id).toBe('205');
    expect(canUseDomain).toHaveBeenCalledWith('7', '205');
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

  it('refuses a user outside the bound brain instead of falling back to the chat brain', async () => {
    const bind = createBindTarsAgentDomain({
      getAgentDomainId: async () => '205',
      canUseDomain: async () => false,
    });
    const req = agentRequest();
    const next = jest.fn();
    const { res, response } = createResponse();

    await bind(req, response, next);

    expect(res.statusCode).toBe(403);
    expect(req.body.domain_id).toBe('100');
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses an account not linked to pwc_tars', async () => {
    const canUseDomain = jest.fn(async () => true);
    const bind = createBindTarsAgentDomain({ getAgentDomainId: async () => '205', canUseDomain });
    const { res, response } = createResponse();

    await bind({ ...agentRequest(), user: {} }, response, jest.fn());

    expect(res.statusCode).toBe(403);
    expect(canUseDomain).not.toHaveBeenCalled();
  });

  it('skips ephemeral agents, other endpoints and an unconfigured TARS without a lookup', async () => {
    const getAgentDomainId = jest.fn(async () => '205');
    const bind = createBindTarsAgentDomain({ getAgentDomainId, canUseDomain: async () => true });
    const next = jest.fn();

    await bind(agentRequest({ agent_id: 'ephemeral' }), createResponse().response, next);
    await bind(agentRequest({ endpoint: 'openAI' }), createResponse().response, next);
    delete process.env.TARS_AUTH_URL;
    await bind(agentRequest(), createResponse().response, next);

    expect(getAgentDomainId).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(3);
  });
});
