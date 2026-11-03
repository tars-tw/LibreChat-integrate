import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { renderHook } from '@testing-library/react';
import type { TConversation } from 'librechat-data-provider';
import useTarsAgentTemporaryChat from '../useTarsAgentTemporaryChat';
import ChatSettingsProvider from '~/routes/ChatSettings';
import store from '~/store';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ user: undefined }),
}));

let mockRetentionMode: string | undefined;
let mockAgentSelected = false;

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: { retentionMode: mockRetentionMode } } }),
}));

jest.mock('~/components/Chat/Menus/Tars/domain', () => ({
  useTarsAgentSelected: () => mockAgentSelected,
}));

beforeEach(() => {
  localStorage.clear();
  mockRetentionMode = undefined;
  mockAgentSelected = false;
});

function renderTemporary({
  isTemporary,
  conversation,
}: {
  isTemporary: boolean;
  conversation?: Partial<TConversation>;
}) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RecoilRoot
      initializeState={({ set }) => {
        set(store.isTemporary, isTemporary);
        if (conversation) {
          set(store.conversationByIndex(0), conversation as TConversation);
        }
      }}
    >
      <ChatSettingsProvider>{children}</ChatSettingsProvider>
    </RecoilRoot>
  );
  return renderHook(
    () => ({ hidden: useTarsAgentTemporaryChat(), isTemporary: useRecoilValue(store.isTemporary) }),
    { wrapper },
  );
}

describe('useTarsAgentTemporaryChat', () => {
  it('leaves temporary chat alone on the general brain', () => {
    const { result } = renderTemporary({ isTemporary: true });

    expect(result.current.hidden).toBe(false);
    expect(result.current.isTemporary).toBe(true);
  });

  it('hides the toggle and switches off a carried-over mode for a picked agent', () => {
    mockAgentSelected = true;
    const { result } = renderTemporary({ isTemporary: true });

    expect(result.current.hidden).toBe(true);
    expect(result.current.isTemporary).toBe(false);
  });

  it('keeps a started temporary agent conversation temporary', () => {
    mockAgentSelected = true;
    const { result } = renderTemporary({
      isTemporary: true,
      conversation: { conversationId: 'convo-1' },
    });

    expect(result.current.hidden).toBe(true);
    expect(result.current.isTemporary).toBe(true);
  });

  it('defers to an administrator-enforced retention mode', () => {
    mockAgentSelected = true;
    mockRetentionMode = 'ephemeral';
    const { result } = renderTemporary({ isTemporary: true });

    expect(result.current.hidden).toBe(false);
    expect(result.current.isTemporary).toBe(true);
  });
});
