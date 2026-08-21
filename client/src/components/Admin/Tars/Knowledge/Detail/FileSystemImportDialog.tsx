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
import type { TTarsDatasetFileSystemLink } from 'librechat-data-provider';
import {
  useImportTarsFileSystemMutation,
  useTarsFileSystemFilesQuery,
  useTarsFileSystemSourcesQuery,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

const DEFAULT_CHUNK = 300;
const DEFAULT_OVERLAP = 50;

/**
 * Imports a document group from a file server.
 *
 * "Sync everything" skips the file list entirely — pwc_tars walks the path
 * itself and keeps doing so on later refreshes, which is a different contract
 * from picking a fixed set once.
 */
export default function FileSystemImportDialog({
  knowledgeBaseId,
  linked,
  onClose,
}: {
  knowledgeBaseId: string;
  linked: TTarsDatasetFileSystemLink[];
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const sourcesQuery = useTarsFileSystemSourcesQuery(knowledgeBaseId);
  const [sourceId, setSourceId] = useState('');
  const [name, setName] = useState('');
  const [syncAll, setSyncAll] = useState(false);
  const [uploadOnly, setUploadOnly] = useState(false);
  const [chunkSize, setChunkSize] = useState(DEFAULT_CHUNK);
  const [overlap, setOverlap] = useState(DEFAULT_OVERLAP);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
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

  const visibleFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const files = filesQuery.data ?? [];
    return needle === '' ? files : files.filter((file) => file.toLowerCase().includes(needle));
  }, [filesQuery.data, filter]);

  const importMutation = useImportTarsFileSystemMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_imported'), status: 'success' });
      onClose();
    },
    onError: () =>
      showToast({ message: localize('com_ui_tars_kb_ds_import_failed'), status: 'error' }),
  });

  const toggle = (file: string) =>
    setSelected((prev) => (prev.includes(file) ? prev.filter((v) => v !== file) : [...prev, file]));

  const trimmedName = name.trim();
  const canImport =
    sourceId !== '' &&
    trimmedName !== '' &&
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
        /** pwc_tars keys the per-file overrides by the path it reported. */
        fileSettings: Object.fromEntries(
          (syncAll ? [] : selected).map((file) => [file, { chunkSize, overlap }]),
        ),
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
              onChange={(value) => {
                setSourceId(value);
                setBrowseId(null);
                setSelected([]);
              }}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tars-fs-chunk">{localize('com_ui_tars_kb_chunk_size')}</Label>
            <Input
              id="tars-fs-chunk"
              type="number"
              min={1}
              value={chunkSize}
              onChange={(event) => setChunkSize(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tars-fs-overlap">{localize('com_ui_tars_kb_overlap')}</Label>
            <Input
              id="tars-fs-overlap"
              type="number"
              min={0}
              value={overlap}
              onChange={(event) => setOverlap(Number(event.target.value))}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border-light p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="tars-fs-sync-all" className="text-sm">
              {localize('com_ui_tars_kb_ds_sync_all')}
            </Label>
            <Switch
              id="tars-fs-sync-all"
              checked={syncAll}
              onCheckedChange={setSyncAll}
              aria-label={localize('com_ui_tars_kb_ds_sync_all')}
            />
          </div>
          <p className="text-xs text-text-secondary">
            {localize('com_ui_tars_kb_ds_sync_all_hint')}
          </p>
          <div className="flex items-center justify-between gap-3 border-t border-border-light pt-3">
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

        {!syncAll && filePicker()}

        {/* Downloading and embedding happen before the response returns. */}
        <p className="text-xs text-text-secondary">{localize('com_ui_tars_kb_ds_import_slow')}</p>
      </>
    );
  };

  /** Same three-state shape as the table picker: not browsed, browsing, listed. */
  const filePicker = () => {
    if (browseId !== sourceId || filesQuery.isError) {
      return (
        <div className="space-y-2 rounded-lg border border-border-light p-4 text-center">
          <p className="text-sm text-text-secondary">
            {localize(
              filesQuery.isError
                ? 'com_ui_tars_kb_ds_connect_failed'
                : 'com_ui_tars_kb_ds_browse_hint',
            )}
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
      );
    }

    if (filesQuery.isFetching) {
      return (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-text-secondary">
          <Spinner className="size-4" />
          {localize('com_ui_tars_kb_ds_connecting')}
        </div>
      );
    }

    return (
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
            {localize('com_ui_tars_audit_selected_count', { 0: String(selected.length) })}
          </span>
        </div>

        {visibleFiles.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_kb_ds_no_remote_files')}
          </p>
        ) : (
          <ul className="max-h-56 divide-y divide-border-light overflow-y-auto rounded-lg border border-border-light">
            {visibleFiles.map((file) => (
              <li key={file}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover">
                  <Checkbox
                    checked={selected.includes(file)}
                    onCheckedChange={() => toggle(file)}
                    aria-label={file}
                  />
                  <span className="min-w-0 flex-1 truncate text-text-primary">{file}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  };

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !importMutation.isLoading && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_ds_import_group')}
        className="w-11/12 md:max-w-2xl"
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
