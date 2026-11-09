import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TTarsMcpUserServer } from 'librechat-data-provider';
import McpUserToolsTab from '../McpUserToolsTab';

const mockSave = jest.fn();
const mockUpdate = jest.fn();
let mockServers: TTarsMcpUserServer[] = [];

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/data-provider', () => ({
  useTarsMcpUserSettingsQuery: () => ({ data: mockServers, isLoading: false }),
  useUpdateTarsMcpUserServerMutation: () => ({ mutate: mockUpdate, isLoading: false }),
  useClearTarsMcpUserCredentialsMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useSaveTarsMcpUserCredentialsMutation: (options: { onSuccess: () => void }) => ({
    mutate: (input: unknown) => {
      mockSave(input);
      options.onSuccess();
    },
    isLoading: false,
  }),
}));

const server = (overrides: Partial<TTarsMcpUserServer>): TTarsMcpUserServer => ({
  id: 's1',
  name: 'Github-repo',
  type: 'external',
  is_enabled: true,
  user_enabled: false,
  requires_user_credentials: true,
  has_credentials: false,
  auth_type: 'bearer',
  login_fields: [],
  tools: [],
  ...overrides,
});

const serverSwitch = () => screen.getByRole('switch', { name: 'Github-repo com_ui_active' });

const saveCredentials = (chip: string) => {
  fireEvent.click(screen.getByRole('button', { name: chip }));
  const token = document.querySelector('input[type="password"]') as HTMLInputElement;
  fireEvent.change(token, { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_mcp_creds_save' }));
};

describe('McpUserToolsTab', () => {
  beforeEach(() => {
    mockSave.mockClear();
    mockUpdate.mockClear();
  });

  it('shows a server missing credentials as off and locks its switch, even when opted in', () => {
    mockServers = [server({ user_enabled: true })];
    render(<McpUserToolsTab />);

    expect(serverSwitch()).not.toBeChecked();
    expect(serverSwitch()).toBeDisabled();

    fireEvent.click(serverSwitch());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('leaves the switch free once the credentials are set', () => {
    mockServers = [server({ user_enabled: true, has_credentials: true })];
    render(<McpUserToolsTab />);

    expect(serverSwitch()).toBeChecked();
    expect(serverSwitch()).toBeEnabled();

    fireEvent.click(serverSwitch());
    expect(mockUpdate).toHaveBeenCalledWith({ id: 's1', data: { is_enabled: false } });
  });

  it('leaves the switch free on a server that needs no credentials', () => {
    mockServers = [server({ requires_user_credentials: false })];
    render(<McpUserToolsTab />);

    expect(serverSwitch()).toBeEnabled();
    fireEvent.click(serverSwitch());
    expect(mockUpdate).toHaveBeenCalledWith({ id: 's1', data: { is_enabled: true } });
  });

  it('turns the server on after its first credentials are saved', () => {
    mockServers = [server({})];
    render(<McpUserToolsTab />);

    saveCredentials('com_ui_tars_mcp_creds_needed');

    expect(mockSave).toHaveBeenCalledWith({ id: 's1', credentials: { value: 'secret' } });
    expect(mockUpdate).toHaveBeenCalledWith({ id: 's1', data: { is_enabled: true } });
  });

  it('writes nothing extra when the stored preference is already on', () => {
    mockServers = [server({ user_enabled: true })];
    render(<McpUserToolsTab />);

    saveCredentials('com_ui_tars_mcp_creds_needed');

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps a server off when existing credentials are only updated', () => {
    mockServers = [server({ has_credentials: true })];
    render(<McpUserToolsTab />);

    saveCredentials('com_ui_tars_mcp_creds_set');

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('explains sign-in instead of an empty tool list on an OIDC server', () => {
    mockServers = [server({ auth_type: 'oidc', user_enabled: true })];
    render(<McpUserToolsTab />);

    expect(screen.queryByText('com_ui_tars_mcp_server_tool_count')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('com_ui_tars_mcp_oidc_user_hint')).toBeInTheDocument();
  });

  it.each([
    ['timeout', 'com_ui_tars_mcp_oidc_tools_timeout'],
    ['error', 'com_ui_tars_mcp_oidc_tools_error'],
    ['none_opened', 'com_ui_tars_mcp_oidc_tools_none_opened'],
    ['not_connected', 'com_ui_tars_mcp_oidc_user_hint'],
  ] as const)('explains an empty OIDC list when the status is %s', (tools_status, key) => {
    mockServers = [server({ auth_type: 'oidc', user_enabled: true, tools_status })];
    render(<McpUserToolsTab />);

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(key)).toBeInTheDocument();
  });

  it("lets the user switch an OIDC server's tools one by one", () => {
    mockServers = [
      server({
        auth_type: 'oidc',
        user_enabled: true,
        requires_user_credentials: false,
        tools: [
          { id: 'health', name: 'health', user_enabled: true },
          { id: 'get_user_id', name: 'get_user_id', user_enabled: false },
        ],
      }),
    ];
    render(<McpUserToolsTab />);

    expect(screen.getByText('com_ui_tars_mcp_server_tool_count')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByText('com_ui_tars_mcp_oidc_user_hint')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'get_user_id' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      id: 's1',
      data: { tool_config: { health: true, get_user_id: true } },
    });
  });
});
