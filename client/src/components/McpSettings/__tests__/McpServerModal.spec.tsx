import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TTarsMcpServer } from 'librechat-data-provider';
import McpServerModal from '../McpServerModal';

const mockUpdate = jest.fn();
const mockSync = jest.fn();
const mockShowToast = jest.fn();
let mockStartupConfig: { serverDomain: string } | undefined;
let pointerX = 0;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: { field?: string }) =>
    values?.field ? `${key}:${values.field}` : key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => {
  const idle = { mutateAsync: jest.fn(), isLoading: false };
  return {
    useGetStartupConfig: () => ({ data: mockStartupConfig }),
    useSyncTarsMcpServerMutation: () => ({ mutateAsync: mockSync, isLoading: false }),
    useUpdateTarsMcpServerMutation: () => ({ mutateAsync: mockUpdate, isLoading: false }),
    useCreateTarsMcpServerMutation: () => idle,
    useParseTarsMcpOpenapiMutation: () => idle,
  };
});

const server = (auth: Record<string, unknown> = {}): TTarsMcpServer =>
  ({
    id: 's1',
    name: 'Issues',
    code: 'issues',
    type: 'external',
    is_enabled: true,
    connection_config: {
      transport: 'streamable_http',
      url: 'https://mcp.example.com/mcp',
      auth: {
        type: 'oidc',
        issuer: 'https://idp.example.com',
        client_id: 'librechat',
        scope: 'openid offline_access',
        has_client_secret: true,
        ...auth,
      },
    },
  }) as unknown as TTarsMcpServer;

const renderModal = (target = server()) => {
  render(<McpServerModal server={target} open onOpenChange={jest.fn()} />);
  const tab = screen
    .getAllByRole('tab')
    .find((item) => item.getAttribute('id')?.endsWith('connection'));
  fireEvent.mouseDown(tab as HTMLElement);
};

const pick = async (dropdown: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: dropdown }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

describe('McpServerModal OIDC', () => {
  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue({ server: { id: 's1' } });
    mockSync.mockReset();
    mockShowToast.mockReset();
    mockStartupConfig = { serverDomain: 'https://chat.example.com/' };
  });

  it('shows the redirect URI the backend will send, built from the server domain', () => {
    renderModal();
    expect(
      screen.getByText('https://chat.example.com/api/mcp/tars_issues/oauth/callback'),
    ).toBeInTheDocument();
  });

  it('shows no redirect URI until the server domain is known', () => {
    mockStartupConfig = undefined;
    renderModal();
    expect(screen.queryByText(/oauth\/callback/)).not.toBeInTheDocument();
  });

  it('never fills in the stored secret, and saves a blank one to keep it', async () => {
    renderModal();
    const secret = screen.getByLabelText('com_ui_tars_mcp_oidc_client_secret');
    expect(secret).toHaveValue('');
    expect(secret).toHaveAttribute('placeholder', 'com_ui_tars_mcp_oidc_secret_kept');

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0].data.connection_config.auth).toEqual({
      type: 'oidc',
      issuer: 'https://idp.example.com',
      client_id: 'librechat',
      client_secret: '',
      scope: 'openid offline_access',
      audience: '',
    });
  });

  it('skips the tool sync, which pwc_tars cannot do for an OIDC server', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_tars_mcp_oidc_saved',
        status: 'success',
      }),
    );
    expect(mockSync).not.toHaveBeenCalled();
  });

  it.each([
    ['com_ui_tars_mcp_oidc_issuer', 'com_ui_tars_mcp_oidc_issuer_help'],
    ['com_ui_tars_mcp_oidc_client_secret', 'com_ui_tars_mcp_oidc_client_secret_help'],
    ['com_ui_tars_mcp_oidc_scope', 'com_ui_tars_mcp_oidc_scope_help'],
    ['com_ui_tars_mcp_oidc_audience', 'com_ui_tars_mcp_oidc_audience_help'],
  ])('explains %s from a focusable help button without losing its label', async (label, help) => {
    renderModal();

    expect(screen.getByLabelText(label)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: `com_ui_tars_mcp_oidc_field_help:${label}` });
    expect(button).toHaveAttribute('type', 'button');
    /** Ariakit ignores a move without a position change unless NODE_ENV is `test`; CI runs `development`. */
    pointerX += 1;
    fireEvent.mouseEnter(button);
    fireEvent.mouseMove(button, { screenX: pointerX });

    expect(await screen.findByText(help)).toBeInTheDocument();
  });

  it('adds no help button to the client ID', () => {
    renderModal();

    expect(
      screen.queryByRole('button', {
        name: 'com_ui_tars_mcp_oidc_field_help:com_ui_tars_mcp_oidc_client_id',
      }),
    ).not.toBeInTheDocument();
  });

  it('refuses to save without an issuer or client ID', () => {
    renderModal(server({ issuer: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_mcp_oidc_required',
      status: 'error',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('clears the OIDC choice when the transport leaves streamable_http, so the save syncs', async () => {
    mockSync.mockResolvedValue({ result: {} });
    renderModal();
    await pick('com_ui_tars_mcp_transport', 'com_ui_tars_mcp_transport_stdio');
    fireEvent.change(screen.getByLabelText('com_ui_tars_mcp_command'), {
      target: { value: 'npx' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('s1'));
    expect(mockUpdate.mock.calls[0][0].data.connection_config).not.toHaveProperty('auth');
    expect(mockShowToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_tars_mcp_oidc_saved' }),
    );
  });

  it('ignores the hidden headers field when OIDC is selected', async () => {
    renderModal(server({ type: 'bearer' }));
    fireEvent.change(screen.getByLabelText('com_ui_tars_mcp_headers_json'), {
      target: { value: '{not json' },
    });
    await pick('com_ui_tars_mcp_auth', 'com_ui_tars_mcp_auth_oidc');
    expect(screen.queryByLabelText('com_ui_tars_mcp_headers_json')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0].data.connection_config).not.toHaveProperty('headers');
  });

  it('still refuses invalid headers JSON on a server without OIDC', () => {
    renderModal(server({ type: 'bearer' }));
    fireEvent.change(screen.getByLabelText('com_ui_tars_mcp_headers_json'), {
      target: { value: '{not json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_mcp_invalid_json',
      status: 'error',
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
