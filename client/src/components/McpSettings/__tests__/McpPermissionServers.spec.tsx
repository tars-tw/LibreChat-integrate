import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TTarsMcpServer, TTarsMcpPermissionPrincipal } from 'librechat-data-provider';
import McpPermissionServers from '../McpPermissionServers';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const servers = [
  { id: 's1', name: 'Github-repo', code: 'github', type: 'custom_api', is_enabled: true },
  { id: 's2', name: 'Redmine', type: 'openapi', is_enabled: true, tool_count: 3 },
  { id: 's3', name: 'Builtin', type: 'builtin', is_enabled: true },
] as TTarsMcpServer[];

const principal = (
  overrides: Partial<TTarsMcpPermissionPrincipal> &
    Pick<TTarsMcpPermissionPrincipal, 'principal_type' | 'principal_id' | 'name'>,
): TTarsMcpPermissionPrincipal => ({
  email: null,
  is_active: true,
  mcp_server_ids: [],
  server_count: 0,
  ...overrides,
});

const principals = [
  principal({
    principal_type: 'group',
    principal_id: 'g1',
    name: 'BOSS專用',
    mcp_server_ids: ['s1'],
  }),
  principal({
    principal_type: 'user',
    principal_id: 'u1',
    name: 'Amy',
    email: 'amy@x',
    mcp_server_ids: ['s1', 's2'],
  }),
  principal({
    principal_type: 'user',
    principal_id: 'u2',
    name: 'Bob',
    is_active: false,
    mcp_server_ids: ['s1'],
  }),
];

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

const onAssign = jest.fn();

const renderOverview = (loading = false) =>
  render(
    <McpPermissionServers
      servers={servers}
      principals={principals}
      principalsLoading={loading}
      onAssign={onAssign}
    />,
  );

describe('McpPermissionServers', () => {
  it('counts the users and groups granted each managed server', () => {
    renderOverview();

    expect(screen.queryByText('Builtin')).toBeNull();
    const github = within(rowOf('Github-repo'));
    expect(
      github.getByRole('button', { name: 'com_ui_tars_mcp_server_users_title' }),
    ).toHaveTextContent('2');
    expect(
      github.getByRole('button', { name: 'com_ui_tars_mcp_server_groups_title' }),
    ).toHaveTextContent('1');

    const redmine = within(rowOf('Redmine'));
    expect(
      redmine.getByRole('button', { name: 'com_ui_tars_mcp_server_users_title' }),
    ).toHaveTextContent('1');
    expect(
      redmine.queryByRole('button', { name: 'com_ui_tars_mcp_server_groups_title' }),
    ).toBeNull();
    expect(redmine.getByText('0')).toBeInTheDocument();
  });

  it('lists who holds a server, marking disabled accounts', () => {
    renderOverview();

    fireEvent.click(
      within(rowOf('Github-repo')).getByRole('button', {
        name: 'com_ui_tars_mcp_server_users_title',
      }),
    );

    const list = screen.getByRole('list');
    expect(within(list).getByText('Amy')).toBeInTheDocument();
    expect(within(list).getByText('amy@x')).toBeInTheDocument();
    expect(within(list).getByText('Bob')).toBeInTheDocument();
    expect(within(list).getAllByText('com_ui_tars_mcp_disabled')).toHaveLength(1);
    expect(within(list).queryByText('BOSS專用')).toBeNull();
  });

  it('filters servers by name or code', () => {
    renderOverview();

    fireEvent.change(screen.getByLabelText('com_ui_tars_mcp_search'), {
      target: { value: 'GITHUB' },
    });

    expect(screen.getByText('Github-repo')).toBeInTheDocument();
    expect(screen.queryByText('Redmine')).toBeNull();

    fireEvent.change(screen.getByLabelText('com_ui_tars_mcp_search'), {
      target: { value: 'nothing' },
    });

    expect(screen.getByText('com_ui_tars_mcp_empty')).toBeInTheDocument();
  });

  it('holds the counts while the principals are loading', () => {
    renderOverview(true);

    expect(
      within(rowOf('Github-repo')).queryByRole('button', {
        name: 'com_ui_tars_mcp_server_users_title',
      }),
    ).toBeNull();
  });

  it('opens the server-side assignment of the clicked row', () => {
    renderOverview();

    fireEvent.click(
      within(rowOf('Redmine')).getByRole('button', {
        name: 'com_ui_tars_mcp_assign_server_title',
      }),
    );

    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign).toHaveBeenCalledWith(servers[1]);
  });
});
