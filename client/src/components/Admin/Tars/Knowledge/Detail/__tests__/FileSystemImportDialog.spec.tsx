import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import type { TTarsDatasetLimits } from 'librechat-data-provider';
import FileSystemImportDialog from '../FileSystemImportDialog';

type MutationOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const mockImport = jest.fn();
const mockShowToast = jest.fn();
const options: { import?: MutationOptions } = {};

const FILES = ['demo_ftp.txt', 'test/demo_ftp.txt', 'test/deep/test_ftp.txt', 'test2/demo_ftp.txt'];
const LIMITS: TTarsDatasetLimits = {
  max_upload_counts: 5,
  max_chunk_size: 30000,
  max_overlap: 300,
};

jest.mock('~/data-provider', () => ({
  useTarsFileSystemSourcesQuery: () => ({
    data: [{ id: 'fs-1', name: 'FTP_Demo', mount_type: 'FTP' }],
    isLoading: false,
  }),
  useTarsFileSystemFilesQuery: (_kb: string, browseId: string | null) =>
    browseId
      ? { data: FILES, isSuccess: true, isFetching: false, isError: false }
      : { data: undefined, isSuccess: false, isFetching: false, isError: false },
  useImportTarsFileSystemMutation: (_kb: string, opts: MutationOptions) => {
    options.import = opts;
    return { mutate: mockImport, isLoading: false };
  },
}));

/** The real one is an Ariakit select; a native one keeps these tests about the dialog. */
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
  Dropdown: ({
    value,
    onChange,
    options: choices,
    'aria-labelledby': labelledBy,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    'aria-labelledby'?: string;
  }) => (
    <select
      aria-labelledby={labelledBy}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}));

/** Keeps the first argument, so rows stay tellable apart by the file they name. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, string>) =>
    params?.[0] != null ? `${key} ${params[0]}` : key,
}));

const renderDialog = () =>
  render(
    <FileSystemImportDialog
      knowledgeBaseId="kb-1"
      linked={[]}
      limits={LIMITS}
      onClose={jest.fn()}
    />,
  );

const browse = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/com_ui_tars_kb_ds_group_name/), 'Reports');
  await user.click(screen.getByRole('button', { name: 'com_ui_tars_kb_ds_browse' }));
};

const tick = (file: string) =>
  screen.getByRole('checkbox', { name: `com_ui_tars_kb_ds_select_one ${file}` });
const folderPicker = () => screen.getByRole('combobox', { name: 'com_ui_tars_kb_ds_bind_folder' });
const importButton = () => screen.getByRole('button', { name: 'com_ui_tars_kb_ds_import' });

beforeEach(() => {
  mockImport.mockClear();
  mockShowToast.mockClear();
});

describe('FileSystemImportDialog', () => {
  it('binds the chosen folder and imports only the files ticked inside it', async () => {
    const user = userEvent.setup();
    renderDialog();
    await browse(user);

    await user.selectOptions(folderPicker(), 'test');
    expect(
      screen.queryByRole('checkbox', { name: 'com_ui_tars_kb_ds_select_one test2/demo_ftp.txt' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);

    await user.click(tick('test/deep/test_ftp.txt'));
    await user.click(importButton());

    expect(mockImport).toHaveBeenCalledWith({
      fileSystemId: 'fs-1',
      data: {
        name: 'Reports',
        syncAll: false,
        uploadOnly: false,
        chunkSize: 1000,
        overlap: 100,
        selectedFolder: 'test',
        files: [{ path: 'test/deep/test_ftp.txt', chunkSize: 1000, overlap: 100 }],
      },
    });
  });

  it('drops ticks from the previous folder when the bound folder changes', async () => {
    const user = userEvent.setup();
    renderDialog();
    await browse(user);

    await user.click(tick('test2/demo_ftp.txt'));
    expect(importButton()).toBeEnabled();

    await user.selectOptions(folderPicker(), 'test');
    expect(importButton()).toBeDisabled();
  });

  it('ticks every listed file in the folder at once', async () => {
    const user = userEvent.setup();
    renderDialog();
    await browse(user);

    await user.selectOptions(folderPicker(), 'test');
    await user.click(screen.getByRole('checkbox', { name: 'com_ui_tars_kb_ds_select_all' }));
    await user.click(importButton());

    expect(
      mockImport.mock.calls[0][0].data.files.map((file: { path: string }) => file.path),
    ).toEqual(['test/demo_ftp.txt', 'test/deep/test_ftp.txt']);
  });

  it("sends a file's own chunking and lets the rest follow the group's", async () => {
    const user = userEvent.setup();
    renderDialog();
    await browse(user);

    await user.click(tick('demo_ftp.txt'));
    await user.click(tick('test2/demo_ftp.txt'));
    const own = screen.getByLabelText('com_ui_tars_kb_chunk_size demo_ftp.txt');
    await user.clear(own);
    await user.type(own, '500');

    const group = screen.getByLabelText('com_ui_tars_kb_chunk_size');
    await user.clear(group);
    await user.type(group, '1200');
    expect(screen.getByLabelText('com_ui_tars_kb_chunk_size test2/demo_ftp.txt')).toHaveValue(1200);

    await user.click(importButton());

    expect(mockImport.mock.calls[0][0].data).toMatchObject({
      chunkSize: 1200,
      files: [
        { path: 'demo_ftp.txt', chunkSize: 500, overlap: 100 },
        { path: 'test2/demo_ftp.txt', chunkSize: 1200, overlap: 100 },
      ],
    });
  });

  it('takes every file in the bound folder, sending only the ones given their own chunking', async () => {
    const user = userEvent.setup();
    renderDialog();
    await browse(user);

    await user.selectOptions(folderPicker(), 'test');
    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_kb_ds_sync_all' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    const own = screen.getByLabelText('com_ui_tars_kb_overlap test/demo_ftp.txt');
    await user.clear(own);
    await user.type(own, '50');
    await user.click(importButton());

    expect(mockImport.mock.calls[0][0].data).toMatchObject({
      syncAll: true,
      selectedFolder: 'test',
      files: [{ path: 'test/demo_ftp.txt', chunkSize: 1000, overlap: 50 }],
    });
  });

  it('binds the whole source when everything is taken without browsing', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText(/com_ui_tars_kb_ds_group_name/), 'Reports');
    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_kb_ds_sync_all' }));
    await user.click(importButton());

    expect(mockImport.mock.calls[0][0].data).toMatchObject({ syncAll: true, selectedFolder: '' });
  });

  it('refuses chunking pwc_tars would reject', async () => {
    const user = userEvent.setup();
    renderDialog();
    await browse(user);
    await user.click(tick('demo_ftp.txt'));

    const overlap = screen.getByLabelText('com_ui_tars_kb_overlap demo_ftp.txt');
    await user.clear(overlap);
    await user.type(overlap, '2000');

    expect(importButton()).toBeDisabled();
    expect(screen.getByText(/com_ui_tars_kb_ds_chunk_invalid/)).toBeInTheDocument();
  });

  it("shows pwc_tars' own reason when the import is refused", async () => {
    renderDialog();
    act(() =>
      options.import?.onError?.({
        response: { data: { error: '已經重複關聯，如要更新請先取消其他關聯' } },
      }),
    );

    expect(mockShowToast).toHaveBeenCalledWith({
      message: '已經重複關聯，如要更新請先取消其他關聯',
      status: 'error',
    });
  });
});
