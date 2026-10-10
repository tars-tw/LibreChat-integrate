import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TTarsDatasetFileSystemLink } from 'librechat-data-provider';
import FileSystemsTab from '../FileSystemsTab';

const mockIdleMutation = { mutate: jest.fn(), isLoading: false };

jest.mock('~/data-provider', () => ({
  useTarsFileSystemSourcesQuery: () => ({ data: [] }),
  useRebuildTarsFileSystemMutation: () => mockIdleMutation,
  useRefreshTarsFileSystemMutation: () => mockIdleMutation,
  useReprocessTarsFileSystemMutation: () => mockIdleMutation,
  useUnlinkTarsFileSystemMutation: () => mockIdleMutation,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
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
  screen.getByRole('checkbox', { name: `com_ui_tars_kb_ds_select_one ${name}` });

describe('FileSystemsTab batch unlink', () => {
  it('asks first, then unlinks the ticked groups by their file-system id', async () => {
    const user = userEvent.setup();
    const onBatchUnlink = renderTab();

    expect(screen.queryByRole('button', { name: /com_ui_tars_kb_ds_batch_unlink/ })).toBeNull();
    await user.click(tick('FTP_Demo'));
    await user.click(tick('SFTP_Demo'));
    await user.click(screen.getByRole('button', { name: /com_ui_tars_kb_ds_batch_unlink/ }));

    expect(screen.getByText('com_ui_tars_kb_ds_batch_unlink_confirm 2')).toBeInTheDocument();
    expect(onBatchUnlink).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'com_ui_tars_kb_ds_unlink' }));
    expect(onBatchUnlink).toHaveBeenCalledWith(['fs-1', 'fs-3']);
    expect(screen.queryByRole('button', { name: /com_ui_tars_kb_ds_batch_unlink/ })).toBeNull();
  });

  it('ticks every group on the page at once', async () => {
    const user = userEvent.setup();
    const onBatchUnlink = renderTab();

    await user.click(screen.getByRole('checkbox', { name: 'com_ui_tars_kb_ds_select_all' }));
    await user.click(screen.getByRole('button', { name: /com_ui_tars_kb_ds_batch_unlink/ }));
    await user.click(screen.getByRole('button', { name: 'com_ui_tars_kb_ds_unlink' }));

    expect(onBatchUnlink).toHaveBeenCalledWith(['fs-1', 'fs-2', 'fs-3']);
  });
});
