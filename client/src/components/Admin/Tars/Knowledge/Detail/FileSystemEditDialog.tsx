import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Button,
  Checkbox,
  Dropdown,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Switch,
} from '@librechat/client';
import type { TTarsDatasetFileSystemLink, TTarsDatasetLimits } from 'librechat-data-provider';
import { chunkSettingsInvalid, fileSystemLabel, recordedChunk } from './helpers';
import { useTarsFileSystemFilesQuery } from '~/data-provider';
import { discoverFolders } from '../../FileSystems/helpers';
import { relayedError } from '../helpers';
import { useLocalize } from '~/hooks';

/** `Dropdown` skips an option whose value is `''`, so "the whole source" needs its own value. */
const WHOLE_SOURCE = '__all__';

/** A file's own chunking where it departs from the association's; unset fields follow it. */
type ChunkOverride = { chunkSize?: number; overlap?: number };

export type EditFile = { path: string; chunkSize: number; overlap: number };
export type EditValue = { folder: string; syncAll: boolean; files: EditFile[] };

const directoryOf = (file: string): string => {
  const cut = file.lastIndexOf('/');
  return cut === -1 ? '' : file.slice(0, cut).replace(/^\/+/, '');
};

const fileNameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

const isInFolder = (file: string, folder: string): boolean => {
  if (folder === '') {
    return true;
  }
  const directory = directoryOf(file);
  return directory === folder || directory.startsWith(`${folder}/`);
};

/**
 * Re-points one document-group association at another folder, or at a different
 * set of files, each with its own chunking. The association's schedule and its
 * recorded chunking are kept; the caller sends the request and closes this
 * dialog, so the work carries on in the background.
 */
