import { useEffect, useMemo, useState } from 'react';
import { Eye, Search } from 'lucide-react';
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
  useToastContext,
} from '@librechat/client';
import type { TTarsDatasetFileSystemLink, TTarsDatasetLimits } from 'librechat-data-provider';
import {
  useImportTarsFileSystemMutation,
  useTarsFileSystemFilesQuery,
  useTarsFileSystemSourcesQuery,
} from '~/data-provider';
import { FILE_SYSTEM_DEFAULT_CHUNK, chunkSettingsInvalid } from './helpers';
import { discoverFolders } from '../../FileSystems/helpers';
import { relayedError } from '../helpers';
import { useLocalize } from '~/hooks';

/**
 * `Dropdown` treats an option value of `''` as "nothing selected" and skips
 * rendering its label, so "bind the whole source" needs a value that is not empty.
 */
const WHOLE_SOURCE = '__all__';

/**
 * A listed file's folder, without the leading slash `discoverFolders` drops,
 * so the two compare on every protocol.
 */
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

/** A file's own chunking where it departs from the group's; unset fields follow the group. */
type ChunkOverride = { chunkSize?: number; overlap?: number };

/**
 * Binds a document group to this knowledge base, the way pwc_tars' own form does.
 *
 * The folder picked here is recorded on the binding: the import and every
 * scheduled sync after it stay inside that folder. Within it, either every file
 * is taken — and later syncs keep adding new ones — or only the files ticked.
 * The group's chunking is recorded too, so files a sync finds later get the
 * same; a listed file can override it for itself.
 */
