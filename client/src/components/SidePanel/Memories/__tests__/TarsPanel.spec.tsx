import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TTarsMemory } from 'librechat-data-provider';
import TarsMemoryPanel from '../Tars/Panel';

const mockMutatePreference = jest.fn();
const mockRefetch = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockShowToast = jest.fn();
const mockMutateAutoUpdate = jest.fn();
const mockCreate = jest.fn();
const mockClear = jest.fn();
const mockGetConversation = jest.fn();
const mockNavigate = jest.fn();
let mockDisabled = false;
let mockRole = 'USER';
let mockRefreshMs = 30000;
type QueryOptions = {
  refetchOnWindowFocus: boolean;
  refetchInterval: (data: unknown, query: { state: { status: string } }) => number | false;
};
let mockLastOptions: QueryOptions;
let mockQuery: { data?: TTarsMemory[]; isLoading: boolean; isError: boolean };
let mockPersonalization: { memories?: boolean; memoryAutoUpdate?: boolean } | undefined;
let mockAccess = true;

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getConversationById: (id: string) => mockGetConversation(id),
    },
  };
});

jest.mock('../AdminSettings', () => ({
  __esModule: true,
  default: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="admin-settings">{trigger}</div>
  ),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('~/hooks', () => ({
  useScrollFade: () => ({ attach: jest.fn(), hasMore: false }),
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useAuthContext: () => ({ user: { role: mockRole } }),
  useHasAccess: () => mockAccess,
}));

jest.mock('~/data-provider', () => ({
  useGetUserQuery: () => ({ data: { personalization: mockPersonalization } }),
  useGetStartupConfig: () => ({ data: { tarsMemoryRefreshMs: mockRefreshMs } }),
  useTarsMemoriesQuery: (options: QueryOptions) => {
    mockLastOptions = options;
    const { data, ...rest } = mockQuery;
    return {
      ...rest,
      data: data && { memories: data, disabled: mockDisabled },
      refetch: mockRefetch,
      isFetching: false,
    };
  },
  useClearTarsMemoriesMutation: () => ({ mutate: mockClear, isLoading: false }),
  useUpdateMemoryPreferencesMutation: () => ({ mutateAsync: mockMutatePreference }),
  useUpdateTarsMemoryPreferencesMutation: () => ({ mutateAsync: mockMutateAutoUpdate }),
  useCreateTarsMemoryMutation: () => ({ mutate: mockCreate, isLoading: false }),
  useUpdateTarsMemoryMutation: () => ({ mutate: mockUpdate, isLoading: false }),
  useDeleteTarsMemoryMutation: () => ({ mutate: mockDelete, isLoading: false }),
  useUpdateMemoryPermissionsMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const record = (overrides: Partial<TTarsMemory>): TTarsMemory => ({
  id: '1',
  conversation_id: null,
  memory_type: 'semantic',
  content: '',
  items: null,
  category: null,
  reason: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...overrides,
});

const profile = record({
  id: '10',
  memory_type: 'profile',
  content: '- 偏好繁體中文\n- 回答要簡潔',
  items: ['偏好繁體中文', '回答要簡潔'],
});
const semantic = record({
  id: '20',
  conversation_id: 'c-1',
  content: '常查詢品質異常流程',
  category: 'requirement',
  reason: '之後可優先整理檢核重點',
});

describe('TarsMemoryPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccess = true;
    mockDisabled = false;
    mockRole = 'USER';
    mockRefreshMs = 30000;
    mockPersonalization = undefined;
    mockQuery = { data: [semantic, profile], isLoading: false, isError: false };
  });

  it('lists each preference and highlight as its own row, preferences first', () => {
    render(<TarsMemoryPanel />);
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('偏好繁體中文');
    expect(rows[1]).toContain('回答要簡潔');
    expect(rows[2]).toContain('常查詢品質異常流程');
    expect(screen.getByText('com_ui_tars_memory_category_requirement')).toBeInTheDocument();
  });

  it('offers the type filter only when both kinds exist', () => {
    const { rerender } = render(<TarsMemoryPanel />);
    expect(screen.getByTestId('tars-memory-type-filter')).toBeInTheDocument();
    mockQuery = { data: [profile], isLoading: false, isError: false };
    rerender(<TarsMemoryPanel />);
    expect(screen.queryByTestId('tars-memory-type-filter')).toBeNull();
  });

  const chooseMode = async (name: string) => {
    fireEvent.click(screen.getByTestId('tars-memory-mode'));
    fireEvent.click(await screen.findByRole('option', { name }));
  };

  it('shows one mode from the two stored preferences', () => {
    const { rerender } = render(<TarsMemoryPanel />);
    const mode = () => screen.getByTestId('tars-memory-mode');
    expect(mode()).toHaveTextContent('com_ui_tars_memory_mode_auto');
    expect(screen.getByText('com_ui_tars_memory_intro')).toBeInTheDocument();

    mockPersonalization = { memoryAutoUpdate: false };
    rerender(<TarsMemoryPanel />);
    expect(mode()).toHaveTextContent('com_ui_tars_memory_mode_manual');
    expect(screen.getByText('com_ui_tars_memory_intro_manual')).toBeInTheDocument();

    mockPersonalization = { memories: false, memoryAutoUpdate: false };
    rerender(<TarsMemoryPanel />);
    expect(mode()).toHaveTextContent('com_ui_tars_memory_mode_off');
    expect(screen.getByText('com_ui_tars_memory_intro_off')).toBeInTheDocument();
  });

  it('going manual changes only the upkeep preference', async () => {
    render(<TarsMemoryPanel />);
    await chooseMode('com_ui_tars_memory_mode_manual');
    await waitFor(() => expect(mockMutateAutoUpdate).toHaveBeenCalledWith(false));
    expect(mockMutatePreference).not.toHaveBeenCalled();
  });

  it('turning off keeps the upkeep preference for when memory returns', async () => {
    render(<TarsMemoryPanel />);
    await chooseMode('com_ui_tars_memory_mode_off');
    await waitFor(() => expect(mockMutatePreference).toHaveBeenCalledWith({ memories: false }));
    expect(mockMutateAutoUpdate).not.toHaveBeenCalled();
  });

  it('coming back from off sets upkeep before memory', async () => {
    mockPersonalization = { memories: false };
    const order: string[] = [];
    mockMutateAutoUpdate.mockImplementationOnce(async () => order.push('upkeep'));
    mockMutatePreference.mockImplementationOnce(async () => order.push('memories'));
    render(<TarsMemoryPanel />);
    await chooseMode('com_ui_tars_memory_mode_manual');
    await waitFor(() => expect(order).toEqual(['upkeep', 'memories']));
  });

  it('reports a failed change and returns to the stored mode', async () => {
    mockMutateAutoUpdate.mockRejectedValueOnce(new Error('down'));
    render(<TarsMemoryPanel />);
    await chooseMode('com_ui_tars_memory_mode_manual');
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_error_updating_preferences',
        status: 'error',
      }),
    );
    expect(screen.getByTestId('tars-memory-mode')).toHaveTextContent(
      'com_ui_tars_memory_mode_auto',
    );
  });

  it('explains an empty list by mode', () => {
    mockQuery = { data: [], isLoading: false, isError: false };
    mockPersonalization = { memoryAutoUpdate: false };
    const { rerender } = render(<TarsMemoryPanel />);
    expect(screen.getByText('com_ui_tars_memory_empty_manual')).toBeInTheDocument();
    mockPersonalization = { memories: false };
    rerender(<TarsMemoryPanel />);
    expect(screen.getByText('com_ui_tars_memory_empty_off')).toBeInTheDocument();
  });

  it('warns about AI rewrites only while the AI maintains memory', async () => {
    mockPersonalization = { memoryAutoUpdate: false };
    mockQuery = { data: [profile], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: 'com_ui_edit_memory' })[0]);
    expect(
      await screen.findByText('com_ui_tars_memory_edit_notice_profile_manual'),
    ).toBeInTheDocument();
  });

  it('adds a memory from the header button', async () => {
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_memory_add' }));

    const field = await screen.findByRole('textbox', { name: 'com_ui_tars_memory_content' });
    expect(screen.getByText('com_ui_tars_memory_add_notice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_save' })).toBeDisabled();

    fireEvent.change(field, { target: { value: '回答時先列出依據文件' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockCreate).toHaveBeenCalledWith('回答時先列出依據文件', expect.any(Object));
  });

  it('refuses an addition past the profile limit', async () => {
    const items = Array.from({ length: 30 }, (_, i) => `item ${i}`);
    mockQuery = {
      data: [{ ...profile, items, content: items.map((item) => `- ${item}`).join('\n') }],
      isLoading: false,
      isError: false,
    };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_memory_add' }));
    const field = await screen.findByRole('textbox', { name: 'com_ui_tars_memory_content' });
    fireEvent.change(field, { target: { value: 'one more' } });
    expect(screen.getByRole('button', { name: 'com_ui_save' })).toBeDisabled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('offers adding in manual upkeep, where nothing else fills memory', () => {
    mockPersonalization = { memoryAutoUpdate: false };
    mockQuery = { data: [], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    expect(screen.getByRole('button', { name: 'com_ui_tars_memory_add' })).toBeInTheDocument();
  });

  it('leaves search out while there is nothing to narrow', () => {
    mockQuery = { data: [], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    expect(screen.queryByLabelText('com_ui_memories_filter')).toBeNull();
  });

  it('explains itself and offers nothing when an administrator turned memory off', () => {
    mockDisabled = true;
    mockQuery = { data: [], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    expect(screen.getByText('com_ui_tars_memory_disabled_title')).toBeInTheDocument();
    expect(screen.queryByTestId('tars-memory-mode')).toBeNull();
    expect(screen.queryByRole('button', { name: 'com_ui_tars_memory_add' })).toBeNull();
  });

  it('clears everything after confirming', async () => {
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_memory_clear' }));
    await screen.findByText('com_ui_tars_memory_clear_confirm');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete' }));
    expect(mockClear).toHaveBeenCalled();
  });

  it('does not offer clearing with nothing to clear', () => {
    mockQuery = { data: [], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    expect(screen.queryByRole('button', { name: 'com_ui_tars_memory_clear' })).toBeNull();
  });

  it('opens a highlight source only for records that have one', () => {
    render(<TarsMemoryPanel />);
    expect(screen.getAllByRole('button', { name: 'com_ui_tars_memory_source' })).toHaveLength(1);
  });

  it('opens the source conversation when it exists', async () => {
    mockGetConversation.mockResolvedValue({});
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_memory_source' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/c/c-1'));
  });

  it('says so when the source conversation is gone', async () => {
    mockGetConversation.mockRejectedValue(new Error('gone'));
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_memory_source' }));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_tars_memory_source_missing',
        status: 'warning',
      }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  const nextRefresh = (status = 'success') =>
    mockLastOptions.refetchInterval(undefined, { state: { status } });

  it('re-reads the list on the configured interval', () => {
    render(<TarsMemoryPanel />);
    expect(nextRefresh()).toBe(30000);
    expect(mockLastOptions.refetchOnWindowFocus).toBe(true);
  });

  it('does not poll when the interval is off', () => {
    mockRefreshMs = 0;
    render(<TarsMemoryPanel />);
    expect(nextRefresh()).toBe(false);
  });

  it('stops asking a failing store until the user retries', () => {
    render(<TarsMemoryPanel />);
    expect(nextRefresh('error')).toBe(false);
  });

  it('holds refreshes while a dialog is open, so edits are not lost', async () => {
    mockQuery = { data: [semantic], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_edit_memory' }));
    await screen.findByRole('textbox', { name: 'com_ui_tars_memory_content' });
    expect(nextRefresh()).toBe(false);
    expect(mockLastOptions.refetchOnWindowFocus).toBe(false);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(nextRefresh()).toBe(30000));
  });

  it('offers admin settings beside the add button, to admins only', () => {
    const { rerender } = render(<TarsMemoryPanel />);
    expect(screen.queryByTestId('admin-settings')).toBeNull();

    mockRole = 'ADMIN';
    rerender(<TarsMemoryPanel />);
    const admin = screen.getByTestId('admin-settings');
    expect(admin.parentElement).toContainElement(
      screen.getByRole('button', { name: 'com_ui_tars_memory_add' }),
    );
  });

  it('keeps admin settings reachable when memory is turned off for everyone', () => {
    mockRole = 'ADMIN';
    mockDisabled = true;
    mockQuery = { data: [], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    expect(screen.getByTestId('admin-settings')).toBeInTheDocument();
    expect(screen.queryByText('com_ui_tars_memory_intro')).toBeNull();
  });

  it('hides the switch and the edit actions from a role without them', () => {
    mockAccess = false;
    render(<TarsMemoryPanel />);
    expect(screen.queryByTestId('tars-memory-mode')).toBeNull();
    expect(screen.queryByRole('button', { name: 'com_ui_edit_memory' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'com_ui_tars_memory_add' })).toBeNull();
  });

  it('filters by content', () => {
    render(<TarsMemoryPanel />);
    fireEvent.change(screen.getByLabelText('com_ui_memories_filter'), {
      target: { value: '品質' },
    });
    expect(screen.getByText('常查詢品質異常流程')).toBeInTheDocument();
    expect(screen.queryByText('偏好繁體中文')).toBeNull();
  });

  it('explains the empty state', () => {
    mockQuery = { data: [], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    expect(screen.getByText('com_ui_tars_memory_empty_title')).toBeInTheDocument();
  });

  it('offers a retry when the list cannot load', () => {
    mockQuery = { data: undefined, isLoading: false, isError: true };
    render(<TarsMemoryPanel />);
    expect(screen.getByText('com_ui_tars_memory_error_load_title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('edits one preference and saves the whole profile', async () => {
    mockQuery = { data: [profile], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: 'com_ui_edit_memory' })[1]);

    const field = await screen.findByRole('textbox', {
      name: 'com_ui_tars_memory_content',
    });
    expect(field).toHaveValue('回答要簡潔');
    expect(screen.getByText('com_ui_tars_memory_edit_notice_profile')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '回答要完整' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockUpdate).toHaveBeenCalledWith(
      { id: '10', content: '偏好繁體中文\n回答要完整' },
      expect.any(Object),
    );
  });

  it('refuses emptying one preference while others remain', async () => {
    mockQuery = { data: [profile], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: 'com_ui_edit_memory' })[0]);
    const field = await screen.findByRole('textbox', {
      name: 'com_ui_tars_memory_content',
    });
    fireEvent.change(field, { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: 'com_ui_save' })).toBeDisabled();
  });

  it('deletes one preference by rewriting the rest of the profile', async () => {
    mockQuery = { data: [profile], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getAllByRole('button', { name: 'com_ui_delete_memory' })[0]);
    await screen.findByText('com_ui_tars_memory_delete_confirm');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete' }));
    expect(mockUpdate).toHaveBeenCalledWith(
      { id: '10', content: '回答要簡潔' },
      expect.any(Object),
    );
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes the record with its last preference', async () => {
    const single = { ...profile, items: ['偏好繁體中文'], content: '- 偏好繁體中文' };
    mockQuery = { data: [single], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete_memory' }));
    await screen.findByText('com_ui_tars_memory_delete_confirm');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete' }));
    expect(mockDelete).toHaveBeenCalledWith('10', expect.any(Object));
  });

  it('shows the read-only metadata of a semantic record and refuses an empty save', async () => {
    mockQuery = { data: [semantic], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_edit_memory' }));

    const field = await screen.findByLabelText('com_ui_tars_memory_content');
    expect(screen.getByText('之後可優先整理檢核重點')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'com_ui_save' })).toBeDisabled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('tells the user when a record went stale during an edit', async () => {
    mockQuery = { data: [semantic], isLoading: false, isError: false };
    mockUpdate.mockImplementation((_vars, { onError }) => onError({ response: { status: 404 } }));
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_edit_memory' }));
    await screen.findByLabelText('com_ui_tars_memory_content');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_memory_error_stale',
      status: 'error',
    });
  });

  it('deletes after confirming', async () => {
    mockQuery = { data: [semantic], isLoading: false, isError: false };
    render(<TarsMemoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete_memory' }));
    expect(await screen.findByText('com_ui_tars_memory_delete_confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete' }));
    expect(mockDelete).toHaveBeenCalledWith('20', expect.any(Object));
  });
});