export default function FileSystemEditDialog({
  knowledgeBaseId,
  link,
  limits,
  onConfirm,
  onClose,
}: {
  knowledgeBaseId: string;
  link: TTarsDatasetFileSystemLink;
  limits: TTarsDatasetLimits;
  onConfirm: (value: EditValue) => void;
  onClose: () => void;
}) {
  const localize = useLocalize();

  const base = useMemo(() => recordedChunk(link), [link]);
  const currentFolder = (link.directory_path ?? '').replace(/^\/+/, '');
  const [folder, setFolder] = useState(currentFolder === '' ? WHOLE_SOURCE : currentFolder);
  const [syncAll, setSyncAll] = useState(link.is_sync_all === true);
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ChunkOverride>>({});
  const [filter, setFilter] = useState('');

  const filesQuery = useTarsFileSystemFilesQuery(knowledgeBaseId, link.dataset_file_system_id);
  const allFiles = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);

  const boundFolder = folder === WHOLE_SOURCE ? '' : folder;
  const folders = useMemo(() => discoverFolders(allFiles), [allFiles]);
  const folderOptions = useMemo(() => {
    const values =
      currentFolder !== '' && !folders.includes(currentFolder)
        ? [currentFolder, ...folders]
        : folders;
    return [
      { value: WHOLE_SOURCE, label: localize('com_ui_tars_kb_ds_whole_source') },
      ...values.map((value) => ({ value, label: value })),
    ];
  }, [folders, currentFolder, localize]);

  const scopedFiles = useMemo(
    () => allFiles.filter((file) => isInFolder(file, boundFolder)),
    [allFiles, boundFolder],
  );
  const visibleFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === ''
      ? scopedFiles
      : scopedFiles.filter((file) => file.toLowerCase().includes(needle));
  }, [scopedFiles, filter]);

  /** A tick outside the new folder would pull in a file the association no longer covers. */
  const changeFolder = (value: string) => {
    setFolder(value);
    setSelected([]);
  };

  const toggle = (file: string) =>
    setSelected((prev) => (prev.includes(file) ? prev.filter((v) => v !== file) : [...prev, file]));

  const allVisibleSelected =
    visibleFiles.length > 0 && visibleFiles.every((file) => selected.includes(file));
  const toggleAllVisible = (checked: boolean) => {
    const visible = new Set(visibleFiles);
    setSelected((prev) =>
      checked
        ? [...prev.filter((file) => !visible.has(file)), ...visibleFiles]
        : prev.filter((file) => !visible.has(file)),
    );
  };

  const settingsOf = (file: string) => ({
    chunkSize: overrides[file]?.chunkSize ?? base.chunkSize,
    overlap: overrides[file]?.overlap ?? base.overlap,
  });

  const setOverride = (file: string, patch: ChunkOverride) =>
    setOverrides((prev) => ({ ...prev, [file]: { ...prev[file], ...patch } }));

  /**
   * Taking everything still sends the whole listing: pwc_tars checks its file
   * limit against the files in the request, so leaving them out would skip it.
   */
  const filesToSend = syncAll ? scopedFiles : selected;

  const invalidFiles = new Set(
    filesToSend.filter((file) => {
      const settings = settingsOf(file);
      return chunkSettingsInvalid(settings.chunkSize, settings.overlap, limits);
    }),
  );

  const canConfirm = filesQuery.isSuccess && filesToSend.length > 0 && invalidFiles.size === 0;

  const submit = () => {
    if (!canConfirm) {
      return;
    }
    onConfirm({
      folder: boundFolder,
      syncAll,
      files: filesToSend.map((path) => ({ path, ...settingsOf(path) })),
    });
  };

  const body = () => {
    if (filesQuery.isLoading || filesQuery.isFetching) {
      return (
        <div className="text-text-secondary flex h-32 items-center justify-center gap-2 text-sm">
          <Spinner className="size-4" />
          {localize('com_ui_tars_kb_ds_connecting')}
        </div>
      );
    }
    if (filesQuery.isError) {
      return (
        <p className="text-text-destructive text-sm">
          {relayedError(filesQuery.error) ?? localize('com_ui_tars_kb_ds_connect_failed')}
        </p>
      );
    }

    return (
      <>
        <div className="space-y-1.5">
          <Label id="tars-fs-edit-folder-label">{localize('com_ui_tars_kb_ds_bind_folder')}</Label>
          <Dropdown
            value={folder}
            onChange={changeFolder}
            options={folderOptions}
            aria-labelledby="tars-fs-edit-folder-label"
            searchable={folderOptions.length > 8}
            searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
            searchEmptyText={localize('com_ui_no_results_found')}
            sizeClasses="w-full"
            className="w-full"
          />
          <p
            className={`text-xs ${boundFolder !== '' ? 'text-accent-primary' : 'text-text-secondary'}`}
          >
            {boundFolder !== ''
              ? localize('com_ui_tars_kb_ds_folder_bound_hint', { 0: boundFolder })
              : localize('com_ui_tars_kb_ds_whole_source_hint')}
          </p>
        </div>

        <div className="border-border-light space-y-1 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tars-fs-edit-sync-all" className="text-sm">
              {localize(
                boundFolder !== ''
                  ? 'com_ui_tars_kb_ds_sync_all_folder'
                  : 'com_ui_tars_kb_ds_sync_all_source',
              )}
            </Label>
            <Switch
              id="tars-fs-edit-sync-all"
              checked={syncAll}
              onCheckedChange={setSyncAll}
              aria-label={localize('com_ui_tars_kb_ds_sync_all')}
            />
          </div>
          <p className="text-text-secondary text-xs">
            {localize('com_ui_tars_kb_ds_sync_all_hint')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="border-border-control focus-within:border-border-heavy flex min-w-0 flex-1 items-center rounded-lg border ps-3">
            <Search className="text-text-secondary size-4 shrink-0" aria-hidden />
            <Input
              variant="flush"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={localize('com_ui_tars_audit_search_placeholder')}
              aria-label={localize('com_ui_tars_kb_ds_filter_files')}
            />
          </div>
          <span className="text-text-secondary shrink-0 text-sm">
            {syncAll
              ? `${localize('com_ui_tars_kb_ds_total')}: ${scopedFiles.length}`
              : localize('com_ui_tars_audit_selected_count', { 0: String(selected.length) })}
          </span>
        </div>

        <p className="text-text-secondary text-xs">
          {localize('com_ui_tars_kb_ds_edit_chunk_hint', {
            0: `${base.chunkSize} / ${base.overlap}`,
          })}
        </p>

        {visibleFiles.length === 0 ? (
          <p className="text-text-secondary py-8 text-center text-sm">
            {localize('com_ui_tars_kb_ds_no_remote_files')}
          </p>
        ) : (
          <div className="border-border-light max-h-72 overflow-auto rounded-lg border">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <thead className="bg-surface-secondary sticky top-0 z-10">
                <tr className="text-text-secondary text-left">
                  <th className="w-10 px-3 py-2">
                    {!syncAll && (
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                        aria-label={localize('com_ui_tars_kb_ds_select_all')}
                      />
                    )}
                  </th>
                  <th className="w-10 px-2 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">{localize('com_ui_tars_fs_file_name')}</th>
                  <th className="px-3 py-2 font-medium">
                    {localize('com_ui_tars_fs_file_directory')}
                  </th>
                  <th className="w-28 px-2 py-2 font-medium">
                    {localize('com_ui_tars_kb_chunk_size')}
                  </th>
                  <th className="w-28 px-2 py-2 font-medium">
                    {localize('com_ui_tars_kb_overlap')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles.map((file, index) => {
                  const settings = settingsOf(file);
                  const invalid = invalidFiles.has(file);
                  const directory = directoryOf(file);
                  return (
                    <tr key={file} className="border-border-light hover:bg-surface-hover border-t">
                      <td className="px-3 py-1">
                        {!syncAll && (
                          <Checkbox
                            checked={selected.includes(file)}
                            onCheckedChange={() => toggle(file)}
                            aria-label={localize('com_ui_tars_kb_ds_select_item', { 0: file })}
                          />
                        )}
                      </td>
                      <td className="text-text-secondary px-2 py-1 tabular-nums">{index + 1}</td>
                      <td className="max-w-[20rem] px-3 py-1">
                        <span className="text-text-primary block truncate" title={file}>
                          {fileNameOf(file)}
                        </span>
                      </td>
                      <td className="max-w-[16rem] px-3 py-1">
                        <span className="text-text-secondary block truncate" title={directory}>
                          {directory === '' ? '—' : directory}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min={1}
                          max={limits.max_chunk_size}
                          value={settings.chunkSize}
                          onChange={(event) =>
                            setOverride(file, { chunkSize: Number(event.target.value) })
                          }
                          aria-label={`${localize('com_ui_tars_kb_chunk_size')} ${file}`}
                          aria-invalid={invalid}
                          className="h-8 w-24 text-right"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min={0}
                          max={limits.max_overlap}
                          value={settings.overlap}
                          onChange={(event) =>
                            setOverride(file, { overlap: Number(event.target.value) })
                          }
                          aria-label={`${localize('com_ui_tars_kb_overlap')} ${file}`}
                          aria-invalid={invalid}
                          className="h-8 w-24 text-right"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {invalidFiles.size > 0 && (
          <p className="text-text-destructive text-xs">
            {localize('com_ui_tars_kb_ds_chunk_invalid', {
              0: String(limits.max_chunk_size),
              1: String(limits.max_overlap),
            })}
          </p>
        )}
      </>
    );
  };

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_ds_edit_title', { 0: fileSystemLabel(link) })}
        className="w-11/12 md:max-w-5xl"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={
          <div className="max-h-[70vh] min-w-0 space-y-4 overflow-y-auto pr-1">
            <p className="text-text-secondary text-xs">
              {localize('com_ui_tars_kb_ds_edit_current', {
                0:
                  currentFolder === '' ? localize('com_ui_tars_kb_ds_whole_source') : currentFolder,
              })}
            </p>
            <p className="text-text-destructive text-xs">
              {localize('com_ui_tars_kb_ds_edit_warning')}
            </p>
            {body()}
          </div>
        }
        buttons={
          <Button variant="submit" onClick={submit} disabled={!canConfirm}>
            {localize('com_ui_tars_kb_ds_edit_confirm')}
          </Button>
        }
      />
    </OGDialog>
  );
}
