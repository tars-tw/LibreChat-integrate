import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import type { TTarsKnowledgeBase, TTarsPrincipalInfo } from 'librechat-data-provider';
import KnowledgeModal from '../Modal';

const mockUpdate = jest.fn();
const mockUpload = jest.fn();
const mockSaveChat = jest.fn();
const mockShowToast = jest.fn();
const mockChatQuery: { data?: TTarsPrincipalInfo[]; isError: boolean } = { isError: false };

/** Stable across renders, as React Query's data is; a fresh object would re-run the defaults. */
const mockModelOptions = {
  data: {
    llm: [{ id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' }],
    embedding: [{ id: 'e1', name: 'Embed' }],
    rerank: [{ id: 'r1', name: 'Rerank' }],
  },
  isFetching: false,
};
const mockNoChatList = { data: undefined, isError: false };

jest.mock('~/data-provider', () => ({
  useTarsModelOptionsQuery: () => mockModelOptions,
  useUpdateTarsKnowledgeBaseMutation: () => ({ mutateAsync: mockUpdate, isLoading: false }),
  useUploadTarsKnowledgeBaseMutation: () => ({ mutateAsync: mockUpload, isLoading: false }),
  useSaveTarsKnowledgeBaseChatPermissionsMutation: () => ({
    mutateAsync: mockSaveChat,
    isLoading: false,
  }),
  useTarsKnowledgeBaseChatAssigneesQuery: (id: string | null) =>
    id == null ? mockNoChatList : mockChatQuery,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, string>) =>
    params != null ? `${key} ${Object.values(params).join(' ')}` : key,
}));

const users = [
  { id: 'u1', username: 'amy', display_name: 'Amy' },
  { id: 'u2', username: 'bob', display_name: 'Bob' },
];
const groups = [
  { id: 'g1', name: 'HR' },
  { id: 'g2', name: 'Finance' },
];

const kb = (extra: Partial<TTarsKnowledgeBase> = {}): TTarsKnowledgeBase => ({
  id: 'kb1',
  name: '人資知識庫',
  description: null,
  max_retrieve_count: 20,
  allowed_user_ids: ['u1'],
  allowed_user_group_ids: ['g1'],
  ...extra,
});

const principal = (
  type: 'user' | 'group',
  id: string,
  name: string,
  isActive = true,
): TTarsPrincipalInfo => ({
  principal_type: type,
  principal_id: id,
  name,
  email: null,
  is_active: isActive,
});

const renderModal = (props: Partial<React.ComponentProps<typeof KnowledgeModal>> = {}) => {
  const onClose = jest.fn();
  render(
    <KnowledgeModal
      knowledgeBase={kb()}
      users={users}
      groups={groups}
      canManageAccess={true}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
};

const save = () => userEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
const chatTab = () => screen.getByRole('tab', { name: /com_ui_tars_kb_chat_tab/ });

/** Opens a picker by its label, toggles one option, and closes it with its own trigger. */
const pick = async (label: string, option: string) => {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(screen.getByRole('option', { name: option }));
  await userEvent.click(screen.getByLabelText(label));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockChatQuery.data = [];
  mockChatQuery.isError = false;
  mockUpdate.mockResolvedValue({});
  mockSaveChat.mockResolvedValue({});
  mockUpload.mockResolvedValue({ knowledge_base_id: 'kb-new' });
});

describe('editing as an admin', () => {
  it('shows both lists as tabs, with their sizes', () => {
    mockChatQuery.data = [principal('user', 'u2', 'Bob')];
    renderModal();

    expect(screen.getByRole('tab', { name: /com_ui_tars_kb_manage_tab\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /com_ui_tars_kb_chat_tab\s*1/ })).toBeInTheDocument();
    expect(screen.getByText('Amy')).toBeInTheDocument();
  });

  it('saves the management list with the base and leaves an unchanged chat list alone', async () => {
    const { onClose } = renderModal();

    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'kb1',
      data: expect.objectContaining({ allowed_user_ids: ['u1'], allowed_user_group_ids: ['g1'] }),
    });
    expect(mockSaveChat).not.toHaveBeenCalled();
  });

  it('saves a changed chat list after the base', async () => {
    const { onClose } = renderModal();

    await userEvent.click(chatTab());
    await pick('com_ui_tars_kb_chat_users', 'Bob');
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockSaveChat).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb1',
      data: { principals: [{ principal_type: 'user', principal_id: 'u2' }] },
    });
    expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockSaveChat.mock.invocationCallOrder[0],
    );
  });

  it('adds the management list to the chat list in one press', async () => {
    mockChatQuery.data = [principal('user', 'u2', 'Bob')];
    renderModal();

    await userEvent.click(chatTab());
    const add = screen.getByRole('button', { name: /com_ui_tars_kb_chat_copy_manage/ });
    await userEvent.click(add);
    expect(add).toBeDisabled();
    await save();

    await waitFor(() => expect(mockSaveChat).toHaveBeenCalled());
    expect(mockSaveChat.mock.calls[0][0].data.principals).toEqual([
      { principal_type: 'user', principal_id: 'u2' },
      { principal_type: 'user', principal_id: 'u1' },
      { principal_type: 'group', principal_id: 'g1' },
    ]);
  });

  it('names a disabled assignee, so it can be taken off', async () => {
    mockChatQuery.data = [principal('group', 'g-old', '舊群組', false)];
    renderModal();

    await userEvent.click(chatTab());

    expect(screen.getByText('com_ui_tars_kb_disabled_principal 舊群組')).toBeInTheDocument();
  });

  it('keeps the dialog open with the edits when the chat list fails to save', async () => {
    mockSaveChat.mockRejectedValue({ response: { data: { error: '沒有權限' } } });
    const { onClose } = renderModal();

    await userEvent.click(chatTab());
    await pick('com_ui_tars_kb_chat_groups', 'Finance');
    await save();

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_tars_kb_chat_save_failed 沒有權限',
        status: 'error',
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Finance')).toBeInTheDocument();
  });

  it('waits for the chat list before saving', async () => {
    mockChatQuery.data = undefined;
    renderModal();
    expect(screen.getByRole('button', { name: 'com_ui_save' })).toBeDisabled();
  });

  it('saves the base alone when the chat list could not be read', async () => {
    mockChatQuery.data = undefined;
    mockChatQuery.isError = true;
    const { onClose } = renderModal();

    await userEvent.click(chatTab());
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_tars_kb_chat_load_failed');
    expect(screen.getByLabelText('com_ui_tars_kb_chat_users')).toBeDisabled();
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockSaveChat).not.toHaveBeenCalled();
  });
});

