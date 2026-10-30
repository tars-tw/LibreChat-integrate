import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrincipalType, ResourceType, TARS_MCP_SHARE_BLOCKED } from 'librechat-data-provider';
import '@testing-library/jest-dom/extend-expect';
import type { TPrincipal } from 'librechat-data-provider';
import GenericGrantAccessDialog from '../GenericGrantAccessDialog';
import translationEn from '~/locales/en/translation.json';

const mockShowToast = jest.fn();
let mockPicked: TPrincipal[] = [];

const mockRefetchPermissions = jest.fn();
const mockUseResourcePermissionState = jest.fn();
const mockUseAuthContext = jest.fn(() => ({ user: { role: 'ADMIN' } }));
const mockUsePeoplePickerPermissions = jest.fn(() => ({
  hasPeoplePickerAccess: true,
  peoplePickerTypeFilter: '' as string | null,
}));
const mockUseCanSharePublic = jest.fn(() => true);
const mockUseGetStartupConfig = jest.fn(() => ({ data: {} as { tarsAuth?: boolean } }));

const config = {
  defaultViewerRoleId: 'viewer',
  defaultOwnerRoleId: 'owner',
  getShareMessage: () => 'Share Agent',
  getResourceUrl: () => 'http://localhost/agent/1',
  getCopyUrlMessage: () => 'Copied',
};

const baseState = (overrides: Record<string, unknown> = {}) => ({
  config,
  permissionsData: { principals: [], public: false },
  isLoadingPermissions: false,
  isFetchingPermissions: false,
  permissionsError: null,
  refetchPermissions: mockRefetchPermissions,
  updatePermissionsMutation: { isLoading: false, mutateAsync: jest.fn() },
  currentShares: [],
  currentIsPublic: false,
  currentPublicRole: 'viewer',
  isPublic: false,
  setIsPublic: jest.fn(),
  publicRole: 'viewer',
  setPublicRole: jest.fn(),
  ...overrides,
});

jest.mock('~/hooks', () => ({
  useAuthContext: () => mockUseAuthContext(),
  useLocalize: () => (key: string) => key,
  useResourcePermissionState: () => mockUseResourcePermissionState(),
  usePeoplePickerPermissions: () => mockUsePeoplePickerPermissions(),
  useCanSharePublic: () => mockUseCanSharePublic(),
  useCopyToClipboard: () => jest.fn(),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => mockUseGetStartupConfig(),
}));

/** Stands in for the directory picker: one button adds the queued picks, one only checks them. */
jest.mock('../PeoplePicker/DirectoryPeoplePicker', () => ({
  __esModule: true,
  default: ({
    onAddPeople,
    onPendingChange,
  }: {
    onAddPeople: (people: TPrincipal[]) => void;
    onPendingChange?: (people: TPrincipal[]) => void;
  }) => (
    <div data-testid="directory-people-picker">
      <button type="button" data-testid="add-picks" onClick={() => onAddPeople(mockPicked)} />
      <button
        type="button"
        data-testid="check-picks"
        onClick={() => onPendingChange?.(mockPicked)}
      />
    </div>
  ),
}));

jest.mock('../PeoplePicker/UnifiedPeopleSearch', () => ({
  __esModule: true,
  default: () => <div data-testid="unified-people-search" />,
}));
jest.mock('../PeoplePickerAdminSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="admin-settings" />,
}));
jest.mock('../PublicSharingToggle', () => ({
  __esModule: true,
  default: () => <div data-testid="public-toggle" />,
}));
jest.mock('../PeoplePicker', () => ({
  __esModule: true,
  SelectedPrincipalsList: () => <div data-testid="principals-list" />,
}));

const renderDialog = (props: { hidePublicSharing?: boolean } = {}) =>
  render(
    <GenericGrantAccessDialog
      resourceDbId="agent-db-1"
      resourceId="agent-1"
      resourceName="Test Agent"
      resourceType={ResourceType.AGENT}
      {...props}
    />,
  );

