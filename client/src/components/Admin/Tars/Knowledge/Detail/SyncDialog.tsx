import { useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Switch,
} from '@librechat/client';
import type { TTarsDatasetFileSystemLink, TTarsDatasetLimits } from 'librechat-data-provider';
import { chunkSettingsInvalid, fileSystemLabel, recordedChunk } from './helpers';
import { useLocalize } from '~/hooks';

export type SyncParams = { chunkSize: number; overlap: number; syncAll: boolean };

/**
 * Confirms a document-group sync. Every sync updates the files the group
 * holds and removes those gone from the source; only a group that syncs
 * everything also brings in new ones. A group imported from selected files
 * says so here and offers to switch to syncing everything, which pwc_tars
 * keeps once the sync succeeds.
 *
 * The chunk size/overlap apply only to files the sync finds new — files
 * pwc_tars already has keep whatever they were chunked with — so they are
 * asked for only when new files can come in. Both start from what the binding
 * recorded at import, which is what its scheduled syncs use.
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
  onConfirm: (params: SyncParams) => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const [chunkSize, setChunkSize] = useState(() => recordedChunk(link).chunkSize);
  const [overlap, setOverlap] = useState(() => recordedChunk(link).overlap);
  const [switchToAll, setSwitchToAll] = useState(false);

  const selectedOnly = link.is_sync_all !== true;
  const syncAll = selectedOnly && switchToAll;
  const takesNewFiles = !selectedOnly || syncAll;
  const invalid = takesNewFiles && chunkSettingsInvalid(chunkSize, overlap, limits);

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_ds_sync')}
        className="w-11/12 max-w-md"
        showCloseButton={true}
        main={
          <div className="space-y-3">
            <p className="text-text-secondary text-sm">
              {localize(
                takesNewFiles
                  ? 'com_ui_tars_kb_ds_sync_description'
                  : 'com_ui_tars_kb_ds_sync_description_selected',
                { 0: fileSystemLabel(link) },
              )}
            </p>
            {selectedOnly && (
              <>
                <Alert variant="info" role="note">
                  {localize('com_ui_tars_kb_ds_sync_selected_note')}
                </Alert>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="tars-sync-all" className="text-sm">
                      {localize('com_ui_tars_kb_ds_sync_switch_all')}
                    </Label>
                    <Switch
                      id="tars-sync-all"
                      checked={switchToAll}
                      onCheckedChange={setSwitchToAll}
                      disabled={isBusy}
                      aria-label={localize('com_ui_tars_kb_ds_sync_switch_all')}
                    />
                  </div>
                  <p className="text-text-secondary text-xs">
                    {localize('com_ui_tars_kb_ds_sync_switch_all_hint')}
                  </p>
                </div>
              </>
            )}
            {takesNewFiles && (
              <div className="border-border-light space-y-3 border-t pt-3">
                <p className="text-text-secondary text-xs">
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
                  <p className="text-pwc-danger text-xs">
                    {localize('com_ui_tars_kb_ds_chunk_invalid', {
                      0: String(limits.max_chunk_size),
                      1: String(limits.max_overlap),
                    })}
                  </p>
                )}
              </div>
            )}
          </div>
        }
        buttons={
          <Button
            variant="submit"
            disabled={invalid || isBusy}
            onClick={() => onConfirm({ chunkSize, overlap, syncAll })}
          >
            {isBusy ? <Spinner className="size-4" /> : localize('com_ui_tars_kb_ds_sync')}
          </Button>
        }
      />
    </OGDialog>
  );
}
