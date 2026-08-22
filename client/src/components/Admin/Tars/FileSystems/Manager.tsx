import { useMemo, useState } from 'react';
import { FolderTree, Plus, Search } from 'lucide-react';
import { TARS_FILE_PROTOCOLS } from 'librechat-data-provider';
import {
  Button,
  Dropdown,
  Input,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsFileSystemSource } from 'librechat-data-provider';
import {
  useTarsFileSystemsQuery,
  useDeleteTarsFileSystemMutation,
  useTarsKnowledgeBaseOverviewQuery,
} from '~/data-provider';
import { filterFileSystems } from './helpers';
import FileSystemDetails from './Details';
import FileSystemTable from './Table';
import FileSystemModal from './Modal';
import { useLocalize } from '~/hooks';

/**
 * The shared Dropdown treats an empty value as "nothing selected" and renders
 * a blank trigger, so the catch-all option needs a value of its own.
 */
const ALL_PROTOCOLS = '__all__';

/**
 * Document-group administration (資料源管理 → 文檔群組): the master list of the
 * file servers a knowledge base can import from, and which bases may use each.
 */
export default function FileSystemManager() {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const fileSystemsQuery = useTarsFileSystemsQuery();
  const overviewQuery = useTarsKnowledgeBaseOverviewQuery();

  const fileSystems = useMemo(() => fileSystemsQuery.data ?? [], [fileSystemsQuery.data]);
  const knowledgeBases = useMemo(
    () => overviewQuery.data?.knowledgeBases ?? [],
    [overviewQuery.data],
  );
  const knowledgeBaseNamesById = useMemo(
    () => new Map(knowledgeBases.map((kb) => [kb.id, kb.name])),
    [knowledgeBases],
  );

  const [search, setSearch] = useState('');
  const [protocol, setProtocol] = useState<string>(ALL_PROTOCOLS);
  /** `undefined` = closed, `null` = create, a row = edit. */
  const [editing, setEditing] = useState<TTarsFileSystemSource | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TTarsFileSystemSource | null>(null);
  const [details, setDetails] = useState<TTarsFileSystemSource | null>(null);

  const filtered = useMemo(
    () => filterFileSystems(fileSystems, search, protocol === ALL_PROTOCOLS ? '' : protocol),
    [fileSystems, search, protocol],
  );

  const deleteMutation = useDeleteTarsFileSystemMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_fs_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: () =>
      showToast({ message: localize('com_ui_tars_fs_delete_failed'), status: 'error' }),
  });

  const protocolOptions = [
    { value: ALL_PROTOCOLS, label: localize('com_ui_tars_fs_all_protocols') },
    ...TARS_FILE_PROTOCOLS.map((value) => ({ value, label: value })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('com_ui_tars_fs_search')}
            aria-label={localize('com_ui_tars_fs_search')}
            className="pl-9"
          />
        </div>

        <Dropdown
          value={protocol}
          onChange={setProtocol}
          options={protocolOptions}
          aria-label={localize('com_ui_tars_fs_protocol')}
          sizeClasses="min-w-[9rem]"
        />

        <Button variant="submit" onClick={() => setEditing(null)} className="gap-1.5">
          <Plus className="size-4" aria-hidden />
          {localize('com_ui_tars_fs_new')}
        </Button>
      </div>

      {fileSystemsQuery.isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!fileSystemsQuery.isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-text-secondary">
          <FolderTree className="size-10 text-text-tertiary" aria-hidden />
          {localize(
            fileSystems.length === 0 ? 'com_ui_tars_fs_empty' : 'com_ui_tars_fs_no_search_results',
          )}
        </div>
      )}

      {!fileSystemsQuery.isLoading && filtered.length > 0 && (
        <FileSystemTable
          fileSystems={filtered}
          knowledgeBaseNamesById={knowledgeBaseNamesById}
          onEdit={setEditing}
          onDelete={setDeleting}
          onDetails={setDetails}
        />
      )}

      {editing !== undefined && (
        <FileSystemModal
          fileSystem={editing}
          knowledgeBases={knowledgeBases}
          onClose={() => setEditing(undefined)}
        />
      )}

      {details != null && (
        <FileSystemDetails
          fileSystem={details}
          knowledgeBaseNamesById={knowledgeBaseNamesById}
          onClose={() => setDetails(null)}
        />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_fs_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_db_delete_confirm_named', { 0: deleting.name })}
                </p>
                {/* Documents already imported from the group are left behind. */}
                <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                  {localize('com_ui_tars_fs_delete_warning')}
                </p>
              </div>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleting.id)}
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
