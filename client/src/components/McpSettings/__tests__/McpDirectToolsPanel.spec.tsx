import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TTarsMcpDirectTool, TTarsMcpDirectToolsStatus } from 'librechat-data-provider';
import McpDirectToolsPanel from '../McpDirectToolsPanel';

const mockMutate = jest.fn();
let mockTools: TTarsMcpDirectTool[] = [];
let mockLoading = false;
let mockStatus: TTarsMcpDirectToolsStatus = 'ok';
let mockRequestFailed = false;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: { name?: string }) =>
    values?.name ? `${key}:${values.name}` : key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/data-provider', () => ({
  useTarsMcpDirectToolsQuery: () => ({
    data: mockRequestFailed ? undefined : { tools: mockTools, tools_status: mockStatus },
    isLoading: mockLoading,
    isError: mockRequestFailed,
  }),
  useUpdateTarsMcpDirectToolsMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

const toolSwitch = (name: string) =>
  screen.getByRole('switch', { name: `com_ui_tars_mcp_tool_enabled:${name}` });

describe('McpDirectToolsPanel', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockLoading = false;
    mockStatus = 'ok';
    mockRequestFailed = false;
    mockTools = [
      { name: 'health', description: 'Up?', is_enabled: true },
      { name: 'get_user_id', is_enabled: false },
    ];
  });

  it('adds a tool to the allow-list and keeps the ones already open', () => {
    render(<McpDirectToolsPanel serverId="s1" />);
    fireEvent.click(toolSwitch('get_user_id'));

    expect(mockMutate).toHaveBeenCalledWith(['health', 'get_user_id']);
  });

  it('removes a tool from the allow-list when it is turned off', () => {
    render(<McpDirectToolsPanel serverId="s1" />);
    fireEvent.click(toolSwitch('health'));

    expect(mockMutate).toHaveBeenCalledWith([]);
  });

  it('explains how to get the list when there are no tools yet', () => {
    mockTools = [];
    render(<McpDirectToolsPanel serverId="s1" />);

    expect(screen.getByText('com_ui_tars_mcp_oidc_admin_tools_hint')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it.each([
    ['timeout', 'com_ui_tars_mcp_oidc_tools_timeout'],
    ['error', 'com_ui_tars_mcp_oidc_tools_error'],
  ] as const)('explains a %s, and keeps the tools it can still list', (status, key) => {
    mockStatus = status;
    render(<McpDirectToolsPanel serverId="s1" />);

    expect(screen.getByRole('status')).toHaveTextContent(key);
    expect(toolSwitch('health')).toBeInTheDocument();
  });

  it('explains a request that failed outright instead of showing an empty list', () => {
    mockRequestFailed = true;
    render(<McpDirectToolsPanel serverId="s1" />);

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_tars_mcp_oidc_tools_error');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('adds no notice when nothing went wrong', () => {
    mockStatus = 'not_connected';
    mockTools = [];
    render(<McpDirectToolsPanel serverId="s1" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a spinner instead of the hint while loading', () => {
    mockLoading = true;
    render(<McpDirectToolsPanel serverId="s1" />);

    expect(screen.queryByText('com_ui_tars_mcp_oidc_admin_tools_hint')).not.toBeInTheDocument();
  });
});
