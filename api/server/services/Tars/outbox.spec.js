const mockStart = jest.fn();
const mockStore = { add: jest.fn(), due: jest.fn(), reschedule: jest.fn(), remove: jest.fn() };

jest.mock('@librechat/api', () => ({
  isLeader: jest.fn(async () => true),
  isTarsConfigured: jest.fn(() => true),
  createTarsOutbox: jest.fn(() => ({ start: mockStart, stop: jest.fn() })),
  redeliverTarsMirror: jest.fn(),
  deliverTarsUsageReport: jest.fn(),
}));
jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
  runAsSystem: jest.fn((fn) => fn()),
  createTarsOutboxStore: jest.fn(() => mockStore),
}));
jest.mock('~/models', () => ({ getConvo: jest.fn(), saveConvo: jest.fn() }));

const { logger, runAsSystem } = require('@librechat/data-schemas');
const {
  isLeader,
  createTarsOutbox,
  isTarsConfigured,
  redeliverTarsMirror,
  deliverTarsUsageReport,
} = require('@librechat/api');
const { startTarsOutbox } = require('./outbox');

describe('startTarsOutbox', () => {
  const outboxConfig = { batchSize: 10 };
  const appConfig = { config: { tars: { outbox: outboxConfig } } };

  it('starts the retry on the Mongo store, as the leader and the system tenant', () => {
    startTarsOutbox(appConfig);

    expect(createTarsOutbox).toHaveBeenCalledWith({
      store: mockStore,
      handlers: { mirror: expect.any(Function), usage: expect.any(Function) },
      isLeader,
      runAsSystem,
      config: outboxConfig,
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('sends kept mirrors and usage reports the way they are delivered again', async () => {
    startTarsOutbox(appConfig);
    const [{ handlers }] = createTarsOutbox.mock.calls[0];

    await handlers.mirror({ message: {} });
    await handlers.usage({ tarsId: '42', body: {} });

    expect(redeliverTarsMirror).toHaveBeenCalledWith(
      { getConvo: expect.any(Function), saveConvo: expect.any(Function) },
      { message: {} },
    );
    expect(deliverTarsUsageReport).toHaveBeenCalledWith({ tarsId: '42', body: {} });
  });

  it('starts nothing when pwc_tars is not configured', () => {
    isTarsConfigured.mockReturnValueOnce(false);

    startTarsOutbox(appConfig);

    expect(createTarsOutbox).not.toHaveBeenCalled();
  });

  it('never throws when the retry cannot start', () => {
    createTarsOutbox.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    expect(() => startTarsOutbox(undefined)).not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });
});
