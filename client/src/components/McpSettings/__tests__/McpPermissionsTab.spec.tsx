import React from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
  useTarsMcpPermissionsQuery: (principal: { type: string; id: string } | null) =>
    mockPermissionsQuery(principal),
  useSaveTarsMcpPermissionsMutation: () => ({ mutate: mockSave, isLoading: false }),
  useDeleteTarsMcpPermissionsMutation: () => ({ mutate: mockDelete, isLoading: false }),
}));

/** Stands in for the directory combobox: one press adds whatever the test queued up. */
jest.mock('~/components/Sharing/PeoplePicker/DirectoryPeoplePicker', () => ({
  __esModule: true,
  default: ({ onAddPeople }: { onAddPeople: (people: TPrincipal[]) => void }) => (
    <button type="button" data-testid="pick-people" onClick={() => onAddPeople(mockPicked)} />
  ),
}));

const pick = (...people: TPrincipal[]) => {
  mockPicked = people;
  fireEvent.click(screen.getByTestId('pick-people'));
};

const serverCheckbox = (name: string) => screen.getByRole('checkbox', { name });

beforeEach(() => {
  jest.clearAllMocks();
  mockPicked = [];
  mockPrincipals = [];
  mockPermissionsQuery.mockImplementation((principal: { id: string } | null) => ({
    data: principal ? (savedRows[principal.id] ?? []) : undefined,
    isFetching: false,
  }));
});

describe('McpPermissionsTab', () => {
  it("loads a single target's saved grants into the tree", () => {
    render(<McpPermissionsTab />);
    pick(amy);

    expect(mockPermissionsQuery).toHaveBeenLastCalledWith({ type: 'user', id: 'u1' });
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
    expect(serverCheckbox('Redmine')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('com_ui_tars_mcp_all_tools')).toBeInTheDocument();
  });

  it('saves every picked user and group with the checked servers', () => {
    render(<McpPermissionsTab />);
    pick(amy, boss);

    expect(screen.getByText('com_ui_tars_mcp_multi_principal_warning')).toBeInTheDocument();
    expect(mockPermissionsQuery).toHaveBeenLastCalledWith(null);

    fireEvent.click(serverCheckbox('Redmine'));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockSave).toHaveBeenCalledWith({
      user_ids: ['u1'],
      user_group_ids: ['g1'],
      servers: [{ mcp_server_id: 's2', mcp_tool_ids: [] }],
    });
  });

  it('refuses to save without a user or group', () => {
    render(<McpPermissionsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_mcp_principal_required',
      status: 'error',
    });
  });

  it('clears the tree once the last target is removed', () => {
    render(<McpPermissionsTab />);
    pick(amy);
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: /com_ui_remove_user/ }));

    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'false');
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

    expect(mockPermissionsQuery).toHaveBeenLastCalledWith({ type: 'user', id: 'u1' });
    expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('com_ui_tars_mcp_principal_editing')).toBeInTheDocument();
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
    const save = () => fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    it('checks only the clicked tool on an unchecked server', () => {
      render(<McpPermissionsTab />);
      pick(bob);
      expandGithub();

      fireEvent.click(toolCheckbox('list_repos'));

      expect(toolCheckbox('list_repos')).toHaveAttribute('aria-checked', 'true');
      expect(toolCheckbox('get_file')).toHaveAttribute('aria-checked', 'false');
      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');
      expect(screen.getByText('com_ui_tars_mcp_tools_selected')).toBeInTheDocument();
      save();
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ servers: [{ mcp_server_id: 's1', mcp_tool_ids: ['t-list'] }] }),
      );
    });

    it('keeps the other tools when one is unchecked from a whole server', () => {
      render(<McpPermissionsTab />);
      pick(amy);
      expandGithub();

      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(toolCheckbox('get_file'));

      expect(toolCheckbox('list_repos')).toHaveAttribute('aria-checked', 'true');
      expect(toolCheckbox('get_file')).toHaveAttribute('aria-checked', 'false');
      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'mixed');
      save();
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ servers: [{ mcp_server_id: 's1', mcp_tool_ids: ['t-list'] }] }),
      );
    });

    it('becomes the whole server once every tool is checked one by one', () => {
      render(<McpPermissionsTab />);
      pick(bob);
      expandGithub();

      fireEvent.click(toolCheckbox('list_repos'));
      fireEvent.click(toolCheckbox('get_file'));

      expect(screen.getByText('com_ui_tars_mcp_all_tools')).toBeInTheDocument();
      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
      save();
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ servers: [{ mcp_server_id: 's1', mcp_tool_ids: [] }] }),
      );
    });

    it('unchecks the server when its last tool is unchecked', () => {
      render(<McpPermissionsTab />);
      pick(bob);
      expandGithub();

      fireEvent.click(toolCheckbox('list_repos'));
      fireEvent.click(toolCheckbox('list_repos'));

      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'false');
    });

    it('selects the whole server when a half-selected server is clicked', () => {
      render(<McpPermissionsTab />);
      pick(bob);
      expandGithub();
      fireEvent.click(toolCheckbox('list_repos'));

      fireEvent.click(serverCheckbox('Github-repo'));

      expect(serverCheckbox('Github-repo')).toHaveAttribute('aria-checked', 'true');
      expect(toolCheckbox('get_file')).toHaveAttribute('aria-checked', 'true');
    });
  });
});
