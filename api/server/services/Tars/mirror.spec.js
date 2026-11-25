const mockChatMirror = jest.fn(async () => undefined);
const mockToTarsResumedTurnMirror = jest.fn();

jest.mock('@librechat/api', () => ({
  isTarsConfigured: jest.fn(() => true),
  createTarsChatMirror: jest.fn(() => mockChatMirror),
  toTarsResumedTurnMirror: (...args) => mockToTarsResumedTurnMirror(...args),
}));
jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock('~/models', () => ({
  getConvo: jest.fn(),
  saveConvo: jest.fn(),
  getMessage: jest.fn(),
  getMessages: jest.fn(),
  getRoleByName: jest.fn(),
}));

const { mirrorResumedTurnToTars } = require('./mirror');

describe('mirrorResumedTurnToTars', () => {
  const req = { user: { id: 'lc-user', tarsId: '42' } };
  const finished = { conversationId: 'lc-c1', responseMessage: { messageId: 'm-1' } };

  it('mirrors the turn the way toTarsResumedTurnMirror describes it', async () => {
    const input = { conversationId: 'lc-c1', messageId: 'm-1', usageReported: true };
    mockToTarsResumedTurnMirror.mockReturnValueOnce(input);

    await mirrorResumedTurnToTars(req, finished);

    expect(mockToTarsResumedTurnMirror).toHaveBeenCalledWith(finished);
    expect(mockChatMirror).toHaveBeenCalledWith(req, input);
  });

  it('mirrors nothing when there is no turn to mirror', () => {
    mockToTarsResumedTurnMirror.mockReturnValueOnce(null);

    expect(mirrorResumedTurnToTars(req, { ...finished, isTemporary: true })).toBeUndefined();
    expect(mockChatMirror).not.toHaveBeenCalled();
  });
});
