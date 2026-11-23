import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, render, screen, within } from '@testing-library/react';
import type { TTarsDatasetFileSystemLink } from 'librechat-data-provider';
import FileSystemsTab from '../FileSystemsTab';

type RefreshOptions = {
  onSuccess?: (result: unknown, variables: { syncAll?: boolean }) => void;
  onError?: (error: unknown) => void;
};

const mockIdleMutation = { mutate: jest.fn(), isLoading: false };
const mockRefresh = { mutate: jest.fn(), isLoading: false };
const mockRefreshOptions: { current?: RefreshOptions } = {};
const mockShowToast = jest.fn();

jest.mock('~/data-provider', () => ({
  useTarsFileSystemSourcesQuery: () => ({ data: [] }),
  useImportTarsFileSystemMutation: () => mockIdleMutation,
  useRebuildTarsFileSystemMutation: () => mockIdleMutation,
  useRefreshTarsFileSystemMutation: (_kb: string, options: RefreshOptions) => {
    mockRefreshOptions.current = options;
    return mockRefresh;
  },
  useReprocessTarsFileSystemMutation: () => mockIdleMutation,
  useUnlinkTarsFileSystemMutation: () => mockIdleMutation,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

/** Keeps the first argument, so rows stay tellable apart by the group they name. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, string>) =>
    params?.[0] != null ? `${key} ${params[0]}` : key,
}));

const link = (id: string, name: string): TTarsDatasetFileSystemLink => ({
  id: `link-${id}`,
  knowledge_base_id: 'kb-1',
  dataset_file_system_id: id,
  name,
  status: 1,
  llm_model: null,
  schedule_id: null,
  is_sync_all: false,
  is_upload_only: false,
  directory_path: null,
  chunk_size: null,
  overlap_size: null,
  created_by: null,
  created_at: null,
  updated_at: null,
});

const LIMITS = { max_upload_counts: 5, max_chunk_size: 30000, max_overlap: 300 };

const renderTab = (onBatchUnlink = jest.fn()) => {
  render(
    <FileSystemsTab
      knowledgeBaseId="kb-1"
      links={[link('fs-1', 'FTP_Demo'), link('fs-2', 'SMB_Demo'), link('fs-3', 'SFTP_Demo')]}
      documents={[]}
      levels={[]}
      limits={LIMITS}
      locale="zh-Hant"
      onRefresh={jest.fn()}
      isRefreshing={false}
      onBatchUnlink={onBatchUnlink}
      isBatchUnlinking={false}
      onViewChunks={jest.fn()}
    />,
  );
  return onBatchUnlink;
};

const tick = (name: string) =>
  screen.getByRole('checkbox', { name: `com_ui_tars_kb_ds_select_item ${name}` });

describe('FileSystemsTab batch unlink', () => {
  it('asks first, then unlinks the ticked groups by their association id', async () => {
    const user = userEvent.setup();
    const onBatchUnlink = renderTab();

    expect(screen.queryByRole('button', { name: /com_ui_tars_kb_ds_batch_unlink/ })).toBeNull();
    await user.click(tick('FTP_Demo'));
    await user.click(tick('SFTP_Demo'));
    await user.click(screen.getByRole('button', { name: /com_ui_tars_kb_ds_batch_unlink/ }));

    expect(screen.getByText('com_ui_tars_kb_ds_batch_unlink_confirm 2')).toBeInTheDocument();
    expect(onBatchUnlink).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'com_ui_tars_kb_ds_unlink' }));
    expect(onBatchUnlink).toHaveBeenCalledWith(['link-fs-1', 'link-fs-3']);
    expect(screen.queryByRole('button', { name: /com_ui_tars_kb_ds_batch_unlink/ })).toBeNull();
  });

  it('ticks every group on the page at once', async () => {
    const user = userEvent.setup();
    const onBatchUnlink = renderTab();

    await user.click(screen.getByRole('checkbox', { name: 'com_ui_tars_kb_ds_select_all' }));
    await user.click(screen.getByRole('button', { name: /com_ui_tars_kb_ds_batch_unlink/ }));
    await user.click(screen.getByRole('button', { name: 'com_ui_tars_kb_ds_unlink' }));

    expect(onBatchUnlink).toHaveBeenCalledWith(['link-fs-1', 'link-fs-2', 'link-fs-3']);
  });
});

describe('FileSystemsTab sync', () => {
  beforeEach(() => jest.clearAllMocks());

  const row = (name: string) => tick(name).closest('tr') as HTMLElement;

  it('explains on the mode cell that a group imported only some files', () => {
    renderTab();

    const mode = within(row('FTP_Demo')).getByTitle('com_ui_tars_kb_ds_sync_selected_hint');
    expect(mode).toHaveTextContent('com_ui_tars_kb_ds_sync_selected');
  });

  it('sends the switch with the sync and reports what pwc_tars did', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(
      within(row('FTP_Demo')).getByRole('button', { name: 'com_ui_tars_kb_ds_sync' }),
    );
    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_kb_ds_sync_switch_all' }));
    await user.click(screen.getByRole('button', { name: 'com_ui_tars_kb_ds_sync' }));

    expect(mockRefresh.mutate).toHaveBeenCalledWith({
      fileSystemId: 'fs-1',
      associationId: 'link-fs-1',
      chunkSize: 1000,
      overlap: 100,
      syncAll: true,
    });

    act(() =>
      mockRefreshOptions.current?.onSuccess?.(
        {
          total_updated: 4,
          total_failed: 0,
          failed_files: [],
          deleted_count: 0,
          deletion_notices: [],
          is_sync_all: true,
          status: 'success',
        },
        { syncAll: true },
      ),
    );

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_kb_ds_sync_done 4\ncom_ui_tars_kb_ds_sync_switched',
      status: 'success',
    });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('closes on a timeout, since the sync carries on in pwc_tars', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(
      within(row('FTP_Demo')).getByRole('button', { name: 'com_ui_tars_kb_ds_sync' }),
    );
    act(() => mockRefreshOptions.current?.onError?.({ response: { status: 504 } }));

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_kb_ds_sync_timeout',
      status: 'warning',
    });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it("keeps the dialog open on a failure and shows pwc_tars's reason", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(
      within(row('FTP_Demo')).getByRole('button', { name: 'com_ui_tars_kb_ds_sync' }),
    );
    act(() =>
      mockRefreshOptions.current?.onError?.({
        response: { status: 502, data: { error: '重新處理檔案失敗: 530 Login incorrect.' } },
      }),
    );

    expect(mockShowToast).toHaveBeenCalledWith({
      message: '重新處理檔案失敗: 530 Login incorrect.',
      status: 'error',
    });
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });
});
