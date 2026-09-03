import { Button } from '@librechat/client';
import { Info, Pencil, Trash2 } from 'lucide-react';
import type { TTarsFileSystemSource } from 'librechat-data-provider';
import Pagination, { usePagination } from '../Knowledge/Pagination';
import KnowledgeBaseChips from '../Sources/KnowledgeBaseChips';
import { knowledgeBaseNames, protocolIcon } from './helpers';
import { useLocalize } from '~/hooks';

/** The document-group list, with the knowledge bases each is granted to. */
export default function FileSystemTable({
  fileSystems,
  knowledgeBaseNamesById,
  onEdit,
  onDelete,
  onDetails,
}: {
  fileSystems: TTarsFileSystemSource[];
  knowledgeBaseNamesById: Map<string, string>;
  onEdit: (fileSystem: TTarsFileSystemSource) => void;
  onDelete: (fileSystem: TTarsFileSystemSource) => void;
  onDetails: (fileSystem: TTarsFileSystemSource) => void;
}) {
  const localize = useLocalize();
  const paged = usePagination(fileSystems);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border-light">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="bg-surface-secondary">
            <tr className="text-left text-text-secondary">
              <th className="w-[18%] px-3 py-2 font-medium">{localize('com_ui_tars_fs_name')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_fs_protocol')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_fs_host')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_fs_port')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_fs_path')}</th>
              <th className="w-[22%] px-3 py-2 font-medium">
                {localize('com_ui_tars_db_allowed_kbs')}
              </th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_users_status')}</th>
              <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((fileSystem) => {
              const Icon = protocolIcon(fileSystem.mount_type);
              const names = knowledgeBaseNames(
                fileSystem.allowed_km_ids ?? [],
                knowledgeBaseNamesById,
              );

              return (
                <tr
                  key={fileSystem.id}
                  className="border-t border-border-light hover:bg-surface-hover"
                >
                  <td className="max-w-0 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(fileSystem)}
                      className="block w-full truncate text-left font-medium text-text-primary hover:underline"
                      title={fileSystem.name}
                    >
                      {fileSystem.name}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-4" aria-hidden />
                      {fileSystem.mount_type ?? '—'}
                    </span>
                  </td>
                  <td className="max-w-0 px-3 py-1.5 text-text-secondary">
                    <span className="block truncate" title={fileSystem.host ?? undefined}>
                      {fileSystem.host ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-text-secondary">
                    {fileSystem.port ?? '—'}
                  </td>
                  <td className="max-w-0 px-3 py-1.5 text-text-secondary">
                    <span className="block truncate" title={fileSystem.path ?? undefined}>
                      {fileSystem.path ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <KnowledgeBaseChips names={names} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span
                      className={
                        fileSystem.status === 0 ? 'text-text-tertiary' : 'text-text-secondary'
                      }
                    >
                      {localize(
                        fileSystem.status === 0
                          ? 'com_ui_tars_db_status_disabled'
                          : 'com_ui_tars_db_status_enabled',
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDetails(fileSystem)}
                        aria-label={localize('com_ui_tars_db_details')}
                        title={localize('com_ui_tars_db_details')}
                        className="text-text-secondary"
                      >
                        <Info className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onEdit(fileSystem)}
                        aria-label={localize('com_ui_edit')}
                        title={localize('com_ui_edit')}
                        className="text-text-secondary"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDelete(fileSystem)}
                        aria-label={localize('com_ui_delete')}
                        title={localize('com_ui_delete')}
                        className="text-pwc-danger"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination state={paged} />
    </div>
  );
}
