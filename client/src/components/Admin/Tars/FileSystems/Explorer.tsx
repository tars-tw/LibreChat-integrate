import { useId, useMemo, useState } from 'react';
import { Button, FilterInput } from '@librechat/client';
import { CheckCircle2, ChevronRight, Folder, FolderInput } from 'lucide-react';
import type { TTarsFileProtocol } from 'librechat-data-provider';
import type { FileRow } from './helpers';
import {
  breadcrumbOf,
  childFolders,
  groupPathLabel,
  groupPathBlocker,
  folderWithinTested,
} from './helpers';
import { useLocalize } from '~/hooks';

/** How many files the preview lists before it asks for a filter. */
const FILE_PREVIEW_LIMIT = 200;

/**
 * Browses what the last connection test found, starting where it was run.
 *
 * Moving around never changes the group: the folder on screen becomes the
 * group path only through "Use as group path". Folders the test already walked
 * open at once; anywhere else (a parent, an SMB share, an NFS export) is asked
 * of the server by `onNavigate`, which tests there.
 */
export default function Explorer({
  protocol,
  testedPath,
  listedExports,
  sharesListed,
  exports,
  rows,
  folders,
  location,
  groupPath,
  onNavigate,
  onSetGroupPath,
}: {
  protocol: TTarsFileProtocol;
  /** Where the last test was run. */
  testedPath: string;
  /** The test asked an NFS server for its exports instead of walking a folder. */
  listedExports: boolean;
  /** The test listed an SMB server's shares instead of walking a folder. */
  sharesListed: boolean;
  exports?: string[];
  /** The files the test found, relative to `testedPath`. */
  rows: FileRow[];
  /** Every folder the test can offer, as a full path. */
  folders: string[];
  /** The folder on screen, as a full path. */
  location: string;
  /** The folder the form would save. */
  groupPath: string;
  onNavigate: (path: string) => void;
  onSetGroupPath: (path: string) => void;
}) {
  const localize = useLocalize();
  const [filter, setFilter] = useState('');
  const filterId = useId();

  const listing = listedExports || sharesListed;
  const entries = useMemo(
    () => (listedExports ? (exports ?? []) : childFolders(folders, location)),
    [listedExports, exports, folders, location],
  );

  /** The files under the folder on screen, as paths relative to it would read. */
  const scope = listing ? null : folderWithinTested(protocol, testedPath, location);
  const needle = filter.trim().toLowerCase();
  const files = useMemo(() => {
    if (scope == null) {
      return [];
    }
    const under =
      scope === ''
        ? rows
        : rows.filter((row) => row.directory === scope || row.directory.startsWith(`${scope}/`));
    return needle === ''
      ? under
      : under.filter(
          (row) =>
            row.name.toLowerCase().includes(needle) || row.directory.toLowerCase().includes(needle),
        );
  }, [rows, scope, needle]);

  const blocker = groupPathBlocker(protocol, location, listedExports);
  /** A new SMB or NFS group starts with no path, which reads as `/` but is not a place it can live. */
  const isGroupPath = blocker == null && groupPathLabel(location) === groupPathLabel(groupPath);
  const crumbs = breadcrumbOf(location);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav
          aria-label={localize('com_ui_tars_fs_location')}
          className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm"
        >
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
                {index > 0 && <ChevronRight className="text-text-tertiary size-3.5" aria-hidden />}
                {last ? (
                  <span className="text-text-primary font-medium break-all" aria-current="page">
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigate(crumb.path)}
                    className="text-text-secondary hover:text-text-primary break-all hover:underline"
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
        {isGroupPath ? (
          <span className="text-text-secondary flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="size-4" aria-hidden />
            {localize('com_ui_tars_fs_is_group_path')}
          </span>
        ) : (
          <Button
            variant="outline"
            size="compact"
            disabled={blocker != null}
            onClick={() => onSetGroupPath(location)}
          >
            <FolderInput className="size-4" aria-hidden />
            {localize('com_ui_tars_fs_set_group_path')}
          </Button>
        )}
      </div>

      {blocker != null && (
        <p className="text-text-secondary text-xs">
          {localize(
            blocker === 'smb_share'
              ? 'com_ui_tars_fs_blocked_smb_share'
              : 'com_ui_tars_fs_blocked_nfs_export',
          )}
        </p>
      )}

      {entries.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={localize('com_ui_tars_fs_subfolders')}>
          {entries.map((path) => (
            <li key={path}>
              <button
                type="button"
                onClick={() => onNavigate(path)}
                className="border-border-light hover:bg-surface-hover text-text-primary flex max-w-[18rem] items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                title={path}
              >
                <Folder className="text-text-secondary size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {listedExports ? path : path.slice(path.lastIndexOf('/') + 1)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-tertiary text-xs">{localize('com_ui_tars_fs_no_subfolders')}</p>
      )}

      {scope != null && (
        <div className="space-y-2">
          <FilterInput
            inputId={filterId}
            label={localize('com_ui_tars_fs_search_file')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            surface="dialog"
          />
          {files.length === 0 ? (
            <p className="text-text-tertiary text-xs">{localize('com_ui_tars_fs_no_files_here')}</p>
          ) : (
            <div className="border-border-light max-h-56 overflow-y-auto rounded-md border">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-surface-secondary text-text-secondary sticky top-0 text-left">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">
                      {localize('com_ui_tars_fs_file_name')}
                    </th>
                    <th className="px-3 py-1.5 font-medium">
                      {localize('com_ui_tars_fs_file_directory')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {files.slice(0, FILE_PREVIEW_LIMIT).map((row) => (
                    <tr
                      key={`${row.directory}/${row.name}`}
                      className="border-border-light border-t"
                    >
                      <td className="text-text-primary px-3 py-1" title={row.name}>
                        {row.name}
                      </td>
                      <td className="text-text-secondary px-3 py-1" title={row.directory}>
                        {row.directory === '' ? '—' : row.directory}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {files.length > FILE_PREVIEW_LIMIT && (
            <p className="text-text-tertiary text-xs">
              {localize('com_ui_tars_fs_file_truncated', {
                0: String(FILE_PREVIEW_LIMIT),
                1: String(files.length),
              })}
            </p>
          )}
        </div>
      )}

      <p className="text-text-secondary text-xs">{localize('com_ui_tars_fs_browse_hint')}</p>
    </div>
  );
}
