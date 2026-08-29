import {
  registerPendingTarsConversation,
  claimPendingTarsConversation,
  clearPendingTarsConversations,
} from './pending';

beforeEach(() => {
  clearPendingTarsConversations();
});

describe('pending TARS conversation registry', () => {
  it('claims only what the same user registered, exactly once', () => {
    registerPendingTarsConversation('user-a', 'tars-conv-1');

    expect(claimPendingTarsConversation('user-b', 'tars-conv-1')).toBe(false);
    expect(claimPendingTarsConversation('user-a', 'tars-conv-1')).toBe(true);
    expect(claimPendingTarsConversation('user-a', 'tars-conv-1')).toBe(false);
  });

  it('tracks multiple pending conversations per user independently', () => {
    registerPendingTarsConversation('user-a', 'tars-conv-1');
    registerPendingTarsConversation('user-a', 'tars-conv-2');

    expect(claimPendingTarsConversation('user-a', 'tars-conv-2')).toBe(true);
    expect(claimPendingTarsConversation('user-a', 'tars-conv-1')).toBe(true);
  });

  it('never claims an unregistered id', () => {
    expect(claimPendingTarsConversation('user-a', 'unknown')).toBe(false);
  });
});
