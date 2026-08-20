import { useRef } from 'react';
import { Paperclip, Upload, X } from 'lucide-react';
import { Button, useToastContext } from '@librechat/client';
import type { TTarsTicketAttachment } from 'librechat-data-provider';
import type { FileRejection } from './helpers';
import { FILE_ACCEPT, MAX_FILES, MAX_FILE_MB, formatBytes, mergeFiles } from './helpers';
import { useLocalize } from '~/hooks';

const REJECTION_KEYS = {
  type: 'com_ui_tars_issues_file_type_rejected',
  size: 'com_ui_tars_issues_file_size_rejected',
  count: 'com_ui_tars_issues_file_count_rejected',
} as const;

/** Attachments already on the ticket. pwc_tars never removes these on an edit. */
export function ExistingAttachments({
  attachments,
  error,
}: {
  attachments: TTarsTicketAttachment[];
  error?: string | null;
}) {
  const localize = useLocalize();

  return (
    <div className="space-y-1">
      {attachments.length === 0 ? (
        <p className="text-xs text-text-secondary">{localize('com_ui_tars_issues_no_files')}</p>
      ) : (
        <ul className="space-y-1">
          {attachments.map((attachment, index) => (
            <li
              key={attachment.id ?? `${attachment.filename ?? index}`}
              className="flex items-center gap-2 text-sm text-text-primary"
            >
              <Paperclip className="size-3.5 shrink-0 text-text-secondary" aria-hidden />
              <span className="truncate">{attachment.filename ?? attachment.original_name}</span>
              {attachment.size != null && (
                <span className="shrink-0 text-xs text-text-secondary">
                  ({formatBytes(attachment.size)})
                </span>
              )}
              {attachment.uploader != null && attachment.uploader !== '' && (
                <span className="shrink-0 text-xs text-text-secondary">
                  — {attachment.uploader}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error != null && error !== '' && (
        <p className="text-xs text-text-secondary">
          {localize('com_ui_tars_issues_attachments_error', { 0: error })}
        </p>
      )}
    </div>
  );
}

/** Picker for the files that will ride along with the next submit. */
export default function FilePicker({
  files,
  onChange,
  disabled,
  addLabel,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  addLabel: string;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    const { files: accepted, rejected } = mergeFiles(files, picked);
    for (const item of rejected) {
      showToast({
        message: localize(REJECTION_KEYS[item.reason as FileRejection], {
          0: item.name,
          1: String(item.reason === 'count' ? MAX_FILES : MAX_FILE_MB),
        }),
        status: 'error',
      });
    }
    onChange(accepted);
    event.target.value = '';
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled === true || files.length >= MAX_FILES}
        >
          <Paperclip className="mr-1 size-4" aria-hidden />
          {addLabel}
        </Button>
        <span className="text-xs text-text-secondary">
          {localize('com_ui_tars_issues_file_hint', {
            0: String(MAX_FILES),
            1: String(MAX_FILE_MB),
          })}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={handlePick}
        aria-label={addLabel}
      />
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li
              key={file.name}
              className="flex items-center justify-between gap-2 text-sm text-text-primary"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Upload className="size-3.5 shrink-0 text-text-secondary" aria-hidden />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-text-secondary">
                  ({formatBytes(file.size)})
                </span>
              </span>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-text-secondary hover:text-red-500"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                aria-label={localize('com_ui_tars_issues_remove_file', { 0: file.name })}
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
