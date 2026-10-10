import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TTarsDatasetFileSystemLink } from 'librechat-data-provider';
import { boundFolderLabel, recordedChunkLabel } from '../helpers';
import SyncDialog from '../SyncDialog';

const localize = ((key: string, params?: Record<string, string>) =>
  params?.[0] != null ? `${key} ${params[0]}` : key) as Parameters<typeof boundFolderLabel>[2];

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const link = (overrides: Partial<TTarsDatasetFileSystemLink>): TTarsDatasetFileSystemLink => ({
  id: 'link-1',
  knowledge_base_id: 'kb-1',
  dataset_file_system_id: 'fs-1',
  name: 'Reports',
  status: 1,
  llm_model: null,
  schedule_id: null,
  is_sync_all: true,
  is_upload_only: false,
  directory_path: null,
  chunk_size: null,
  overlap_size: null,
  created_by: null,
  created_at: null,
  updated_at: null,
  ...overrides,
});

const LIMITS = { max_upload_counts: 5, max_chunk_size: 30000, max_overlap: 300 };

describe('boundFolderLabel', () => {
  it('names the folder the binding recorded', () => {
    expect(boundFolderLabel(link({ directory_path: '/test' }), '/', localize)).toBe('/test');
  });

  it("falls back to the file server's whole path, or just says so when it is not listed", () => {
    expect(boundFolderLabel(link({}), 'SharedFolder', localize)).toBe(
      'com_ui_tars_kb_ds_whole_source_path SharedFolder',
    );
    expect(boundFolderLabel(link({}), undefined, localize)).toBe('com_ui_tars_kb_ds_whole_source');
  });
});

describe('recordedChunkLabel', () => {
  it("shows the recorded chunking, or pwc_tars' default for older bindings", () => {
    expect(recordedChunkLabel(link({ chunk_size: 800, overlap_size: 80 }), localize)).toBe(
      '800 / 80',
    );
    expect(recordedChunkLabel(link({}), localize)).toBe(
      'com_ui_tars_kb_ds_chunk_default 1000 / 100',
    );
  });
});

describe('SyncDialog', () => {
  it('starts from the chunking the binding recorded', () => {
    render(
      <SyncDialog
        link={link({ chunk_size: 800, overlap_size: 80 })}
        limits={LIMITS}
        isBusy={false}
        onConfirm={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('com_ui_tars_kb_chunk_size')).toHaveValue(800);
    expect(screen.getByLabelText('com_ui_tars_kb_overlap')).toHaveValue(80);
  });
});
