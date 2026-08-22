import { Button, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsFileSystemSource } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { knowledgeBaseNames, usesHostName } from './helpers';
import { useLocalize } from '~/hooks';

/** Read-only view of a document group, including what the table has no room for. */
export default function FileSystemDetails({
  fileSystem,
  knowledgeBaseNamesById,
  onClose,
}: {
  fileSystem: TTarsFileSystemSource;
  knowledgeBaseNamesById: Map<string, string>;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const names = knowledgeBaseNames(fileSystem.allowed_km_ids ?? [], knowledgeBaseNamesById);

  const row = (labelKey: TranslationKeys, value: string) => (
    <div className="grid grid-cols-3 gap-3 py-1.5">
      <dt className="text-text-secondary">{localize(labelKey)}</dt>
      <dd className="col-span-2 break-words text-text-primary">{value === '' ? '—' : value}</dd>
    </div>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={fileSystem.name}
        showCloseButton={true}
        className="w-11/12 max-w-lg"
        main={
          <dl className="divide-y divide-border-light text-sm">
            {row('com_ui_description', fileSystem.description ?? '')}
            {row('com_ui_tars_fs_protocol', fileSystem.mount_type ?? '')}
            {row('com_ui_tars_fs_host', fileSystem.host ?? '')}
            {usesHostName(fileSystem.mount_type as never) &&
              row('com_ui_tars_fs_server_name', fileSystem.host_name ?? '')}
            {row('com_ui_tars_fs_port', String(fileSystem.port ?? ''))}
            {row('com_ui_tars_fs_path', fileSystem.path ?? '')}
            {row(
              'com_ui_tars_db_allowed_kbs',
              names.length === 0 ? localize('com_ui_tars_db_allowed_kbs_none') : names.join(', '),
            )}
            {row(
              'com_ui_tars_users_status',
              localize(
                fileSystem.status === 0
                  ? 'com_ui_tars_db_status_disabled'
                  : 'com_ui_tars_db_status_enabled',
              ),
            )}
            {row('com_ui_tars_db_created_at', fileSystem.created_at ?? '')}
            {row('com_ui_tars_db_updated_at', fileSystem.updated_at ?? '')}
          </dl>
        }
        buttons={
          <Button variant="outline" onClick={onClose}>
            {localize('com_ui_close')}
          </Button>
        }
      />
    </OGDialog>
  );
}
