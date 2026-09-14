import type { TranslationKeys } from '~/hooks';

/** pwc_tars `Document.status` codes (see backend `sys_const.py`). */
export const DOC_STATUS = {
  uploaded: 0,
  processing: 1,
  completed: 2,
  failed: 4,
} as const;

type StatusMeta = { labelKey: TranslationKeys; className: string };

const STATUS_META: Record<number, StatusMeta> = {
  [DOC_STATUS.uploaded]: {
    labelKey: 'com_ui_tars_kb_status_uploaded',
    className: 'bg-surface-tertiary text-text-secondary',
  },
  [DOC_STATUS.processing]: {
    labelKey: 'com_ui_tars_kb_status_processing',
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  [DOC_STATUS.completed]: {
    labelKey: 'com_ui_tars_kb_status_completed',
    className: 'bg-green-500/15 text-green-600 dark:text-green-400',
  },
  [DOC_STATUS.failed]: {
    labelKey: 'com_ui_tars_kb_status_failed',
    className: 'bg-red-500/15 text-red-600 dark:text-red-400',
  },
};

export const getDocStatusMeta = (status: number): StatusMeta =>
  STATUS_META[status] ?? {
    labelKey: 'com_ui_tars_kb_status_uploaded',
    className: 'bg-surface-tertiary text-text-secondary',
  };

export const isProcessing = (status: number): boolean =>
  status === DOC_STATUS.uploaded || status === DOC_STATUS.processing;
