import React from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TPrincipal, TTarsMcpServer, TTarsMcpServerPermission } from 'librechat-data-provider';
import McpServerAssignModal from '../McpServerAssignModal';

const mockSave = jest.fn();
const mockShowToast = jest.fn();
let mockSaveOptions: { onSuccess?: () => void } = {};
let mockAssignees: TTarsMcpServerPermission[] | undefined;
let mockPicked: TPrincipal[] = [];
let mockExcludeIds: (string | undefined)[] = [];

const server = {
  id: 's1',
  name: 'Github-repo',
  type: 'external',
  is_enabled: true,
  tool_count: 3,
} as TTarsMcpServer;

const tools = [
  { id: 't-list', mcp_server_id: 's1', name: 'list_repos', is_enabled: true },
  { id: 't-file', mcp_server_id: 's1', name: 'get_file', is_enabled: true },
  { id: 't-issue', mcp_server_id: 's1', name: 'create_issue', is_enabled: true },
];

const assignee = (
  overrides: Partial<TTarsMcpServerPermission> &
    Pick<TTarsMcpServerPermission, 'principal_type' | 'principal_id' | 'name'>,
): TTarsMcpServerPermission => ({
  email: null,
  is_active: true,
  mcp_tool_ids: [],
  is_enabled: true,
  ...overrides,
});

const saved = () => [
  assignee({ principal_type: 'group', principal_id: 'g1', name: 'BOSS' }),
  assignee({ principal_type: 'user', principal_id: 'u1', name: 'Amy', email: 'amy@x' }),
  assignee({ principal_type: 'user', principal_id: 'u2', name: 'Bob', mcp_tool_ids: ['t-list'] }),
  assignee({
    principal_type: 'user',
    principal_id: 'u3',
    name: 'Old',
    is_active: false,
    mcp_tool_ids: ['t-file'],
  }),
];

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useTarsMcpServerPermissionsQuery: () => ({ data: mockAssignees, isLoading: !mockAssignees }),
  useTarsMcpServerQuery: () => ({ data: { ...server, tools }, isLoading: false }),
  useSaveTarsMcpServerPermissionsMutation: (options: { onSuccess?: () => void }) => {
    mockSaveOptions = options;
    return { mutate: mockSave, isLoading: false };
  },
}));

/** Stands in for the directory combobox: one press adds whatever the test queued up. */
jest.mock('~/components/Sharing/PeoplePicker/DirectoryPeoplePicker', () => ({
  __esModule: true,
  default: ({
    onAddPeople,
    onPendingChange,
    excludeIds,
  }: {
    onAddPeople: (people: TPrincipal[]) => void;
    onPendingChange?: (people: TPrincipal[]) => void;
    excludeIds: (string | undefined)[];
  }) => {
    mockExcludeIds = excludeIds;
    return (
      <>
        <button type="button" data-testid="pick-people" onClick={() => onAddPeople(mockPicked)} />
        <button
          type="button"
          data-testid="check-people"
          onClick={() => onPendingChange?.(mockPicked)}
        />
      </>
    );
  },
}));

const onClose = jest.fn();
const renderModal = () => render(<McpServerAssignModal server={server} onClose={onClose} />);

const removeButtons = () => screen.getAllByRole('button', { name: /^com_ui_tars_mcp_unassign / });
const listedNames = () =>
  removeButtons().map((button) => button.getAttribute('aria-label')?.split(' ').slice(1).join(' '));
const expand = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `com_ui_tars_mcp_toggle_tools ${name}` }));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
const savedPrincipals = () =>
  (mockSave.mock.calls[0][0] as { principals: Array<{ principal_id: string }> }).principals;
const savedScopeOf = (id: string) =>
  (savedPrincipals() as Array<{ principal_id: string; mcp_tool_ids: string[] }>).find(
    (entry) => entry.principal_id === id,
  )?.mcp_tool_ids;

beforeEach(() => {
  jest.clearAllMocks();
  mockAssignees = saved();
  mockPicked = [];
});

