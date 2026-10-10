import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import type { TTarsChunk, TTarsDocument, TTarsDatasetWebsite } from 'librechat-data-provider';
import ChunkList from '../ChunkList';

type MutationOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const mockSetEnabled = jest.fn();
const mockShowToast = jest.fn();
const options: { enabled?: MutationOptions } = {};

const chunks: TTarsChunk[] = [
  { id: 'c1', document_id: 'd1', position: 1, content: '申請期限為 30 天', enabled: true },
  { id: 'c2', document_id: 'd1', position: 2, content: '聯絡窗口為研發處', enabled: true },
];

jest.mock('~/data-provider', () => ({
  useTarsDocumentChunksQuery: () => ({ data: chunks, isLoading: false }),
  useTarsWebsiteChunksQuery: () => ({
    data: {
      chunks: [
        { id: 'w1', position: 1, content: '網站內容', word_count: 1, tokens: 1, hit_count: 0 },
      ],
    },
    isLoading: false,
  }),
  useSetTarsChunkEnabledMutation: (_docId: string, opts: MutationOptions) => {
    options.enabled = opts;
    return { mutate: mockSetEnabled, isLoading: false };
  },
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/components/Chat/Messages/Content/MarkdownLite', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

const documentSource = {
  kind: 'document' as const,
  document: { id: 'd1', filename: 'verify.txt', status: 2 } as TTarsDocument,
};

const openFirstChunk = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<ChunkList source={documentSource} onClose={jest.fn()} />);
  await user.click(screen.getByText('申請期限為 30 天'));
};

beforeEach(() => {
  mockSetEnabled.mockClear();
  mockShowToast.mockClear();
});

describe('ChunkList document chunks', () => {
  /** Editing and deleting stay out until the deployed pwc_tars carries those routes. */
  it('offers no edit or delete', async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    expect(screen.queryByRole('button', { name: /com_ui_edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /com_ui_delete/ })).toBeNull();
  });

  it('switches a chunk out of retrieval', async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_kb_chunk_enabled_toggle' }));
    expect(mockSetEnabled).toHaveBeenCalledWith({ chunkId: 'c1', enabled: false });
  });

  it("shows pwc_tars's reason when the switch is refused", async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    act(() => options.enabled?.onError?.({ response: { data: { error: '向量索引更新失敗' } } }));
    expect(mockShowToast).toHaveBeenCalledWith({ message: '向量索引更新失敗', status: 'error' });
  });

  it('walks to the next chunk and back to the list', async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    await user.click(screen.getByRole('button', { name: 'com_ui_tars_kb_chunk_next' }));
    expect(screen.getByText('聯絡窗口為研發處')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /com_ui_back/ }));
    expect(screen.getByText('申請期限為 30 天')).toBeInTheDocument();
  });
});

describe('ChunkList website chunks', () => {
  it('offers no edit, delete or retrieval switch', async () => {
    const user = userEvent.setup();
    render(
      <ChunkList
        source={{
          kind: 'website',
          knowledgeBaseId: 'kb1',
          website: { id: 'w', name: 'site' } as TTarsDatasetWebsite,
        }}
        onClose={jest.fn()}
      />,
    );
    await user.click(screen.getByText('網站內容'));
    expect(screen.queryByRole('button', { name: /com_ui_edit/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /com_ui_delete/ })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
