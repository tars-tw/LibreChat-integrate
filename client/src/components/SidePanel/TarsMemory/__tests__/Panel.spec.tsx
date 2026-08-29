import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { TTarsMemoryDocument } from 'librechat-data-provider';
import TarsMemoryPanel from '../Panel';

let mockConversation: Record<string, unknown> | null = null;
let mockMemoryQuery: Record<string, unknown> = {
  data: undefined,
  isLoading: false,
  isError: false,
};

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: mockConversation, setConversation: jest.fn() }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider/Tars', () => ({
  useTarsMemoryQuery: () => mockMemoryQuery,
  useTarsMemoryDocumentContentQuery: () => ({ data: undefined, isLoading: false }),
  useTarsMemoryStatusMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useDeleteTarsMemoryDocumentMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

const document = (overrides: Partial<TTarsMemoryDocument>): TTarsMemoryDocument => ({
  id: 'doc-1',
  filename: 'report.pdf',
  extension: 'pdf',
  mime_type: 'application/pdf',
  size: 2048,
  status: 1,
  word_count: 100,
  tokens: 500,
  structured: false,
  created_at: null,
  ...overrides,
});

describe('TarsMemoryPanel', () => {
  beforeEach(() => {
    mockConversation = { conversationId: 'convo-1', tarsConversationId: 'tars-conv-1' };
    mockMemoryQuery = { data: undefined, isLoading: false, isError: false };
  });

  it('prompts to upload when the chat has no TARS conversation yet', () => {
    mockConversation = { conversationId: 'new' };
    render(
      <RecoilRoot>
        <TarsMemoryPanel />
      </RecoilRoot>,
    );
    expect(screen.getByText('com_ui_tars_memory_empty_new_chat')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    mockMemoryQuery = { data: undefined, isLoading: true, isError: false };
    const { container } = render(
      <RecoilRoot>
        <TarsMemoryPanel />
      </RecoilRoot>,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows the error state', () => {
    mockMemoryQuery = { data: undefined, isLoading: false, isError: true };
    render(
      <RecoilRoot>
        <TarsMemoryPanel />
      </RecoilRoot>,
    );
    expect(screen.getByText('com_ui_tars_memory_error')).toBeInTheDocument();
  });

  it('renders documents with the include toggle and token meter', () => {
    mockMemoryQuery = {
      isLoading: false,
      isError: false,
      data: {
        tars_conversation_id: 'tars-conv-1',
        documents: [
          document({}),
          document({ id: 'doc-2', filename: 'orders.xlsx', extension: 'xlsx', structured: true }),
        ],
        token_used: 600,
        token_limit: 192000,
      },
    };
    render(
      <RecoilRoot>
        <TarsMemoryPanel />
      </RecoilRoot>,
    );
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('orders.xlsx')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_memory_tokens')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the empty state for a conversation without memory files', () => {
    mockMemoryQuery = {
      isLoading: false,
      isError: false,
      data: {
        tars_conversation_id: 'tars-conv-1',
        documents: [],
        token_used: 0,
        token_limit: 192000,
      },
    };
    render(
      <RecoilRoot>
        <TarsMemoryPanel />
      </RecoilRoot>,
    );
    expect(screen.getByText('com_ui_tars_memory_empty')).toBeInTheDocument();
  });
});
