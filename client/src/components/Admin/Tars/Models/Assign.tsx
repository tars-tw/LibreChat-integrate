import { useState } from 'react';
import { Button, Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsModelProfile } from 'librechat-data-provider';
import type { AssigneeRef } from '~/components/Tars/AssignDialog';
import { useTarsModelAssigneesQuery, useSaveTarsModelPermissionMutation } from '~/data-provider';
import AssignDialog from '~/components/Tars/AssignDialog';
import useFeedback from './useFeedback';
import { useLocalize } from '~/hooks';

interface ModelAssignModalProps {
  profile: TTarsModelProfile;
  onClose: () => void;
}

/**
 * Assigns one model to users and groups (`sys_model_permission`). A model nobody is
 * assigned to is open to everyone, so saving an emptied list asks first. Saving
 * overwrites only this model's assignees. Mounts per opening.
 */
export default function ModelAssignModal({ profile, onClose }: ModelAssignModalProps) {
  const localize = useLocalize();
  const { notifySuccess, notifyError } = useFeedback();
  const { data: saved } = useTarsModelAssigneesQuery(profile.id);
  const [confirmingOpen, setConfirmingOpen] = useState(false);

  const saveMutation = useSaveTarsModelPermissionMutation({
    onSuccess: () => {
      notifySuccess(localize('com_ui_tars_models_assign_saved', { name: profile.name }));
      onClose();
    },
    onError: (error: unknown) => {
      setConfirmingOpen(false);
      notifyError(error);
    },
  });

  const submit = (principals: AssigneeRef[]) =>
    saveMutation.mutate({ modelProfileId: profile.id, data: { principals } });

  /** Emptying a restricted model widens it to everyone, which is confirmed before saving. */
  const handleSave = (principals: AssigneeRef[]) => {
    if (principals.length === 0 && (saved?.length ?? 0) > 0) {
      setConfirmingOpen(true);
      return;
    }
    submit(principals);
  };

  return (
    <>
      <AssignDialog
        title={localize('com_ui_tars_models_assign_title', { name: profile.name })}
        hint={localize('com_ui_tars_models_assign_hint')}
        emptyText={localize('com_ui_tars_models_assigned_empty')}
        saved={saved}
        isSaving={saveMutation.isLoading && !confirmingOpen}
        onSave={handleSave}
        onClose={onClose}
      />

      {confirmingOpen && (
        <OGDialog open onOpenChange={(open) => !open && setConfirmingOpen(false)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_models_open_confirm_title')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <p className="text-text-secondary text-sm">
                {localize('com_ui_tars_models_open_confirm', { name: profile.name })}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => submit([])}
                disabled={saveMutation.isLoading}
              >
                {saveMutation.isLoading ? (
                  <Spinner />
                ) : (
                  localize('com_ui_tars_models_open_confirm_action')
                )}
              </Button>
            }
          />
        </OGDialog>
      )}
    </>
  );
}