describe('McpServerAssignModal', () => {
  it('lists users before groups with their tool scope and status', () => {
    renderModal();

    expect(screen.getByText('com_ui_tars_mcp_assign_server_title')).toBeInTheDocument();
    expect(listedNames()).toEqual(['Amy', 'Bob', 'Old', 'BOSS']);
    expect(screen.getAllByText('com_ui_tars_mcp_all_tools')).toHaveLength(2);
    expect(screen.getAllByText('com_ui_tars_mcp_tools_selected')).toHaveLength(2);
    expect(screen.getByText('com_ui_tars_mcp_disabled')).toBeInTheDocument();
  });

  it('only lets a disabled assignee be removed, and keeps it as it is otherwise', () => {
    renderModal();

    expect(screen.queryByRole('button', { name: 'com_ui_tars_mcp_toggle_tools Old' })).toBeNull();
    save();

    expect(mockSave).toHaveBeenCalledWith({
      mcp_server_id: 's1',
      principals: expect.arrayContaining([
        { principal_type: 'user', principal_id: 'u3', mcp_tool_ids: ['t-file'] },
      ]),
    });
  });

  it('adds directory picks with the whole server, never one already assigned', () => {
    renderModal();
    expect(mockExcludeIds).toEqual(expect.arrayContaining(['g1', 'u1', 'u2', 'u3']));

    mockPicked = [
      { type: PrincipalType.USER, name: 'Cathy', source: 'tars', idOnTheSource: 'u9' },
      { type: PrincipalType.GROUP, name: 'BOSS', source: 'tars', idOnTheSource: 'g1' },
    ];
    fireEvent.click(screen.getByTestId('pick-people'));

    expect(listedNames()).toEqual(['Amy', 'Bob', 'Cathy', 'Old', 'BOSS']);
    save();
    expect(savedPrincipals()).toHaveLength(5);
    expect(savedScopeOf('u9')).toEqual([]);
  });

  it('saves picks still waiting in the picker, as if Add had been pressed', () => {
    renderModal();
    mockPicked = [
      { type: PrincipalType.USER, name: '1234567890', source: 'tars', idOnTheSource: 'u9' },
      { type: PrincipalType.GROUP, name: 'BOSS專用', source: 'tars', idOnTheSource: 'g7' },
    ];
    fireEvent.click(screen.getByTestId('check-people'));

    expect(listedNames()).toEqual(['Amy', 'Bob', 'Old', 'BOSS']);
    save();

    expect(savedPrincipals()).toHaveLength(6);
    expect(savedScopeOf('u9')).toEqual([]);
    expect(savedScopeOf('g7')).toEqual([]);
  });

  it('does not save a pick twice once it has been added', () => {
    renderModal();
    mockPicked = [{ type: PrincipalType.USER, name: 'Cathy', source: 'tars', idOnTheSource: 'u9' }];
    fireEvent.click(screen.getByTestId('check-people'));
    fireEvent.click(screen.getByTestId('pick-people'));
    save();

    expect(savedPrincipals().filter((entry) => entry.principal_id === 'u9')).toHaveLength(1);
  });

  it('narrows a whole-server assignee to the tools left checked', () => {
    renderModal();
    expand('Amy');

    fireEvent.click(screen.getByRole('checkbox', { name: 'get_file' }));
    save();

    expect(savedScopeOf('u1')?.slice().sort()).toEqual(['t-issue', 't-list']);
  });

  it('keeps the last tool, and widens back to the whole server on request', () => {
    renderModal();
    expand('Bob');

    expect(screen.getByRole('checkbox', { name: 'list_repos' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'get_file' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_mcp_use_all_tools' }));
    save();

    expect(savedScopeOf('u2')).toEqual([]);
  });

  it('collapses back to the whole server once every tool is checked', () => {
    renderModal();
    expand('Bob');

    fireEvent.click(screen.getByRole('checkbox', { name: 'get_file' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'create_issue' }));
    save();

    expect(savedScopeOf('u2')).toEqual([]);
  });

  it('drops a removed assignee from the save', () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_mcp_unassign BOSS' }));
    save();

    expect(savedPrincipals().map((entry) => entry.principal_id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('closes once the save succeeds', () => {
    renderModal();
    save();

    act(() => mockSaveOptions.onSuccess?.());

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_mcp_permissions_saved',
      status: 'success',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('waits for the saved assignees before allowing a save', () => {
    mockAssignees = undefined;
    renderModal();

    expect(screen.getByRole('button', { name: 'com_ui_save' })).toBeDisabled();
    expect(screen.queryByText('com_ui_tars_mcp_assigned_empty')).toBeNull();
  });

  it('shows an empty assignment as such', () => {
    mockAssignees = [];
    renderModal();

    expect(screen.getByText('com_ui_tars_mcp_assigned_empty')).toBeInTheDocument();
    save();
    expect(mockSave).toHaveBeenCalledWith({ mcp_server_id: 's1', principals: [] });
  });
});
