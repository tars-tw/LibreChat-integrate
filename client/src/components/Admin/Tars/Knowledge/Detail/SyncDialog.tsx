import { useState } from 'react';
import { Button, Input, Label, OGDialog, OGDialogTemplate, Spinner } from '@librechat/client';
import type { TTarsDatasetFileSystemLink, TTarsDatasetLimits } from 'librechat-data-provider';
import { chunkSettingsInvalid, fileSystemLabel, recordedChunk } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * Confirms a document-group sync and collects the chunk size/overlap it
 * should use for files the sync finds new — files pwc_tars already has keep
 * whatever they were chunked with, so these only ever apply going forward.
 * Both start from what the binding recorded at import, which is what its
 * scheduled syncs use, so a manual sync chunks new files the same way.
 */
export default function SyncDialog({
  link,
  limits,
  isBusy,
  onConfirm,
  onClose,
}: {
  link: TTarsDatasetFileSystemLink;
  limits: TTarsDatasetLimits;
  isBusy: boolean;
  onConfirm: (params: { chunkSize: number; overlap: number }) => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const [chunkSize, setChunkSize] = useState(() => recordedChunk(link).chunkSize);
  const [overlap, setOverlap] = useState(() => recordedChunk(link).overlap);

  const invalid = chunkSettingsInvalid(chunkSize, overlap, limits);

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_ds_sync')}
        className="w-11/12 max-w-md"
        showCloseButton={true}
        main={
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_kb_ds_sync_description', { 0: fileSystemLabel(link) })}
            </p>
            <p className="text-xs text-text-secondary">
              {localize('com_ui_tars_kb_ds_sync_params_hint')}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tars-sync-chunk">{localize('com_ui_tars_kb_chunk_size')}</Label>
                <Input
                  id="tars-sync-chunk"
                  type="number"
                  min={1}
                  max={limits.max_chunk_size}
                  value={chunkSize}
                  onChange={(event) => setChunkSize(Number(event.target.value))}
                  aria-invalid={invalid}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tars-sync-overlap">{localize('com_ui_tars_kb_overlap')}</Label>
                <Input
                  id="tars-sync-overlap"
                  type="number"
                  min={0}
                  max={limits.max_overlap}
                  value={overlap}
                  onChange={(event) => setOverlap(Number(event.target.value))}
                  aria-invalid={invalid}
                />
              </div>
            </div>
            {invalid && (
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
          <Button
            variant="submit"
            disabled={invalid || isBusy}
            onClick={() => onConfirm({ chunkSize, overlap })}
          >
            {isBusy ? <Spinner className="size-4" /> : localize('com_ui_tars_kb_ds_sync')}
          </Button>
        }
      />
    </OGDialog>
  );
}
