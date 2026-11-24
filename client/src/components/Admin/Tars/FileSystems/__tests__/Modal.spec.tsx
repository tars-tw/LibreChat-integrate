import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TTarsFileSystemConnectionTest, TTarsFileSystemSource } from 'librechat-data-provider';
import FileSystemModal from '../Modal';

const mockUpdate = jest.fn();
const mockTest: {
  mutate: jest.Mock;
  reset: jest.Mock;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  data?: TTarsFileSystemConnectionTest;
} = { mutate: jest.fn(), reset: jest.fn(), isLoading: false, isSuccess: false, isError: false };

jest.mock('~/data-provider', () => ({
  useCreateTarsFileSystemMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdateTarsFileSystemMutation: () => ({ mutate: mockUpdate, isLoading: false }),
  useTestTarsFileSystemConnectionMutation: () => mockTest,
}));

/** The real one is an Ariakit select; a native one keeps these tests about the modal. */
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
  Dropdown: ({
    value,
    onChange,
    options,
    ariaLabel,
  }: {
    value?: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select aria-label={ariaLabel} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

/** Spells out the arguments, so a line shows which path it was given. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, string>) =>
    params?.[0] != null ? `${key} ${params[0]}` : key,
}));

const smbGroup = (overrides: Partial<TTarsFileSystemSource> = {}): TTarsFileSystemSource => ({
  id: 'fs-1',
  name: 'SMB_Demo',
  description: null,
  mount_type: 'SMB',
  host: '202.5.251.113',
  port: 445,
  path: 'SharedFolder',
  host_name: 'pwcadtest01-583',
  status: 1,
  allowed_km_ids: [],
  created_by: null,
  created_at: null,
  updated_at: null,
  ...overrides,
});

const renderModal = (fileSystem: TTarsFileSystemSource | null) =>
  render(<FileSystemModal fileSystem={fileSystem} knowledgeBases={[]} onClose={jest.fn()} />);

const save = () => screen.getByRole('button', { name: 'com_ui_save' });

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockTest, { isSuccess: false, data: undefined });
});

describe('FileSystemModal on an existing group', () => {
  it('keeps the protocol it was created with', async () => {
    renderModal(smbGroup());

    expect(screen.getByRole('radio', { name: /SMB/ })).toBeEnabled();
    for (const other of ['FTP', 'SFTP', 'NFS']) {
      expect(screen.getByRole('radio', { name: new RegExp(`^${other}$`) })).toBeDisabled();
    }
    expect(screen.getByText('com_ui_tars_fs_protocol_locked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /^FTP$/ }));
    expect(screen.getByRole('radio', { name: /SMB/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('browses without touching the group path; only "Use as group path" changes it', async () => {
    Object.assign(mockTest, {
      isSuccess: true,
      data: { files: ['SMB測試/人資部/a.txt', 'SMB測試/b.txt', 'top.pdf'], unreadableDirs: [] },
    });
    renderModal(smbGroup());
    expect(screen.getByText('com_ui_tars_fs_path_current /SharedFolder')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_tars_db_test' }));
    expect(mockTest.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'SharedFolder', fileSystemId: 'fs-1' }),
    );
    expect(screen.getByText('com_ui_tars_fs_is_group_path')).toBeInTheDocument();
    expect(screen.getByText('top.pdf')).toBeInTheDocument();

    // A folder the test walked opens without asking the server again, and so does going back up to it.
    await userEvent.click(screen.getByRole('button', { name: 'SMB測試' }));
    await userEvent.click(screen.getByRole('button', { name: 'SharedFolder' }));
    await userEvent.click(screen.getByRole('button', { name: 'SMB測試' }));
    expect(mockTest.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('top.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(screen.queryByText(/com_ui_tars_fs_path_new/)).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(screen.getByText('com_ui_tars_fs_save_unchanged')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_tars_fs_set_group_path' }));
    expect(
      screen.getByText('com_ui_tars_fs_path_new /SharedFolder/SMB測試', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_fs_path_change_hint')).toBeInTheDocument();
    expect(save()).toBeEnabled();

    await userEvent.click(save());
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'fs-1',
      data: expect.objectContaining({ path: '/SharedFolder/SMB測試', protocol: 'SMB' }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_tars_fs_path_restore' }));
    expect(screen.queryByText(/com_ui_tars_fs_path_new/)).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('asks the server for a folder the test did not walk, and the server root cannot be the path', async () => {
    Object.assign(mockTest, { isSuccess: true, data: { files: ['b.txt'], unreadableDirs: [] } });
    renderModal(smbGroup());
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_tars_db_test' }));

    await userEvent.click(screen.getByRole('button', { name: '/' }));
    expect(mockTest.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/' }));
    expect(screen.getByText('com_ui_tars_fs_blocked_smb_share')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_tars_fs_set_group_path' })).toBeDisabled();
    // Browsing up to the root never touched what will be saved: nothing to save, nothing blocked.
    expect(screen.queryByText(/com_ui_tars_fs_path_unset_smb/)).not.toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_fs_save_unchanged')).toBeInTheDocument();
  });

  it('uses the default port when none is stored', async () => {
    renderModal(smbGroup({ port: null }));

    expect(screen.getByLabelText(/com_ui_tars_fs_port/)).toHaveValue('445');
    await userEvent.type(screen.getByLabelText(/com_ui_tars_db_password/), 'new-secret');
    expect(save()).toBeEnabled();
  });

  it('reads a protocol stored in lower case as that protocol', () => {
    renderModal(smbGroup({ mount_type: 'sftp', port: 21123, path: '/', host_name: null }));

    expect(screen.getByRole('radio', { name: /SFTP/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('only holds a typed name to the length rule', async () => {
    const legacy = 'A document group named long before the forty character rule';
    renderModal(smbGroup({ name: legacy }));

    await userEvent.type(screen.getByLabelText('com_ui_description'), 'kept name');
    expect(save()).toBeEnabled();
    const name = screen.getByLabelText(/com_ui_tars_fs_name/);
    await userEvent.type(name, '!');
    expect(save()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_tars_fs_reason_name');
    await userEvent.clear(name);
    await userEvent.type(name, 'SMB_Demo');
    expect(save()).toBeEnabled();
  });
});

describe('FileSystemModal save rules', () => {
  it('lets a changed account or password alone be saved, and says when nothing changed', async () => {
    renderModal(smbGroup());

    expect(save()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_tars_fs_save_unchanged');

    await userEvent.type(screen.getByLabelText(/com_ui_tars_fs_account/), 'HERMES\\svc_tars');
    expect(save()).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.click(save());
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'fs-1',
      data: expect.objectContaining({ account: 'HERMES\\svc_tars', path: 'SharedFolder' }),
    });
  });

  it('names what blocks a save next to the button', async () => {
    renderModal(smbGroup());

    await userEvent.clear(screen.getByLabelText(/com_ui_tars_fs_port/));
    expect(save()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'com_ui_tars_fs_save_blocked com_ui_tars_fs_reason_port',
    );
  });
});

describe('FileSystemModal for a new group', () => {
  it('never calls an SMB share list or an NFS export list the group path', async () => {
    Object.assign(mockTest, {
      isSuccess: true,
      data: {
        files: ['SharedFolder', 'Public'],
        exports: ['/mnt/data', '/mnt/data/nfs_data'],
        unreadableDirs: [],
      },
    });
    renderModal(null);
    await userEvent.type(screen.getByLabelText(/com_ui_tars_fs_host/), '10.0.0.5');
    await userEvent.type(screen.getByLabelText(/com_ui_tars_fs_account/), 'svc');
    await userEvent.type(screen.getByLabelText(/com_ui_tars_db_password/), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_tars_db_test' }));

    expect(screen.queryByText('com_ui_tars_fs_is_group_path')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_tars_fs_set_group_path' })).toBeDisabled();
    expect(screen.getByText('com_ui_tars_fs_blocked_smb_share')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /^NFS$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_tars_db_test' }));
    expect(mockTest.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ listExports: true }),
    );
    expect(screen.queryByText('com_ui_tars_fs_is_group_path')).not.toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_fs_blocked_nfs_export')).toBeInTheDocument();
  });

  it('lists everything still missing', () => {
    renderModal(null);

    const status = screen.getByRole('status');
    for (const reason of ['name', 'host', 'smb_share']) {
      expect(status).toHaveTextContent(`com_ui_tars_fs_reason_${reason}`);
    }
    expect(save()).toBeDisabled();
  });

  it('says which path will be saved', () => {
    renderModal(null);

    expect(screen.getByText(/com_ui_tars_fs_path_unset_smb/)).toBeInTheDocument();
    expect(screen.queryByText(/com_ui_tars_fs_path_current/)).not.toBeInTheDocument();
  });
});
