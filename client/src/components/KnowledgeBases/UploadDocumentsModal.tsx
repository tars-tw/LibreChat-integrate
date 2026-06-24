import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import {
  Button,
  Label,
  Input,
  Switch,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsFileSetting } from 'librechat-data-provider';
import { useUploadTarsDocumentsMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

type PerFile = { file: File; chunkSize: number; overlap: number };

const DEFAULT_CHUNK = 300;
const DEFAULT_OVERLAP = 50;

export default function UploadDocumentsModal({
  knowledgeBaseId,
  open,
  onOpenChange,
}: {
  knowledgeBaseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PerFile[]>([]);
  const [processImages, setProcessImages] = useState(true);

  const reset = () => {
    setFiles([]);
    setProcessImages(true);
  };

  const uploadMutation = useUploadTarsDocumentsMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_uploaded'), status: 'success' });
      reset();
      onOpenChange(false);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const addFiles = (selected: FileList | null) => {
    if (!selected) {
      return;
    }
    const added = Array.from(selected).map((file) => ({
      file,
      chunkSize: DEFAULT_CHUNK,
      overlap: DEFAULT_OVERLAP,
    }));
    setFiles((prev) => [...prev, ...added]);
  };

  const updateSetting = (index: number, key: 'chunkSize' | 'overlap', value: number) =>
    setFiles((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)));

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = () => {
    if (files.length === 0) {
      showToast({ message: localize('com_ui_tars_kb_upload_required'), status: 'error' });
      return;
    }
    const data = new FormData();
    data.append('chunkSize', String(DEFAULT_CHUNK));
    data.append('overlap', String(DEFAULT_OVERLAP));
    data.append('processImages', String(processImages));
    const fileSettings: Record<string, TTarsFileSetting> = {};
    for (const item of files) {
      fileSettings[item.file.name] = { chunkSize: item.chunkSize, overlap: item.overlap };
      data.append('files', item.file);
    }
    data.append('fileSettings', JSON.stringify(fileSettings));
    uploadMutation.mutate(data);
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_upload_documents')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-1">
                <Upload className="icon-sm" /> {localize('com_ui_tars_kb_choose_files')}
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary">
                  {localize('com_ui_tars_kb_process_images')}
                </span>
                <Switch
                  checked={processImages}
                  onCheckedChange={setProcessImages}
                  aria-label={localize('com_ui_tars_kb_process_images')}
                />
              </div>
            </div>

            {files.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-secondary">
                {localize('com_ui_tars_kb_no_files_selected')}
              </p>
            ) : (
              <div className="max-h-[40vh] space-y-2 overflow-y-auto">
                {files.map((item, index) => (
                  <div
                    key={`${item.file.name}-${index}`}
                    className="flex items-center gap-3 rounded-lg border border-border-light p-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                      {item.file.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-text-secondary">
                        {localize('com_ui_tars_kb_chunk_size')}
                      </Label>
                      <Input
                        type="number"
                        value={item.chunkSize}
                        onChange={(e) => updateSetting(index, 'chunkSize', Number(e.target.value))}
                        className="h-8 w-20"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-text-secondary">
                        {localize('com_ui_tars_kb_overlap')}
                      </Label>
                      <Input
                        type="number"
                        value={item.overlap}
                        onChange={(e) => updateSetting(index, 'overlap', Number(e.target.value))}
                        className="h-8 w-20"
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={localize('com_ui_delete')}
                      onClick={() => removeFile(index)}
                      className="rounded p-1.5 text-text-secondary hover:bg-surface-hover"
                    >
                      <X className="icon-sm" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSubmit} disabled={uploadMutation.isLoading}>
            {uploadMutation.isLoading ? <Spinner /> : localize('com_ui_tars_kb_upload')}
          </Button>
        }
      />
    </OGDialog>
  );
}
