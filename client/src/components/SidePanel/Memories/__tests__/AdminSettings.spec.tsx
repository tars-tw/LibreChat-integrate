import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { SystemRoles } from 'librechat-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminSettings from '../AdminSettings';

let mockRole: string = SystemRoles.USER;
/** Stable, as in the real hook: the dialog resets its form whenever this identity changes. */
const mockDefaultValues = {};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => ({ user: { role: 'ADMIN' } }),
  useRoleSelector: () => ({
    selectedRole: mockRole,
    isSelectedCustomRole: false,
    isCustomRoleLoading: false,
    isCustomRoleError: false,
    defaultValues: mockDefaultValues,
    roleDropdownItems: [],
  }),
}));

jest.mock('~/data-provider', () => ({
  useUpdateMemoryPermissionsMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

const open = () => {
  render(<AdminSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_admin_settings' }));
};

const toggles = () =>
  screen.getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-label'));

describe('memory AdminSettings', () => {
  it('offers every permission for a regular role', () => {
    mockRole = SystemRoles.USER;
    open();
    expect(toggles()).toEqual([
      'com_ui_memories_allow_use',
      'com_ui_memories_allow_create',
      'com_ui_memories_allow_update',
      'com_ui_memories_allow_read',
      'com_ui_memories_allow_opt_out',
    ]);
    expect(screen.getByText('com_ui_user')).toBeInTheDocument();
  });

  it('does not let an admin switch off what keeps these settings reachable', () => {
    mockRole = SystemRoles.ADMIN;
    open();
    expect(toggles()).toEqual([
      'com_ui_memories_allow_create',
      'com_ui_memories_allow_update',
      'com_ui_memories_allow_opt_out',
    ]);
    expect(screen.getByText('com_ui_admin')).toBeInTheDocument();
  });
});