describe('editing as a knowledge base manager', () => {
  it('shows only the chat list and never sends the management list', async () => {
    const { onClose } = renderModal({ canManageAccess: false });

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('com_ui_tars_kb_manage_users')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /com_ui_tars_kb_chat_copy_manage/ }));
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('allowed_user_ids');
    expect(mockSaveChat.mock.calls[0][0].data.principals).toEqual([
      { principal_type: 'user', principal_id: 'u1' },
      { principal_type: 'group', principal_id: 'g1' },
    ]);
  });
});

describe('creating', () => {
  const fillName = () => userEvent.type(screen.getByLabelText(/com_ui_tars_kb_name/), '新知識庫');

  it('saves the chat list for the id pwc_tars gives the new base', async () => {
    const { onClose } = renderModal({ knowledgeBase: null });

    await fillName();
    await userEvent.click(chatTab());
    await pick('com_ui_tars_kb_chat_users', 'Amy');
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockSaveChat).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-new',
      data: { principals: [{ principal_type: 'user', principal_id: 'u1' }] },
    });
  });

  it('skips the chat list when nobody is on it', async () => {
    const { onClose } = renderModal({ knowledgeBase: null });

    await fillName();
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockSaveChat).not.toHaveBeenCalled();
  });

  it('closes with an error when the base was created but its chat list was not', async () => {
    mockSaveChat.mockRejectedValue(new Error('boom'));
    const { onClose } = renderModal({ knowledgeBase: null });

    await fillName();
    await userEvent.click(chatTab());
    await pick('com_ui_tars_kb_chat_users', 'Amy');
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(mockShowToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_tars_kb_saved' }),
    );
  });
});