describe('GenericGrantAccessDialog - permissions load failure', () => {
  beforeEach(() => {
    mockUseResourcePermissionState.mockReset();
    mockRefetchPermissions.mockReset();
    mockUseAuthContext.mockReturnValue({ user: { role: 'ADMIN' } });
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: true,
      peoplePickerTypeFilter: '',
    });
    mockUseCanSharePublic.mockReturnValue(true);
    mockUseGetStartupConfig.mockReturnValue({ data: {} });
  });

  it('renders a compact alert button (not the share trigger, not raw text) when permissions fail to load', () => {
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ permissionsError: new Error('boom'), permissionsData: undefined }),
    );

    const { container } = renderDialog();

    expect(
      screen.getByRole('button', { name: 'com_ui_permissions_failed_load' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_ui_share_var' })).not.toBeInTheDocument();
    expect(container.querySelector('.spinner')).not.toBeInTheDocument();
  });

  it('retries the permissions fetch when the alert button is clicked', () => {
    mockUseResourcePermissionState.mockReturnValue(
      baseState({ permissionsError: new Error('boom'), permissionsData: undefined }),
    );

    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_permissions_failed_load' }));
    expect(mockRefetchPermissions).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner instead of the alert icon while refetching', () => {
    mockUseResourcePermissionState.mockReturnValue(
      baseState({
        permissionsError: new Error('boom'),
        permissionsData: undefined,
        isFetchingPermissions: true,
      }),
    );

    const { container } = renderDialog();

    expect(
      screen.getByRole('button', { name: 'com_ui_permissions_failed_load' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.spinner')).toBeInTheDocument();
  });

  it('renders the normal share trigger and dialog body when permissions load successfully', () => {
    mockUseResourcePermissionState.mockReturnValue(baseState());

    renderDialog();

    expect(
      screen.queryByRole('button', { name: 'com_ui_permissions_failed_load' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));
    const dialog = screen.getByRole('dialog');

    expect(dialog).toHaveClass('max-w-5xl', 'overflow-hidden', 'p-0');
    expect(
      screen.getByRole('heading', { level: 3, name: 'com_ui_user_group_permissions' }),
    ).toBeInTheDocument();
    expect(screen.getByText('com_ui_share_access_description')).toHaveClass('sr-only');
    expect(screen.getByTestId('unified-people-search').closest('section')).toHaveClass('w-full');
    expect(screen.getByTestId('public-toggle').parentElement).toHaveClass('border-t');
    expect(screen.getByTestId('admin-settings')).toBeInTheDocument();
    expect(dialog.firstElementChild).not.toHaveClass('border-b');
    const saveButton = screen.getByRole('button', { name: 'com_ui_save' });
    const footer = saveButton.parentElement;
    expect(footer).toHaveClass('bg-transparent');
    expect(footer).not.toHaveClass('border-t');
    expect(saveButton).toHaveClass('sm:w-auto');
    expect(saveButton).not.toHaveClass('min-w-[8.75rem]');
    expect(screen.queryByRole('button', { name: 'com_ui_cancel' })).not.toBeInTheDocument();
  });

  it('lets an admin manage agent principals without people picker or public sharing permissions', () => {
    mockUseResourcePermissionState.mockReturnValue(baseState());
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: false,
      peoplePickerTypeFilter: null,
    });
    mockUseCanSharePublic.mockReturnValue(false);

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));

    expect(screen.getByTestId('unified-people-search')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'com_ui_user_group_permissions' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('public-toggle')).not.toBeInTheDocument();
  });

  it('lists the pwc_tars directory to any user, without people picker permissions', () => {
    mockUseResourcePermissionState.mockReturnValue(baseState());
    mockUseAuthContext.mockReturnValue({ user: { role: 'USER' } });
    mockUsePeoplePickerPermissions.mockReturnValue({
      hasPeoplePickerAccess: false,
      peoplePickerTypeFilter: null,
    });
    mockUseGetStartupConfig.mockReturnValue({ data: { tarsAuth: true } });

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));

    expect(screen.getByTestId('directory-people-picker')).toBeInTheDocument();
    expect(screen.queryByTestId('unified-people-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-settings')).not.toBeInTheDocument();
  });

  it('keeps typed search and the people picker settings without pwc_tars', () => {
    mockUseResourcePermissionState.mockReturnValue(baseState());

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));

    expect(screen.getByTestId('unified-people-search')).toBeInTheDocument();
    expect(screen.queryByTestId('directory-people-picker')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-settings')).toBeInTheDocument();
  });

  describe('picks left in the pwc_tars directory picker', () => {
    const owner: TPrincipal = {
      type: PrincipalType.USER,
      id: 'owner-1',
      name: 'Owner',
      source: 'tars',
      idOnTheSource: 't-owner',
      accessRoleId: 'owner' as TPrincipal['accessRoleId'],
    };
    const amy: TPrincipal = {
      type: PrincipalType.USER,
      name: 'Amy',
      source: 'tars',
      idOnTheSource: 't-amy',
    };
    const boss: TPrincipal = {
      type: PrincipalType.GROUP,
      name: 'BOSS專用',
      source: 'tars',
      idOnTheSource: 't-boss',
    };

    const openDirectoryDialog = () => {
      const mutateAsync = jest.fn().mockResolvedValue({});
      mockUseGetStartupConfig.mockReturnValue({ data: { tarsAuth: true } });
      mockUseResourcePermissionState.mockReturnValue(
        baseState({
          permissionsData: { principals: [owner], public: false },
          currentShares: [owner],
          updatePermissionsMutation: { isLoading: false, mutateAsync },
        }),
      );
      renderDialog();
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));
      return mutateAsync;
    };
    const saveButton = () => screen.getByRole('button', { name: 'com_ui_save' });

    beforeEach(() => {
      mockPicked = [amy, boss];
    });

    it('enables Save for checked picks and shares them with the default role', async () => {
      const mutateAsync = openDirectoryDialog();
      expect(saveButton()).toBeDisabled();

      fireEvent.click(screen.getByTestId('check-picks'));
      expect(saveButton()).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(saveButton());
      });

      expect(mutateAsync).toHaveBeenCalledWith({
        resourceType: ResourceType.AGENT,
        resourceId: 'agent-db-1',
        data: {
          updated: [
            expect.objectContaining({ idOnTheSource: 't-amy', accessRoleId: 'viewer' }),
            expect.objectContaining({ idOnTheSource: 't-boss', accessRoleId: 'viewer' }),
          ],
          removed: [],
        },
      });
    });

    it('shares a pick once when it is both checked and added', async () => {
      const mutateAsync = openDirectoryDialog();

      fireEvent.click(screen.getByTestId('check-picks'));
      fireEvent.click(screen.getByTestId('add-picks'));
      await act(async () => {
        fireEvent.click(saveButton());
      });

      expect(mutateAsync.mock.calls[0][0].data.updated).toHaveLength(2);
    });

    it('names who a share was refused for and clears that with the draft', async () => {
      const mutateAsync = openDirectoryDialog();
      mutateAsync.mockRejectedValue({
        response: {
          data: {
            code: TARS_MCP_SHARE_BLOCKED,
            blocked: [
              {
                principal_type: 'user',
                idOnTheSource: 't-amy',
                name: 'Amy',
                servers: [
                  { mcp_server_id: 's1', server_name: 'Maps', no_access: true, tool_names: [] },
                ],
              },
            ],
          },
        },
      });

      fireEvent.click(screen.getByTestId('check-picks'));
      await act(async () => {
        fireEvent.click(saveButton());
      });

      expect(screen.getByText('Amy')).toBeInTheDocument();
      expect(screen.getByText('com_ui_tars_mcp_share_blocked')).toBeInTheDocument();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'com_ui_tars_mcp_share_blocked', status: 'error' }),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));

      expect(screen.queryByText('com_ui_tars_mcp_share_blocked')).not.toBeInTheDocument();
    });

    it('drops the checked picks when the dialog is closed without saving', async () => {
      const mutateAsync = openDirectoryDialog();

      fireEvent.click(screen.getByTestId('check-picks'));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));

      expect(saveButton()).toBeDisabled();
      expect(mutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('public sharing on an agent bound to MCP tools', () => {
    const openDialog = (state: Record<string, unknown> = {}) => {
      mockUseResourcePermissionState.mockReturnValue(baseState(state));
      renderDialog({ hidePublicSharing: true });
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));
    };

    it('is not offered', () => {
      openDialog();

      expect(screen.queryByTestId('public-toggle')).not.toBeInTheDocument();
    });

    it('stays available to turn off on an agent that is already public', () => {
      openDialog({ currentIsPublic: true, isPublic: true });

      expect(screen.getByTestId('public-toggle')).toBeInTheDocument();
    });
  });

  it('discards the draft through the shared close path', () => {
    const setIsPublic = jest.fn();
    const setPublicRole = jest.fn();
    mockUseResourcePermissionState.mockReturnValue(baseState({ setIsPublic, setPublicRole }));

    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(setIsPublic).toHaveBeenCalledWith(false);
    expect(setPublicRole).toHaveBeenCalledWith('viewer');
  });

  it.each([
    ['RESOURCE_PERMISSIONS_BUSY', 'com_ui_permissions_busy'],
    ['RESOURCE_PERMISSIONS_UNAVAILABLE', 'com_ui_permissions_unavailable'],
    ['PERMISSION_AUDIT_UNAVAILABLE', 'com_ui_permissions_audit_unavailable'],
    ['SOMETHING_ELSE', 'com_ui_permissions_failed_update'],
  ])('shows the localized message for the %s failure code on save', async (code, key) => {
    const mutateAsync = jest.fn().mockRejectedValue({ response: { data: { code } } });
    mockUseResourcePermissionState.mockReturnValue(
      baseState({
        isPublic: true,
        currentIsPublic: false,
        updatePermissionsMutation: { isLoading: false, mutateAsync },
      }),
    );
    mockShowToast.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_var' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith({ message: key, status: 'error' }),
    );
    expect((translationEn as Record<string, string>)[key]).toEqual(expect.any(String));
  });
});
