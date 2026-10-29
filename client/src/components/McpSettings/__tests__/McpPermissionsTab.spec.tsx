import React from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type {
  TPrincipal,
  TTarsMcpServer,
  TTarsMcpPermission,
  TTarsMcpPermissionPrincipal,
} from 'librechat-data-provider';
import McpPermissionsTab from '../McpPermissionsTab';

const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockShowToast = jest.fn();
const mockPermissionsQuery = jest.fn();
let mockPrincipals: TTarsMcpPermissionPrincipal[] = [];
let mockPicked: TPrincipal[] = [];

const servers = [
  { id: 's1', name: 'Github-repo', type: 'custom_api', is_enabled: true, tool_count: 2 },
  { id: 's2', name: 'Redmine', type: 'openapi', is_enabled: true, tool_count: 3 },
] as TTarsMcpServer[];

const githubTools = [
  { id: 't-list', mcp_server_id: 's1', name: 'list_repos', is_enabled: true },
  { id: 't-file', mcp_server_id: 's1', name: 'get_file', is_enabled: true },
];

const savedRows: Record<string, TTarsMcpPermission[]> = {
  u1: [{ id: 'p1', user_id: 'u1', mcp_server_id: 's1', mcp_tool_ids: [], is_enabled: true }],
};

const amy: TPrincipal = {
  type: PrincipalType.USER,
  name: 'Amy',
  email: 'amy@x',
  source: 'tars',
  idOnTheSource: 'u1',
};
const bob: TPrincipal = {
  type: PrincipalType.USER,
  name: 'Bob',
  source: 'tars',
  idOnTheSource: 'u2',
};
const boss: TPrincipal = {
  type: PrincipalType.GROUP,
  name: 'BOSS專用',
  source: 'tars',
  idOnTheSource: 'g1',
  memberCount: 7,
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useTarsMcpServersQuery: () => ({ data: servers, isLoading: false }),
  useTarsMcpServerQuery: (id: string | null) => ({
    data: id === 's1' ? { ...servers[0], tools: githubTools } : undefined,
    isLoading: false,
  }),
  usePrincipalDirectoryQuery: () => ({ data: { enabled: true, users: [], groups: [] } }),
  useTarsMcpPermissionPrincipalsQuery: () => ({ data: mockPrincipals, isLoading: false }),
  useTarsMcpPermissionsQueries: (principals: Array<{ type: string; id: string }>) =>
    mockPermissionsQuery(principals),
  useSaveTarsMcpPermissionsMutation: () => ({ mutateAsync: mockSave }),
  useDeleteTarsMcpPermissionsMutation: () => ({ mutate: mockDelete, isLoading: false }),
  useTarsMcpServerPermissionsQuery: (serverId: string | null) => ({
    data: serverId === 's1' ? [] : undefined,
    isLoading: false,
  }),
  useSaveTarsMcpServerPermissionsMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

/** Stands in for the directory combobox: one press adds (or only checks) what the test queued up. */
jest.mock('~/components/Sharing/PeoplePicker/DirectoryPeoplePicker', () => ({
  __esModule: true,
  default: ({
    onAddPeople,
    onPendingChange,
  }: {
    onAddPeople: (people: TPrincipal[]) => void;
    onPendingChange?: (people: TPrincipal[]) => void;
  }) => (
    <>
      <button type="button" data-testid="pick-people" onClick={() => onAddPeople(mockPicked)} />
      <button
        type="button"
        data-testid="check-people"
        onClick={() => onPendingChange?.(mockPicked)}
      />
    </>
  ),
}));

const pick = (...people: TPrincipal[]) => {
  mockPicked = people;
  fireEvent.click(screen.getByTestId('pick-people'));
};

const serverCheckbox = (name: string) => screen.getByRole('checkbox', { name });

/** Saving awaits every request before it toasts and closes, so the click is flushed in `act`. */
const clickSave = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
  });

const addButton = () => screen.getByRole('button', { name: 'com_ui_tars_mcp_add_permission' });

/** Most cases work inside the dialog that 新增權限 opens. */
const renderOpen = () => {
  render(<McpPermissionsTab />);
  fireEvent.click(addButton());
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPicked = [];
  mockPrincipals = [];
  mockSave.mockResolvedValue({ result: {} });
  mockPermissionsQuery.mockImplementation((principals: Array<{ id: string }>) =>
    principals.map((principal) => ({ data: savedRows[principal.id] ?? [] })),
  );
});

