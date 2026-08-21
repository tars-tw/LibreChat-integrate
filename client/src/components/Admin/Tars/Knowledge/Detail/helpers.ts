import type { TTarsDatasetFileSystemLink, TTarsDatasetWebsite } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/** pwc_tars `Document.status` codes (backend `sys_const.py`). */
export const DOC_STATUS = {
  uploaded: 0,
  processing: 1,
  completed: 2,
  failed: 4,
} as const;

export interface StatusMeta {
  labelKey: TranslationKeys;
  className: string;
  /**
   * PwC's palette has no green — `--pwc-success` is amber, the same family as
   * `--pwc-warning` — so colour alone cannot separate "processing" from
   * "completed". Processing carries a spinner instead, which reads as motion
   * regardless of hue.
   */
  spinning?: boolean;
}

const STATUS_META: Record<number, StatusMeta> = {
  [DOC_STATUS.uploaded]: {
    labelKey: 'com_ui_tars_kb_status_uploaded',
    className: 'bg-surface-tertiary text-text-secondary',
  },
  [DOC_STATUS.processing]: {
    labelKey: 'com_ui_tars_kb_status_processing',
    className: 'bg-surface-tertiary text-text-secondary',
    spinning: true,
  },
  [DOC_STATUS.completed]: {
    labelKey: 'com_ui_tars_kb_status_completed',
    className: 'bg-pwc-success/15 text-pwc-success',
  },
  [DOC_STATUS.failed]: {
    labelKey: 'com_ui_tars_kb_status_failed',
    className: 'bg-pwc-danger/10 text-pwc-danger',
  },
};

export const docStatusMeta = (status: number | null | undefined): StatusMeta =>
  STATUS_META[status ?? DOC_STATUS.uploaded] ?? STATUS_META[DOC_STATUS.uploaded];

export const isProcessing = (status: number | null | undefined): boolean =>
  status === DOC_STATUS.uploaded || status === DOC_STATUS.processing;

/**
 * Websites and document groups use a different scale from documents: pwc_tars
 * stores 1 for enabled and 0 for imported-but-inactive on those rows.
 */
export const enabledStatusMeta = (status: number | null | undefined): StatusMeta =>
  status === 1
    ? {
        labelKey: 'com_ui_tars_kb_ds_enabled',
        className: 'bg-pwc-success/15 text-pwc-success',
      }
    : {
        labelKey: 'com_ui_tars_kb_ds_disabled',
        className: 'bg-surface-tertiary text-text-secondary',
      };

/** Matches the name filter on every tab: case-insensitive, name only. */
export const matchesName = (name: string | null | undefined, search: string): boolean => {
  const query = search.trim().toLowerCase();
  return query === '' || (name ?? '').toLowerCase().includes(query);
};

export const websiteLabel = (website: TTarsDatasetWebsite): string =>
  website.name ?? website.url ?? website.id;

export const fileSystemLabel = (link: TTarsDatasetFileSystemLink): string =>
  link.name ?? link.dataset_file_system_id;

/** `Intl` handles the units; this only keeps the call sites short. */
export const formatCount = (value: number | null | undefined): string =>
  (value ?? 0).toLocaleString();
