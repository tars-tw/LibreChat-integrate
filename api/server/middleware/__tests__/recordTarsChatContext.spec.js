jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@librechat/api', () => ({
  isTarsConfigured: jest.fn(),
  rememberTarsChatContext: jest.fn(),
}));

const { isTarsConfigured, rememberTarsChatContext } = require('@librechat/api');
const recordTarsChatContext = require('../recordTarsChatContext');

describe('recordTarsChatContext', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    isTarsConfigured.mockReturnValue(true);
    req = { user: { id: 'lc-1' }, body: {} };
    res = {};
    next = jest.fn();
  });

  it('records the resolved agent model and the active brain', async () => {
    req.body.domain_id = '100';
    req.body.endpointOption = { agent: Promise.resolve({ model: 'gpt-5.5' }), domain_id: '100' };
    await recordTarsChatContext(req, res, next);

    expect(rememberTarsChatContext).toHaveBeenCalledWith('lc-1', {
      model: 'gpt-5.5',
      domainId: '100',
    });
    expect(next).toHaveBeenCalled();
  });

  it('falls back to the request model parameters, then the body', async () => {
    req.body.endpointOption = { model_parameters: { model: 'gpt-5.4-mini' } };
    await recordTarsChatContext(req, res, next);
    expect(rememberTarsChatContext).toHaveBeenLastCalledWith('lc-1', {
      model: 'gpt-5.4-mini',
      domainId: undefined,
    });

    req.body = { model: 'gemini-3.6-flash', domain_id: 224 };
    await recordTarsChatContext(req, res, next);
    expect(rememberTarsChatContext).toHaveBeenLastCalledWith('lc-1', {
      model: 'gemini-3.6-flash',
      domainId: 224,
    });
  });

  it('does nothing when pwc_tars is unconfigured or the user is unknown', async () => {
    isTarsConfigured.mockReturnValue(false);
    req.body.model = 'gpt-5.5';
    await recordTarsChatContext(req, res, next);

    isTarsConfigured.mockReturnValue(true);
    await recordTarsChatContext({ body: { model: 'gpt-5.5' } }, res, next);

    expect(rememberTarsChatContext).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('continues the chain when the agent fails to load', async () => {
    req.body.endpointOption = { agent: Promise.reject(new Error('boom')) };
    await recordTarsChatContext(req, res, next);

    expect(rememberTarsChatContext).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
