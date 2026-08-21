import { useMemo, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Switch,
  useToastContext,
} from '@librechat/client';
import type { TTarsDatasetLimits } from 'librechat-data-provider';
import { useUploadTarsDocumentsMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const DEFAULT_CHUNK = 300;
const DEFAULT_OVERLAP = 50;

interface PerFile {
  file: File;
  chunkSize: number;
  overlap: number;
}

/**
 * Uploads documents into a knowledge base.
 *
 * The three ceilings come from pwc_tars' own `sys_config` rows rather than
 * being hard-coded here — an install that raised `MAX_CHUNK_SIZE` should not
 * be blocked by a number baked into the client.
 */
export default function UploadDialog({
  knowledgeBaseId,
  limits,
  onClose,
}: {
  knowledgeBaseId: string;
  limits: TTarsDatasetLimits;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<PerFile[]>([]);
  const [processImages, setProcessImages] = useState(true);

  const uploadMutation = useUploadTarsDocumentsMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_uploaded'), status: 'success' });
      onClose();
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const addFiles = (selected: FileList | null) => {
    if (selected == null) {
      return;
    }
    const added = Array.from(selected).map((file) => ({
      file,
      chunkSize: DEFAULT_CHUNK,
      overlap: DEFAULT_OVERLAP,
    }));
    setFiles((prev) => [...prev, ...added]);
    /** Clear the input so re-picking the same file still fires a change. */
    if (fileRef.current != null) {
      fileRef.current.value = '';
    }
  };

  const setPerFile = (index: number, patch: Partial<PerFile>) =>
    setFiles((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));

  const tooManyFiles = files.length > limits.max_upload_counts;
  const invalidIndexes = useMemo(
    () =>
      new Set(
        files
          .map((entry, index) =>
            entry.chunkSize < 1 ||
            entry.chunkSize > limits.max_chunk_size ||
            entry.overlap < 0 ||
            entry.overlap > limits.max_overlap ||
            entry.overlap >= entry.chunkSize
              ? index
              : -1,
          )
          .filter((index) => index >= 0),
      ),
    [files, limits],
  );

  const canUpload =
    files.length > 0 && !tooManyFiles && invalidIndexes.size === 0 && !uploadMutation.isLoading;

  const upload = () => {
    const data = new FormData();
    files.forEach((entry) => data.append('files', entry.file));
    data.append('processImages', String(processImages));
    /** pwc_tars keys the per-file overrides by filename. */
    data.append(
      'fileSettings',
      JSON.stringify(
        Object.fromEntries(
          files.map((entry) => [
            entry.file.name,
            { chunkSize: entry.chunkSize, overlap: entry.overlap },
          ]),
        ),
      ),
    );
    uploadMutation.mutate(data);
  };

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !uploadMutation.isLoading && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_upload_documents')}
        className="w-11/12 md:max-w-3xl"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={
          <div className="max-h-[70vh] min-w-0 space-y-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="tars-doc-files">{localize('com_ui_tars_kb_choose_files')}</Label>
              <Input
                id="tars-doc-files"
                ref={fileRef}
                type="file"
                multiple
                onChange={(event) => addFiles(event.target.files)}
              />
              <p className={`text-xs ${tooManyFiles ? 'text-pwc-danger' : 'text-text-secondary'}`}>
                {localize('com_ui_tars_kb_ds_upload_limit', {
                  0: String(files.length),
                  1: String(limits.max_upload_counts),
                })}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border-light p-3">
              <Label htmlFor="tars-doc-vlm" className="text-sm">
                {localize('com_ui_tars_kb_process_images')}
              </Label>
              <Switch
                id="tars-doc-vlm"
                checked={processImages}
                onCheckedChange={setProcessImages}
                aria-label={localize('com_ui_tars_kb_process_images')}
              />
            </div>

            {files.length > 0 && (
              <div className="data-table-scroll max-h-64 overflow-auto rounded-lg border border-border-light">
                <table className="w-max min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-surface-secondary">
                    <tr className="text-left text-text-secondary">
                      <th className="px-3 py-2 font-medium">
                        {localize('com_ui_tars_kb_ds_name')}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {localize('com_ui_tars_kb_chunk_size')}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {localize('com_ui_tars_kb_overlap')}
                      </th>
                      <th className="w-10 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((entry, index) => (
                      <tr
                        key={`${entry.file.name}-${index}`}
                        className="border-t border-border-light"
                      >
                        <td className="max-w-[18rem] px-3 py-1.5">
                          <span className="block truncate" title={entry.file.name}>
                            {entry.file.name}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            type="number"
                            min={1}
                            max={limits.max_chunk_size}
                            value={entry.chunkSize}
                            onChange={(event) =>
                              setPerFile(index, { chunkSize: Number(event.target.value) })
                            }
                            aria-label={localize('com_ui_tars_kb_chunk_size')}
                            aria-invalid={invalidIndexes.has(index)}
                            className="w-28"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            type="number"
                            min={0}
                            max={limits.max_overlap}
                            value={entry.overlap}
                            onChange={(event) =>
                              setPerFile(index, { overlap: Number(event.target.value) })
                            }
                            aria-label={localize('com_ui_tars_kb_overlap')}
                            aria-invalid={invalidIndexes.has(index)}
                            className="w-28"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                            aria-label={localize('com_ui_delete')}
                            title={localize('com_ui_delete')}
                          >
                            <X className="size-4" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {invalidIndexes.size > 0 && (
              <p className="text-xs text-pwc-danger">
                {localize('com_ui_tars_kb_ds_chunk_invalid', {
                  0: String(limits.max_chunk_size),
                  1: String(limits.max_overlap),
                })}
              </p>
            )}
          </div>
        }
        buttons={
          <Button variant="submit" onClick={upload} disabled={!canUpload} className="gap-1.5">
            {uploadMutation.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {localize('com_ui_tars_kb_upload')}
          </Button>
        }
      />
    </OGDialog>
  );
}