export default function FileSystemImportDialog({
  knowledgeBaseId,
  linked,
  limits,
  onClose,
}: {
  knowledgeBaseId: string;
  linked: TTarsDatasetFileSystemLink[];
  limits: TTarsDatasetLimits;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const sourcesQuery = useTarsFileSystemSourcesQuery(knowledgeBaseId);
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [syncAll, setSyncAll] = useState(false);
  const [uploadOnly, setUploadOnly] = useState(false);
  const [chunkSize, setChunkSize] = useState<number>(FILE_SYSTEM_DEFAULT_CHUNK.chunkSize);
  const [overlap, setOverlap] = useState<number>(FILE_SYSTEM_DEFAULT_CHUNK.overlap);
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ChunkOverride>>({});
  const [filter, setFilter] = useState('');
  const [folder, setFolder] = useState(WHOLE_SOURCE);
  /** Only set once asked, so opening the dialog does not walk a remote tree. */
  const [browseId, setBrowseId] = useState<string | null>(null);

  const filesQuery = useTarsFileSystemFilesQuery(knowledgeBaseId, browseId);

  /** A server already linked here would be re-imported rather than added. */
  const available = useMemo(() => {
    const bound = new Set(linked.map((link) => link.dataset_file_system_id));
    return (sourcesQuery.data ?? []).filter((source) => !bound.has(source.id));
  }, [sourcesQuery.data, linked]);

  useEffect(() => {
    if (sourceId === '' && available.length > 0) {
      setSourceId(available[0].id);
    }
  }, [available, sourceId]);

  const browsed = browseId === sourceId && filesQuery.isSuccess;
  const boundFolder = browsed && folder !== WHOLE_SOURCE ? folder : '';

  const folders = useMemo(() => discoverFolders(filesQuery.data ?? []), [filesQuery.data]);
  const folderOptions = useMemo(
    () => [
      { value: WHOLE_SOURCE, label: localize('com_ui_tars_kb_ds_whole_source') },
      ...folders.map((value) => ({ value, label: value })),
    ],
    [folders, localize],
  );

  const scopedFiles = useMemo(
    () => (filesQuery.data ?? []).filter((file) => isInFolder(file, boundFolder)),
    [filesQuery.data, boundFolder],
  );

  const visibleFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === ''
      ? scopedFiles
      : scopedFiles.filter((file) => file.toLowerCase().includes(needle));
  }, [scopedFiles, filter]);

  const importMutation = useImportTarsFileSystemMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_imported'), status: 'success' });
      onClose();
    },
    onError: (error) =>
      showToast({
        message: relayedError(error) ?? localize('com_ui_tars_kb_ds_import_failed'),
        status: 'error',
      }),
  });

  const changeSource = (value: string) => {
    setSourceId(value);
    setBrowseId(null);
    setSelected([]);
    setOverrides({});
    setFolder(WHOLE_SOURCE);
  };

  /** A tick outside the new folder would import a file the binding no longer covers. */
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
    chunkSize: overrides[file]?.chunkSize ?? chunkSize,
    overlap: overrides[file]?.overlap ?? overlap,
  });

  const setOverride = (file: string, patch: ChunkOverride) =>
    setOverrides((prev) => ({ ...prev, [file]: { ...prev[file], ...patch } }));

  /**
   * Taking everything sends only the files given their own chunking: pwc_tars
   * walks the folder itself and gives the rest the group's, which also keeps a
   * large folder clear of its per-request file cap.
   */
  const filesToSend = syncAll ? scopedFiles.filter((file) => overrides[file] != null) : selected;

  const invalidFiles = new Set(
    filesToSend.filter((file) => {
      const settings = settingsOf(file);
      return chunkSettingsInvalid(settings.chunkSize, settings.overlap, limits);
    }),
  );

  const trimmedName = name.trim();
  const invalidChunk = chunkSettingsInvalid(chunkSize, overlap, limits) || invalidFiles.size > 0;
  const canImport =
    sourceId !== '' &&
    trimmedName !== '' &&
    !invalidChunk &&
    (syncAll || selected.length > 0) &&
    !importMutation.isLoading;

  const submit = () => {
    if (!canImport) {
      return;
    }
    importMutation.mutate({
      fileSystemId: sourceId,
      data: {
        name: trimmedName,
        syncAll,
        uploadOnly,
        chunkSize,
        overlap,
        selectedFolder: boundFolder,
        files: filesToSend.map((path) => ({ path, ...settingsOf(path) })),
      },
    });
  };

  /** Fetching sources, having none, and the form itself are three outcomes. */
  const body = () => {
    if (sourcesQuery.isLoading) {
      return (
        <div className="flex h-32 items-center justify-center">
          <Spinner />
        </div>
      );
    }

    if (available.length === 0) {
      return (
        <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
          {localize('com_ui_tars_kb_ds_no_file_servers')}
        </p>
      );
    }

    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label id="tars-fs-source-label">{localize('com_ui_tars_kb_ds_file_server')}</Label>
            <Dropdown
              value={sourceId}
              onChange={changeSource}
              options={available.map((source) => ({
                value: source.id,
                label:
                  source.mount_type != null ? `${source.name} (${source.mount_type})` : source.name,
              }))}
              aria-labelledby="tars-fs-source-label"
              searchable={available.length > 8}
              searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
              searchEmptyText={localize('com_ui_no_results_found')}
              sizeClasses="w-full"
              className="w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tars-fs-name">
              {localize('com_ui_tars_kb_ds_group_name')}
              <span className="ml-0.5 text-pwc-danger">*</span>
            </Label>
            <Input
              id="tars-fs-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tars-fs-chunk">{localize('com_ui_tars_kb_chunk_size')}</Label>
              <Input
                id="tars-fs-chunk"
                type="number"
                min={1}
                max={limits.max_chunk_size}
                value={chunkSize}
                onChange={(event) => setChunkSize(Number(event.target.value))}
                aria-invalid={invalidChunk}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tars-fs-overlap">{localize('com_ui_tars_kb_overlap')}</Label>
              <Input
                id="tars-fs-overlap"
                type="number"
                min={0}
                max={limits.max_overlap}
                value={overlap}
                onChange={(event) => setOverlap(Number(event.target.value))}
                aria-invalid={invalidChunk}
              />
            </div>
          </div>
          {invalidChunk && (
            <p className="text-xs text-pwc-danger">
              {localize('com_ui_tars_kb_ds_chunk_invalid', {
                0: String(limits.max_chunk_size),
                1: String(limits.max_overlap),
              })}
            </p>
          )}
          <p className="text-xs text-text-secondary">
            {localize('com_ui_tars_kb_ds_chunk_recorded_hint')}
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-border-light p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tars-fs-upload-only" className="text-sm">
              {localize('com_ui_tars_kb_ds_upload_only')}
            </Label>
            <Switch
              id="tars-fs-upload-only"
              checked={uploadOnly}
              onCheckedChange={setUploadOnly}
              aria-label={localize('com_ui_tars_kb_ds_upload_only')}
            />
          </div>
          <p className="text-xs text-text-secondary">
            {localize('com_ui_tars_kb_ds_upload_only_hint')}
          </p>
        </div>

        <section className="space-y-3 rounded-lg border border-border-light p-3">
          <p className="text-sm font-medium text-text-primary">
            {localize('com_ui_tars_kb_ds_import_scope')}
          </p>
          {scope()}
        </section>

        {/* Downloading and embedding happen before the response returns. */}
        <p className="text-xs text-text-secondary">{localize('com_ui_tars_kb_ds_import_slow')}</p>
      </>
    );
  };

  /**
   * Not browsed yet, browsing, or listed. Taking everything needs no listing —
   * it binds the whole source — but choosing a folder or files does.
   */
  const scope = () => {
    if (browseId === sourceId && filesQuery.isFetching) {
      return (
        <div className="flex h-24 items-center justify-center gap-2 text-sm text-text-secondary">
          <Spinner className="size-4" />
          {localize('com_ui_tars_kb_ds_connecting')}
        </div>
      );
    }

    if (!browsed) {
      const failed = browseId === sourceId && filesQuery.isError;
      return (
        <>
          <div className="space-y-2 text-center">
            <p className={`text-sm ${failed ? 'text-pwc-danger' : 'text-text-secondary'}`}>
              {failed
                ? (relayedError(filesQuery.error) ?? localize('com_ui_tars_kb_ds_connect_failed'))
                : localize('com_ui_tars_kb_ds_browse_hint')}
            </p>
            <Button
              variant="outline"
              onClick={() => setBrowseId(sourceId)}
              disabled={sourceId === ''}
              className="gap-1.5"
            >
              <Eye className="size-4" aria-hidden />
              {localize('com_ui_tars_kb_ds_browse')}
            </Button>
          </div>
          {syncAllSwitch()}
        </>
      );
    }

    return (
      <>
        <div className="space-y-1.5">
          <Label id="tars-fs-folder-label">{localize('com_ui_tars_kb_ds_bind_folder')}</Label>
          {folders.length > 0 && (
            <Dropdown
              value={folder}
              onChange={changeFolder}
              options={folderOptions}
              aria-labelledby="tars-fs-folder-label"
              searchable={folderOptions.length > 8}
              searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
              searchEmptyText={localize('com_ui_no_results_found')}
              sizeClasses="w-full"
              className="w-full"
            />
          )}
          <p
            className={`text-xs ${boundFolder !== '' ? 'text-brand-primary' : 'text-text-secondary'}`}
          >
            {boundFolder !== ''
              ? localize('com_ui_tars_kb_ds_folder_bound_hint', { 0: boundFolder })
              : localize('com_ui_tars_kb_ds_whole_source_hint')}
          </p>
        </div>

        {syncAllSwitch()}

        {syncAll && (
          <p className="text-sm text-text-secondary">
            {localize('com_ui_tars_kb_ds_sync_all_count', { 0: String(scopedFiles.length) })}
          </p>
        )}
        {fileTable()}
      </>
    );
  };

  const syncAllSwitch = () => (
    <div className="space-y-1 border-t border-border-light pt-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="tars-fs-sync-all" className="text-sm">
          {localize(
            boundFolder !== ''
              ? 'com_ui_tars_kb_ds_sync_all_folder'
              : 'com_ui_tars_kb_ds_sync_all_source',
          )}
        </Label>
        <Switch
          id="tars-fs-sync-all"
          checked={syncAll}
          onCheckedChange={setSyncAll}
          aria-label={localize('com_ui_tars_kb_ds_sync_all')}
        />
      </div>
      <p className="text-xs text-text-secondary">{localize('com_ui_tars_kb_ds_sync_all_hint')}</p>
    </div>
  );

  /**
   * pwc_tars' own file table: each file's folder and chunking, editable per
   * file. While everything is taken the ticks go, since every file is.
   */
  const fileTable = () => (
    <>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden
          />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={localize('com_ui_tars_audit_search_placeholder')}
            aria-label={localize('com_ui_tars_kb_ds_filter_files')}
            className="pl-9"
          />
        </div>
        <span className="shrink-0 text-sm text-text-secondary">
          {syncAll
            ? `${localize('com_ui_tars_kb_ds_total')}: ${scopedFiles.length}`
            : localize('com_ui_tars_audit_selected_count', { 0: String(selected.length) })}
        </span>
      </div>

      {visibleFiles.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_kb_ds_no_remote_files')}
        </p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border border-border-light">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-secondary">
              <tr className="text-left text-text-secondary">
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
                <th className="w-28 px-2 py-2 font-medium">{localize('com_ui_tars_kb_overlap')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleFiles.map((file, index) => {
                const settings = settingsOf(file);
                const invalid = invalidFiles.has(file);
                const directory = directoryOf(file);
                return (
                  <tr key={file} className="border-t border-border-light hover:bg-surface-hover">
                    <td className="px-3 py-1">
                      {!syncAll && (
                        <Checkbox
                          checked={selected.includes(file)}
                          onCheckedChange={() => toggle(file)}
                          aria-label={localize('com_ui_tars_kb_ds_select_one', { 0: file })}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-text-secondary">{index + 1}</td>
                    <td className="max-w-[20rem] px-3 py-1">
                      <span className="block truncate text-text-primary" title={file}>
                        {fileNameOf(file)}
                      </span>
                    </td>
                    <td className="max-w-[16rem] px-3 py-1">
                      <span className="block truncate text-text-secondary" title={directory}>
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
    </>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !importMutation.isLoading && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_ds_import_group')}
        className="w-11/12 md:max-w-5xl"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={<div className="max-h-[70vh] min-w-0 space-y-4 overflow-y-auto pr-1">{body()}</div>}
        buttons={
          <Button variant="submit" onClick={submit} disabled={!canImport}>
            {importMutation.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              localize('com_ui_tars_kb_ds_import')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