describe('McpPermissionsTab', () => {
  it('keeps the assignment dialog closed until 新增權限 is pressed', () => {
    mockPrincipals = [
      {
        principal_type: 'group',
        principal_id: 'g1',
        name: 'BOSS專用',
        email: null,
        is_active: true,
        mcp_server_ids: ['s1'],
        server_count: 1,
      },
    ];
    render(<McpPermissionsTab />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('pick-people')).toBeNull();
    expect(screen.getByText('BOSS專用')).toBeInTheDocument();

    fireEvent.click(addButton());

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('pick-people')).toBeInTheDocument();
    expect(serverCheckbox('Github-repo')).toBeInTheDocument();
  });

  it('opens the server-side assignment from an overview row, apart from the principal dialog', () => {
    render(<McpPermissionsTab />);

    const [githubAssign] = screen.getAllByRole('button', {
      name: 'com_ui_tars_mcp_assign_server_title',
    });
    fireEvent.click(githubAssign);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('com_ui_tars_mcp_assign_server_title')).toBeInTheDocument();
    expect(within(dialog).getByText('com_ui_tars_mcp_assigned_empty')).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: 'Github-repo' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("loads a single target's saved grants into the tree", () => {
    renderOpen();
    pick(amy);

    expect(mockPermissionsQuery).toHaveBeenLastCalledWith([{ type: 'user', id: 'u1' }]);
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
    expect(serverCheckbox('Redmine')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('com_ui_tars_mcp_all_tools')).toBeInTheDocument();
  });

  it('saves each picked user and group with its own grants plus the checked servers', async () => {
    renderOpen();
    pick(amy, boss);

    expect(screen.getByText('com_ui_tars_mcp_multi_principal_warning')).toBeInTheDocument();
    expect(mockPermissionsQuery).toHaveBeenLastCalledWith([
      { type: 'user', id: 'u1' },
      { type: 'group', id: 'g1' },
    ]);
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');

    fireEvent.click(serverCheckbox('Redmine'));
    await clickSave();

    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave).toHaveBeenCalledWith({
      user_ids: ['u1'],
      user_group_ids: [],
      servers: [
        { mcp_server_id: 's1', mcp_tool_ids: [] },
        { mcp_server_id: 's2', mcp_tool_ids: [] },
      ],
    });
    expect(mockSave).toHaveBeenCalledWith({
      user_ids: [],
      user_group_ids: ['g1'],
      servers: [{ mcp_server_id: 's2', mcp_tool_ids: [] }],
    });
  });

  it('sends targets that end up with the same grants in one request', async () => {
    renderOpen();
    pick(bob, boss);
    fireEvent.click(serverCheckbox('Redmine'));
    await clickSave();

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith({
      user_ids: ['u2'],
      user_group_ids: ['g1'],
      servers: [{ mcp_server_id: 's2', mcp_tool_ids: [] }],
    });
  });

  it('asks for Add before saving picks that were only checked', () => {
    renderOpen();
    pick(amy);
    mockPicked = [bob];
    fireEvent.click(screen.getByTestId('check-people'));

    expect(screen.getByText('com_ui_tars_mcp_pending_picks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_mcp_pending_picks',
      status: 'warning',
    });
  });

  it('refuses to save without a user or group', () => {
    renderOpen();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_mcp_principal_required',
      status: 'error',
    });
  });

  it('keeps tools checked before a target is added', async () => {
    renderOpen();
    fireEvent.click(screen.getByRole('button', { name: /Github-repo/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'list_repos' }));
    pick(bob);

    expect(mockPermissionsQuery).toHaveBeenLastCalledWith([{ type: 'user', id: 'u2' }]);
    expect(screen.getByRole('checkbox', { name: 'list_repos' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');
    await clickSave();
    expect(mockSave).toHaveBeenCalledWith({
      user_ids: ['u2'],
      user_group_ids: [],
      servers: [{ mcp_server_id: 's1', mcp_tool_ids: ['t-list'] }],
    });
  });

  it("takes only a removed target's own grants off the tree", async () => {
    renderOpen();
    pick(amy, bob);
    fireEvent.click(serverCheckbox('Redmine'));
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');

    const [removeAmy] = screen.getAllByRole('button', { name: /com_ui_remove_user/ });
    fireEvent.click(removeAmy);

    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'false');
    expect(serverCheckbox('Redmine')).toHaveAttribute('aria-checked', 'true');
    await clickSave();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith({
      user_ids: ['u2'],
      user_group_ids: [],
      servers: [{ mcp_server_id: 's2', mcp_tool_ids: [] }],
    });
  });

  it('remembers an unchecked server when targets change', () => {
    renderOpen();
    pick(amy);
    fireEvent.click(serverCheckbox('Github-repo'));
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: /com_ui_remove_user/ }));
    pick(amy);

    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'false');
  });

  it("cycles a server the targets hold differently back to each one's own grants", async () => {
    renderOpen();
    pick(amy, bob);
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');

    fireEvent.click(serverCheckbox('Github-repo'));
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(serverCheckbox('Github-repo'));
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(serverCheckbox('Github-repo'));
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');

    await clickSave();
    expect(mockSave).toHaveBeenCalledWith({
      user_ids: ['u1'],
      user_group_ids: [],
      servers: [{ mcp_server_id: 's1', mcp_tool_ids: [] }],
    });
    expect(mockSave).toHaveBeenCalledWith({ user_ids: ['u2'], user_group_ids: [], servers: [] });
  });

  it('edits an assigned principal from its saved grants', () => {
    mockPrincipals = [
      {
        principal_type: 'user',
        principal_id: 'u1',
        name: 'Amy',
        email: 'amy@x',
        is_active: true,
        mcp_server_ids: ['s1'],
        server_count: 1,
      },
    ];
    render(<McpPermissionsTab />);

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_edit Amy' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockPermissionsQuery).toHaveBeenLastCalledWith([{ type: 'user', id: 'u1' }]);
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
  });

  it('drops unsaved edits on cancel, so the next dialog starts empty', () => {
    mockPrincipals = [
      {
        principal_type: 'user',
        principal_id: 'u1',
        name: 'Amy',
        email: 'amy@x',
        is_active: true,
        mcp_server_ids: ['s1'],
        server_count: 1,
      },
    ];
    render(<McpPermissionsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_edit Amy' }));
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Github-repo' })).toBeNull();

    fireEvent.click(addButton());
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('closes the dialog once the save succeeds', async () => {
    renderOpen();
    pick(amy);
    await clickSave();
    expect(mockSave).toHaveBeenCalled();

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_mcp_permissions_saved',
      status: 'success',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('filters the assigned users and groups by name or email', () => {
    mockPrincipals = [
      {
        principal_type: 'user',
        principal_id: 'u1',
        name: 'Amy',
        email: 'amy@pwc.com',
        is_active: true,
        mcp_server_ids: ['s1'],
        server_count: 1,
      },
      {
        principal_type: 'group',
        principal_id: 'g1',
        name: 'BOSS專用',
        email: null,
        is_active: true,
        mcp_server_ids: ['s1'],
        server_count: 1,
      },
    ];
    render(<McpPermissionsTab />);
    const assigned = screen.getByRole('region', { name: 'com_ui_tars_mcp_assigned_title' });
    const search = within(assigned).getByRole('textbox', {
      name: 'com_ui_tars_mcp_assigned_search',
    });

    fireEvent.change(search, { target: { value: 'boss' } });
    expect(within(assigned).getByText('BOSS專用')).toBeInTheDocument();
    expect(within(assigned).queryByText('Amy')).toBeNull();

    fireEvent.change(search, { target: { value: 'PWC.COM' } });
    expect(within(assigned).getByText('Amy')).toBeInTheDocument();
    expect(within(assigned).queryByText('BOSS專用')).toBeNull();

    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(within(assigned).getByText('com_ui_no_results_found')).toBeInTheDocument();
  });

  it('pages a long list of assigned users and groups', () => {
    mockPrincipals = Array.from({ length: 12 }, (_, index) => ({
      principal_type: 'user' as const,
      principal_id: `u-${index + 1}`,
      name: `Member ${String(index + 1).padStart(2, '0')}`,
      email: null,
      is_active: true,
      mcp_server_ids: ['s1'],
      server_count: 1,
    }));
    render(<McpPermissionsTab />);

    expect(screen.getByText('Member 10')).toBeInTheDocument();
    expect(screen.queryByText('Member 11')).not.toBeInTheDocument();

    const nextButtons = screen.getAllByRole('button', { name: 'com_ui_tars_mcp_next_page' });
    fireEvent.click(nextButtons[nextButtons.length - 1]);

    expect(screen.getByText('Member 12')).toBeInTheDocument();
    expect(screen.queryByText('Member 01')).not.toBeInTheDocument();
  });

  describe('assigned list', () => {
    const principal = (
      principal_type: 'user' | 'group',
      principal_id: string,
      name: string,
      server_count: number,
    ) => ({
      principal_type,
      principal_id,
      name,
      email: null,
      is_active: true,
      mcp_server_ids: [],
      server_count,
    });

    /** Names in the assigned table, top to bottom. */
    const assignedNames = () =>
      within(screen.getByRole('region', { name: 'com_ui_tars_mcp_assigned_title' }))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0].textContent);

    beforeEach(() => {
      mockPrincipals = [
        principal('group', 'g1', 'BOSS專用', 1),
        principal('user', 'u1', 'Amy', 3),
        principal('user', 'u2', 'Cathy', 2),
      ];
    });

    it('sorts by a clicked column and reverses on a second click', () => {
      render(<McpPermissionsTab />);
      expect(assignedNames()).toEqual(['BOSS專用', 'Amy', 'Cathy']);

      const header = screen.getByRole('button', { name: 'com_ui_tars_mcp_server_count' });
      fireEvent.click(header);
      expect(assignedNames()).toEqual(['BOSS專用', 'Cathy', 'Amy']);
      expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending');

      fireEvent.click(header);
      expect(assignedNames()).toEqual(['Amy', 'Cathy', 'BOSS專用']);
      expect(header.closest('th')).toHaveAttribute('aria-sort', 'descending');

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_name' }));
      expect(assignedNames()).toEqual(['Amy', 'BOSS專用', 'Cathy']);
    });

    it('colors users and groups apart and uses the shared action tones', () => {
      render(<McpPermissionsTab />);

      const groupRow = screen.getByText('BOSS專用').closest('tr') as HTMLElement;
      const userRow = screen.getByText('Amy').closest('tr') as HTMLElement;
      const groupLabel = within(groupRow).getByText('com_ui_group');
      const userLabel = within(userRow).getByText('com_ui_user');
      expect(groupLabel).toHaveClass('text-text-primary');
      expect(userLabel).toHaveClass('text-text-primary');
      expect(groupLabel.querySelector('svg')).toHaveClass('text-series-5');
      expect(userLabel.querySelector('svg')).toHaveClass('text-series-2');
      expect(within(userRow).getByRole('button', { name: 'com_ui_edit Amy' })).toHaveClass(
        'text-text-secondary',
      );
      expect(
        within(userRow).getByRole('button', { name: 'com_ui_tars_mcp_permission_remove Amy' }),
      ).toHaveClass('text-text-destructive');
    });
  });

  it('only lets a disabled group be removed, after confirming', () => {
    mockPrincipals = [
      {
        principal_type: 'group',
        principal_id: 'g2',
        name: 'TARS_AIS',
        email: null,
        is_active: false,
        mcp_server_ids: ['s1'],
        server_count: 1,
      },
    ];
    render(<McpPermissionsTab />);

    const row = screen.getByText('TARS_AIS').closest('tr') as HTMLElement;
    expect(within(row).getByText('com_ui_tars_mcp_disabled')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'com_ui_edit TARS_AIS' })).toBeNull();

    fireEvent.click(
      within(row).getByRole('button', { name: 'com_ui_tars_mcp_permission_remove TARS_AIS' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete' }));

    expect(mockDelete).toHaveBeenCalledWith({ type: 'group', id: 'g2' });
  });

  describe('picking single tools', () => {
    const expandGithub = () => fireEvent.click(screen.getByRole('button', { name: /Github-repo/ }));
    const toolCheckbox = (name: string) => screen.getByRole('checkbox', { name });

    it('checks only the clicked tool on an unchecked server', async () => {
      renderOpen();
      pick(bob);
      expandGithub();

      fireEvent.click(toolCheckbox('list_repos'));

      expect(toolCheckbox('list_repos')).toHaveAttribute('aria-checked', 'true');
      expect(toolCheckbox('get_file')).toHaveAttribute('aria-checked', 'false');
      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');
      expect(screen.getByText('com_ui_tars_mcp_tools_selected')).toBeInTheDocument();
      await clickSave();
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ servers: [{ mcp_server_id: 's1', mcp_tool_ids: ['t-list'] }] }),
      );
    });

    it('keeps the other tools when one is unchecked from a whole server', async () => {
      renderOpen();
      pick(amy);
      expandGithub();

      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(toolCheckbox('get_file'));

      expect(toolCheckbox('list_repos')).toHaveAttribute('aria-checked', 'true');
      expect(toolCheckbox('get_file')).toHaveAttribute('aria-checked', 'false');
      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');
      await clickSave();
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ servers: [{ mcp_server_id: 's1', mcp_tool_ids: ['t-list'] }] }),
      );
    });

    it('becomes the whole server once every tool is checked one by one', async () => {
      renderOpen();
      pick(bob);
      expandGithub();

      fireEvent.click(toolCheckbox('list_repos'));
      fireEvent.click(toolCheckbox('get_file'));

      expect(screen.getByText('com_ui_tars_mcp_all_tools')).toBeInTheDocument();
      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
      await clickSave();
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ servers: [{ mcp_server_id: 's1', mcp_tool_ids: [] }] }),
      );
    });

    it('unchecks the server when its last tool is unchecked', () => {
      renderOpen();
      pick(bob);
      expandGithub();

      fireEvent.click(toolCheckbox('list_repos'));
      fireEvent.click(toolCheckbox('list_repos'));

      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'false');
    });

    it('selects the whole server when a half-selected server is clicked', () => {
      renderOpen();
      pick(bob);
      expandGithub();
      fireEvent.click(toolCheckbox('list_repos'));

      fireEvent.click(serverCheckbox('Github-repo'));

      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
      expect(toolCheckbox('get_file')).toHaveAttribute('aria-checked', 'true');
    });
  });
});
