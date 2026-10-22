import type { TranslationKeys } from '~/hooks';

/** The files a traced turn could read, as the overview lists them and the panel downloads them. */

/**
 * How each long-term-memory file reached the model, in listing order. `provider`
 * is LibreChat's: a document such as a PDF that the model's provider read itself.
 */
const MEMORY_DOCUMENT_LABEL_KEYS: [string, TranslationKeys][] = [
  ['summary', 'com_ui_tars_audit_trace_file_content_injected'],
  ['provider', 'com_ui_tars_audit_trace_original_file_sent'],
  ['image', 'com_ui_tars_audit_trace_image_sent'],
  ['data_file', 'com_ui_tars_audit_trace_mounted_as_file'],
  ['attachment', 'com_ui_tars_audit_trace_attachment_kept'],
];

/** The id a long-term-memory document downloads by: a LibreChat attachment's `file_id`, else a pwc_tars document's `id`. */
export const memoryDocumentId = (document: {
  id?: string | null;
  file_id?: string | null;
}): string | null => document.file_id || document.id || null;

/** A long-term-memory row's documents, grouped by how each reached the model; other kinds are left out. */
export function labeledMemoryDocuments<T extends { injected_as?: string | null }>(
  documents: readonly T[],
): { labelKey: TranslationKeys; document: T }[] {
  return MEMORY_DOCUMENT_LABEL_KEYS.flatMap(([injectedAs, labelKey]) =>
    documents
      .filter((document) => document.injected_as === injectedAs)
      .map((document) => ({ labelKey, document })),
  );
}

/** One file in the overview's attachment list. */
export type OverviewAttachment = {
  id: string | null;
  filename: string;
  /** How it reached the model (`injected_as`), which picks its icon. */
  injectedAs: string;
  labelKey: TranslationKeys;
  /** Uploaded with this message rather than in an earlier turn. */
  current: boolean;
};

/**
 * Every file the turn could read, once each, this message's uploads first.
 * A LibreChat trace names this message's uploads by `file_id`; pwc_tars's own
 * trace names only the one file, by `upload_filename`.
 */
export function overviewAttachments(
  documents: readonly {
    id?: string | null;
    file_id?: string | null;
    filename?: string | null;
    injected_as?: string | null;
  }[],
  upload: {
    files?: { file_id?: string | null }[] | null;
    filename?: string | null;
  },
): OverviewAttachment[] {
  const uploadedIds = new Set((upload.files ?? []).map((file) => file.file_id).filter(Boolean));
  const isCurrent = (document: { file_id?: string | null; filename?: string | null }) =>
    uploadedIds.size > 0
      ? uploadedIds.has(document.file_id ?? '')
      : !!upload.filename && document.filename === upload.filename;
  const files = labeledMemoryDocuments(documents).flatMap(({ labelKey, document }) =>
    document.filename && document.injected_as
      ? [
          {
            id: memoryDocumentId(document),
            filename: document.filename,
            injectedAs: document.injected_as,
            labelKey,
            current: isCurrent(document),
          },
        ]
      : [],
  );
  return [...files.filter((file) => file.current), ...files.filter((file) => !file.current)];
}
