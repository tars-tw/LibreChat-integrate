import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TTarsSsoConfig, TTarsAdSyncSummary } from 'librechat-data-provider';
import SsoConfigModal from '../Modal';

type Callbacks<T> = { onSuccess?: (result: T) => void; onError?: (error: unknown) => void };

const mockShowToast = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn((_vars: unknown, callbacks?: Callbacks<{ success: boolean }>) =>
  callbacks?.onSuccess?.({ success: true }),
);
let mockSummaryResult: TTarsAdSyncSummary = {
  synced_user_count: 44,
  synced_group_count: 11,
  external_member_count: 0,
};
const mockSummary = jest.fn((_id: string, callbacks?: Callbacks<TTarsAdSyncSummary>) =>
  callbacks?.onSuccess?.(mockSummaryResult),
);
let mockImportFails = false;
const mockImport = jest.fn((_vars: unknown, callbacks?: Callbacks<{ message: string }>) =>
  mockImportFails
    ? callbacks?.onError?.({ response: { data: { error: 'AD 中不存在群組來源屬性' } } })
    : callbacks?.onSuccess?.({ message: 'synced 39' }),
);

jest.mock('~/data-provider', () => ({
  useCreateTarsSsoConfigMutation: () => ({ mutate: mockCreate, isLoading: false }),
  useUpdateTarsSsoConfigMutation: () => ({ mutate: mockUpdate, isLoading: false }),
  useTestTarsSsoConnectionMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useTarsAdSyncSummaryMutation: () => ({ mutate: mockSummary, isLoading: false }),
  useImportTarsAdDataMutation: () => ({ mutate: mockImport, isLoading: false }),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

const config: TTarsSsoConfig = {
  id: 'cfg-1',
  sso_type_id: '1',
  sso_type_name: 'LDAP',
  status: 1,
  ldap_name: '台北總公司',
  ldap_server_address: '10.0.0.1',
  ldap_server_port: '389',
  ldap_base_dn: 'DC=adtest,DC=local',
  ldap_search_attribute: 'sAMAccountName',
  ldap_group_attribute: null,
};

const onOpenChange = jest.fn();

const renderModal = (target?: TTarsSsoConfig) =>
  render(<SsoConfigModal config={target} onOpenChange={onOpenChange} />);

const groupSourceSwitch = () =>
  screen.getByRole('switch', { name: 'com_ui_tars_sso_group_attribute_enable' });

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'com_ui_save' }));

/**
 * The Dropdown popover is portaled outside the dialog and relies on a Tailwind
 * `[pointer-events:auto]` class that jsdom does not apply, so the option click
 * skips user-event's pointer-events check.
 */
const pickAttribute = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.click(screen.getByRole('combobox', { name: /com_ui_tars_sso_group_source/ }));
  await userEvent
    .setup({ pointerEventsCheck: 0 })
    .click(screen.getByRole('option', { name: label, hidden: true }));
};

const sentAttribute = () =>
  (mockUpdate.mock.calls[0][0] as { data: { ldap_group_attribute?: string } }).data
    .ldap_group_attribute;

beforeEach(() => {
  jest.clearAllMocks();
  mockImportFails = false;
  mockSummaryResult = { synced_user_count: 44, synced_group_count: 11, external_member_count: 0 };
});

