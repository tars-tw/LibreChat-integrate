import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import type { TTarsChunk, TTarsDocument, TTarsDatasetWebsite } from 'librechat-data-provider';
import ChunkList from '../ChunkList';

type MutationOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockShowToast = jest.fn();
const options: { update?: MutationOptions; delete?: MutationOptions } = {};

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
  useSetTarsChunkEnabledMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdateTarsChunkMutation: (_docId: string, opts: MutationOptions) => {
    options.update = opts;
    return { mutate: mockUpdate, isLoading: false };
  },
  useDeleteTarsChunkMutation: (_docId: string, opts: MutationOptions) => {
    options.delete = opts;
    return { mutate: mockDelete, isLoading: false };
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
  mockUpdate.mockClear();
  mockDelete.mockClear();
  mockShowToast.mockClear();
});

describe('ChunkList editing', () => {
  it('saves only a changed, non-empty edit and locks navigation while editing', async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    await user.click(screen.getByRole('button', { name: /com_ui_edit/ }));

    const box = screen.getByLabelText('com_ui_tars_kb_chunk_content') as HTMLTextAreaElement;
    expect(box.value).toBe('申請期限為 30 天');
    const save = screen.getByRole('button', { name: 'com_ui_save' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'com_ui_tars_kb_chunk_next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /com_ui_back/ })).toBeDisabled();

    await user.clear(box);
    await user.type(box, '   ');
    expect(save).toBeDisabled();

    await user.clear(box);
    await user.type(box, '申請期限改為 45 天');
    await user.click(save);
    expect(mockUpdate).toHaveBeenCalledWith({
      chunkId: 'c1',
      data: { content: '申請期限改為 45 天' },
    });
  });

  it('leaves edit mode once the save succeeds', async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    await user.click(screen.getByRole('button', { name: /com_ui_edit/ }));
    act(() => options.update?.onSuccess?.());
    expect(screen.queryByLabelText('com_ui_tars_kb_chunk_content')).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith({ message: 'com_ui_saved', status: 'success' });
  });

  it("shows pwc_tars's reason when a save is refused", async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    act(() => options.update?.onError?.({ response: { data: { error: '向量索引更新失敗' } } }));
    expect(mockShowToast).toHaveBeenCalledWith({ message: '向量索引更新失敗', status: 'error' });
  });
});

describe('ChunkList deleting', () => {
  it('asks inline before deleting, then returns to the list', async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    await user.click(screen.getByRole('button', { name: /com_ui_delete/ }));

    const prompt = screen.getByRole('alert');
    expect(prompt).toHaveTextContent('com_ui_tars_kb_chunk_delete_confirm');
    expect(mockDelete).not.toHaveBeenCalled();

    const confirm = screen.getAllByRole('button', { name: 'com_ui_delete' }).at(-1) as HTMLElement;
    await user.click(confirm);
    expect(mockDelete).toHaveBeenCalledWith('c1');

    act(() => options.delete?.onSuccess?.());
    expect(screen.getByText('聯絡窗口為研發處')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancelling the prompt deletes nothing', async () => {
    const user = userEvent.setup();
    await openFirstChunk(user);
    await user.click(screen.getByRole('button', { name: /com_ui_delete/ }));
    await user.click(screen.getByRole('button', { name: 'com_ui_cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('ChunkList website chunks', () => {
  it('offers no edit or delete', async () => {
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
  });
});
