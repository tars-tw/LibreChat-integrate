import { Button, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsDatasetDatabase } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { knowledgeBaseNames } from './helpers';
import { useLocalize } from '~/hooks';

/** Read-only view of a connection, including the fields the table has no room for. */
export default function DatabaseDetails({
  database,
  knowledgeBaseNamesById,
  onClose,
}: {
  database: TTarsDatasetDatabase;
  knowledgeBaseNamesById: Map<string, string>;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const fileBacked = database.db_type === 'SQLite';
  const names = knowledgeBaseNames(database.allowed_km_ids ?? [], knowledgeBaseNamesById);

  const row = (labelKey: TranslationKeys, value: string) => (
    <div className="grid grid-cols-3 gap-3 py-1.5">
      <dt className="text-text-secondary">{localize(labelKey)}</dt>
      <dd className="col-span-2 break-words text-text-primary">{value === '' ? '—' : value}</dd>
    </div>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={database.name}
        showCloseButton={true}
        className="w-11/12 max-w-lg"
        main={
          <dl className="divide-y divide-border-light text-sm">
            {row('com_ui_description', database.description ?? '')}
            {row('com_ui_tars_db_type', database.db_type ?? '')}
            {row('com_ui_tars_db_host', fileBacked ? '' : (database.host ?? ''))}
            {row('com_ui_tars_db_port', fileBacked ? '' : String(database.port ?? ''))}
            {row('com_ui_tars_db_database', database.database_name ?? '')}
            {row(
              'com_ui_tars_db_allowed_kbs',
              names.length === 0 ? localize('com_ui_tars_db_allowed_kbs_none') : names.join(', '),
            )}
            {row(
              'com_ui_tars_users_status',
              localize(
                database.status === 0
                  ? 'com_ui_tars_db_status_disabled'
                  : 'com_ui_tars_db_status_enabled',
              ),
            )}
            {row('com_ui_tars_db_created_at', database.created_at ?? '')}
            {row('com_ui_tars_db_updated_at', database.updated_at ?? '')}
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