describe('SsoConfigModal group source', () => {
  it('starts on AD groups when the connection has no group source attribute', () => {
    renderModal(config);
    expect(groupSourceSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('combobox', { name: /com_ui_tars_sso_group_source/ })).toBeNull();
  });

  it('loads a preset attribute into the dropdown', () => {
    renderModal({ ...config, ldap_group_attribute: 'title' });
    expect(groupSourceSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('combobox', { name: /com_ui_tars_sso_group_source/ }),
    ).toHaveTextContent('com_ui_tars_sso_group_attribute_title');
  });

  it('loads any other attribute as a custom one', () => {
    renderModal({ ...config, ldap_group_attribute: 'division' });
    expect(
      screen.getByRole('textbox', { name: 'com_ui_tars_sso_group_attribute_custom' }),
    ).toHaveValue('division');
  });

  it('saves without checking imported data when the group source is unchanged', async () => {
    const user = userEvent.setup();
    renderModal({ ...config, ldap_group_attribute: 'department' });
    await save(user);
    expect(mockSummary).not.toHaveBeenCalled();
    expect(sentAttribute()).toBe('department');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('asks before switching an imported connection, then saves and syncs', async () => {
    const user = userEvent.setup();
    mockSummaryResult = { synced_user_count: 44, synced_group_count: 11, external_member_count: 1 };
    renderModal(config);

    await user.click(groupSourceSwitch());
    await save(user);

    expect(mockSummary).toHaveBeenCalledWith('cfg-1', expect.any(Object));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('com_ui_tars_sso_group_source_change_title')).toBeInTheDocument();
    expect(screen.getByText(/com_ui_tars_sso_group_source_change_message:/).textContent).toContain(
      'com_ui_tars_sso_group_source_attribute:department',
    );
    expect(screen.getByText('com_ui_tars_sso_group_source_change_groups:11')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_sso_group_source_change_users:44')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_sso_group_source_change_external:1')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_sso_import_enable' }));
    await user.click(
      screen.getByRole('button', { name: 'com_ui_tars_sso_group_source_change_confirm' }),
    );

    expect(sentAttribute()).toBe('department');
    expect(mockImport).toHaveBeenCalledWith(
      { id: 'cfg-1', enableUsers: false },
      expect.any(Object),
    );
    expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockImport.mock.invocationCallOrder[0],
    );
    expect(mockShowToast).toHaveBeenCalledWith({ message: 'synced 39', status: 'success' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hides the external-members line when nobody outside the sync is affected', async () => {
    const user = userEvent.setup();
    renderModal(config);
    await user.click(groupSourceSwitch());
    await save(user);
    expect(screen.queryByText(/com_ui_tars_sso_group_source_change_external/)).toBeNull();
  });

  it('goes back to the form without saving', async () => {
    const user = userEvent.setup();
    renderModal(config);
    await user.click(groupSourceSwitch());
    await save(user);
    await user.click(screen.getByRole('button', { name: 'com_ui_back' }));

    expect(screen.queryByText('com_ui_tars_sso_group_source_change_title')).toBeNull();
    expect(groupSourceSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('saves directly when the connection has not imported anything yet', async () => {
    const user = userEvent.setup();
    mockSummaryResult = { synced_user_count: 0, synced_group_count: 0, external_member_count: 0 };
    renderModal(config);
    await user.click(groupSourceSwitch());
    await pickAttribute(user, 'com_ui_tars_sso_group_attribute_company');
    await save(user);

    expect(screen.queryByText('com_ui_tars_sso_group_source_change_title')).toBeNull();
    expect(sentAttribute()).toBe('company');
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('sends an empty attribute, after confirming, when switching back to AD groups', async () => {
    const user = userEvent.setup();
    renderModal({ ...config, ldap_group_attribute: 'department' });
    await user.click(groupSourceSwitch());
    await save(user);
    await user.click(
      screen.getByRole('button', { name: 'com_ui_tars_sso_group_source_change_confirm' }),
    );
    expect(sentAttribute()).toBe('');
    expect(mockImport).toHaveBeenCalledWith({ id: 'cfg-1', enableUsers: true }, expect.any(Object));
  });

  it('refuses an empty or malformed custom attribute', async () => {
    const user = userEvent.setup();
    renderModal(config);
    await user.click(groupSourceSwitch());
    await pickAttribute(user, 'com_ui_tars_sso_group_attribute_custom');

    await save(user);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_sso_group_attribute_required',
      status: 'error',
    });

    const custom = screen.getByRole('textbox', { name: 'com_ui_tars_sso_group_attribute_custom' });
    await user.type(custom, 'dep art');
    await save(user);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_sso_group_attribute_invalid:dep art',
      status: 'error',
    });
    expect(mockSummary).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('reports a failed sync after the connection was saved', async () => {
    const user = userEvent.setup();
    mockImportFails = true;
    renderModal(config);
    await user.click(groupSourceSwitch());
    await save(user);
    await user.click(
      screen.getByRole('button', { name: 'com_ui_tars_sso_group_source_change_confirm' }),
    );

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_sso_group_source_sync_failed:AD 中不存在群組來源屬性',
      status: 'error',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('creates a connection with its group source without any confirmation', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('com_ui_tars_sso_address'), 'ldap.example.com');
    await user.type(screen.getByLabelText('com_ui_tars_sso_port'), '389');
    await user.type(screen.getByLabelText('com_ui_tars_sso_base_dn'), 'DC=x');
    await user.click(groupSourceSwitch());
    await pickAttribute(user, 'com_ui_tars_sso_group_attribute_physicalDeliveryOfficeName');
    await save(user);

    expect(mockSummary).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ldap_group_attribute: 'physicalDeliveryOfficeName' }),
    );
  });
});

describe('SsoConfigModal group source layout', () => {
  const scrollIntoView = jest.fn();

  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it('scrolls the attribute picker into view when the group source is turned on', async () => {
    const user = userEvent.setup();
    renderModal(config);
    await user.click(groupSourceSwitch());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('describes the base DN field with the hint shown inside it', () => {
    renderModal(config);
    expect(screen.getByLabelText('com_ui_tars_sso_base_dn')).toHaveAccessibleDescription(
      'com_ui_tars_sso_base_dn_hint',
    );
  });

  it('shows the base DN hint inside the field only while it is empty', async () => {
    const user = userEvent.setup();
    renderModal();
    const hint = () => document.getElementById('tars-ldap-base-dn-hint');
    expect(hint()).not.toHaveAttribute('hidden');

    await user.type(screen.getByLabelText('com_ui_tars_sso_base_dn'), 'DC=x');
    expect(hint()).toHaveAttribute('hidden');
    expect(screen.getByLabelText('com_ui_tars_sso_base_dn')).toHaveAccessibleDescription(
      'com_ui_tars_sso_base_dn_hint',
    );
  });

  it('leaves the form where it is when a saved group source is loaded', () => {
    renderModal({ ...config, ldap_group_attribute: 'department' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
