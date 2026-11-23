import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type {
  TTarsFileSystemSyncResult,
  TTarsDatasetFileSystemLink,
  TTarsDatasetLimits,
} from 'librechat-data-provider';
import type { Localize } from '../helpers';
import { syncResultToast } from '../helpers';
import SyncDialog from '../SyncDialog';

/** Spells out every argument, so a line shows which numbers and names it was given. */
const localizeStub = (key: string, params?: Record<string, string>) =>
  params != null ? `${key} ${Object.values(params).join('|')}` : key;

jest.mock('~/hooks', () => ({
  useLocalize: () => localizeStub,
}));

const LIMITS: TTarsDatasetLimits = {
  max_upload_counts: 5,
  max_chunk_size: 30000,
  max_overlap: 300,
};

const link = (isSyncAll: boolean): TTarsDatasetFileSystemLink => ({
  id: 'assoc-1',
  knowledge_base_id: 'kb-1',
  dataset_file_system_id: 'fs-1',
  name: 'FTP_Demo',
  status: 1,
  llm_model: null,
  schedule_id: null,
  is_sync_all: isSyncAll,
  is_upload_only: false,
  directory_path: '/test2',
  chunk_size: 800,
  overlap_size: 80,
  created_by: null,
  created_at: null,
  updated_at: null,
});

const renderDialog = (isSyncAll: boolean) => {
  const onConfirm = jest.fn();
  render(
    <SyncDialog
      link={link(isSyncAll)}
      limits={LIMITS}
      isBusy={false}
      onConfirm={onConfirm}
      onClose={jest.fn()}
    />,
  );
  return onConfirm;
};

const confirm = () => screen.getByRole('button', { name: 'com_ui_tars_kb_ds_sync' });

describe('SyncDialog', () => {
  it('tells a selected-files group that new source files stay out', async () => {
    const onConfirm = renderDialog(false);

    expect(screen.getByText('com_ui_tars_kb_ds_sync_selected_note')).toBeInTheDocument();
    expect(
      screen.getByText('com_ui_tars_kb_ds_sync_description_selected FTP_Demo'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('com_ui_tars_kb_chunk_size')).not.toBeInTheDocument();

    await userEvent.click(confirm());

    expect(onConfirm).toHaveBeenCalledWith({ chunkSize: 800, overlap: 80, syncAll: false });
  });

  it('asks for chunking once the switch lets new files in, and sends the switch', async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog(false);

    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_kb_ds_sync_switch_all' }));

    expect(screen.getByText('com_ui_tars_kb_ds_sync_description FTP_Demo')).toBeInTheDocument();
    const chunk = screen.getByLabelText('com_ui_tars_kb_chunk_size');
    await user.clear(chunk);
    await user.type(chunk, '1200');
    await user.click(confirm());

    expect(onConfirm).toHaveBeenCalledWith({ chunkSize: 1200, overlap: 80, syncAll: true });
  });

  it('keeps a bad chunk setting from going out with the switch', async () => {
    const user = userEvent.setup();
    renderDialog(false);

    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_kb_ds_sync_switch_all' }));
    await user.clear(screen.getByLabelText('com_ui_tars_kb_overlap'));
    await user.type(screen.getByLabelText('com_ui_tars_kb_overlap'), '900');

    expect(confirm()).toBeDisabled();
  });

  it('offers no switch to a group that already syncs everything', async () => {
    const onConfirm = renderDialog(true);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText('com_ui_tars_kb_ds_sync_selected_note')).not.toBeInTheDocument();
    expect(screen.getByLabelText('com_ui_tars_kb_chunk_size')).toHaveValue(800);

    await userEvent.click(confirm());

    expect(onConfirm).toHaveBeenCalledWith({ chunkSize: 800, overlap: 80, syncAll: false });
  });
});

const result = (overrides: Partial<TTarsFileSystemSyncResult> = {}): TTarsFileSystemSyncResult => ({
  total_updated: 2,
  total_failed: 0,
  failed_files: [],
  deleted_count: 1,
  deletion_notices: [],
  is_sync_all: false,
  status: 'success',
  ...overrides,
});

const localize = localizeStub as Localize;

describe('syncResultToast', () => {
  it('reports the counts of a plain sync', () => {
    expect(syncResultToast(result(), false, localize)).toEqual({
      message: 'com_ui_tars_kb_ds_sync_done 2|0|1',
      status: 'success',
    });
  });

  it('confirms the switch only when pwc_tars reports the group syncing everything', () => {
    expect(syncResultToast(result({ is_sync_all: true }), true, localize)).toEqual({
      message: 'com_ui_tars_kb_ds_sync_done 2|0|1\ncom_ui_tars_kb_ds_sync_switched',
      status: 'success',
    });
    for (const isSyncAll of [false, null]) {
      expect(syncResultToast(result({ is_sync_all: isSyncAll }), true, localize)).toEqual({
        message: 'com_ui_tars_kb_ds_sync_done 2|0|1\ncom_ui_tars_kb_ds_sync_switch_failed',
        status: 'warning',
      });
    }
  });

  it('lists failures and deferred deletions, then counts what it leaves out', () => {
    const failed_files = Array.from({ length: 6 }, (_, i) => ({
      file: `f${i}.pdf`,
      reason: '下載失敗',
    }));
    const toast = syncResultToast(
      result({
        total_failed: 6,
        failed_files,
        deletion_notices: ['「old.pdf」：已延後刪除'],
        status: 'warning',
      }),
      false,
      localize,
    );

    expect(toast.status).toBe('warning');
    expect(toast.message.split('\n')).toEqual([
      'com_ui_tars_kb_ds_sync_done 2|6|1',
      ...failed_files
        .slice(0, 5)
        .map(({ file }) => `com_ui_tars_kb_ds_sync_failed_file ${file}|下載失敗`),
      'com_ui_tars_kb_ds_sync_more 2',
    ]);
  });
});
