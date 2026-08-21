import { useEffect, useState } from 'react';
import {
  Button,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsDatasetDatabase } from 'librechat-data-provider';
import { useTarsDatabasePromptQuery, useUpdateTarsDatabasePromptMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * The schema description pwc_tars feeds the model when it writes SQL.
 *
 * It is generated from the bound tables at bind time; editing it is how an
 * operator explains a column whose name does not say what it holds.
 */
export default function DatabasePromptDialog({
  knowledgeBaseId,
  database,
  onClose,
}: {
  knowledgeBaseId: string;
  database: TTarsDatasetDatabase;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const promptQuery = useTarsDatabasePromptQuery(knowledgeBaseId, database.id);
  const [tableInfo, setTableInfo] = useState<string | null>(null);

  useEffect(() => {
    if (promptQuery.data != null && tableInfo == null) {
      setTableInfo(promptQuery.data.llm_table_info ?? '');
    }
  }, [promptQuery.data, tableInfo]);

  const updateMutation = useUpdateTarsDatabasePromptMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
      onClose();
    },
    onError: () => showToast({ message: localize('com_ui_tars_kb_save_failed'), status: 'error' }),
  });

  /** Loading, missing and editable are three outcomes, not a nested ternary. */
  const editor = () => {
    if (promptQuery.isLoading) {
      return (
        <div className="flex h-48 items-center justify-center">
          <Spinner />
        </div>
      );
    }

    if (promptQuery.isError) {
      return (
        <p className="text-sm text-pwc-danger">{localize('com_ui_tars_kb_ds_prompt_missing')}</p>
      );
    }

    return (
      <>
        <div>
          <p className="text-xs text-text-secondary">
            {localize('com_ui_tars_kb_ds_bound_tables')}
          </p>
          <p className="break-words text-sm text-text-primary">{promptQuery.data?.tables ?? '—'}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tars-db-prompt">{localize('com_ui_tars_kb_ds_schema_description')}</Label>
          <textarea
            id="tars-db-prompt"
            rows={16}
            value={tableInfo ?? ''}
            onChange={(event) => setTableInfo(event.target.value)}
            className="data-table-scroll w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-border-heavy"
          />
        </div>
      </>
    );
  };

  const bindingId = promptQuery.data?.id;
  const canSave = bindingId != null && tableInfo != null && !updateMutation.isLoading;

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !updateMutation.isLoading && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_ds_sql_prompt')}
        description={database.name}
        className="w-11/12 md:max-w-3xl"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={<div className="min-w-0 space-y-3">{editor()}</div>}
        buttons={
          <Button
            variant="submit"
            disabled={!canSave}
            onClick={() =>
              updateMutation.mutate({
                databaseId: database.id,
                bindingId: bindingId ?? '',
                tableInfo: tableInfo ?? '',
              })
            }
          >
            {updateMutation.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
