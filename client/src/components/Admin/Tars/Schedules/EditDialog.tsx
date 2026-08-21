import { useState } from 'react';
import { Button, OGDialog, OGDialogTemplate, Spinner, useToastContext } from '@librechat/client';
import type { TTarsSchedule } from 'librechat-data-provider';
import type { ScheduleSettingsValue } from './Settings';
import { useUpdateTarsScheduleMutation } from '~/data-provider';
import ScheduleSettings, { settingsInvalid } from './Settings';
import { toLocalInput } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * Changes a schedule's cadence.
 *
 * pwc_tars re-arms the job itself when the schedule is not stopped, so there is
 * no separate "apply" step after saving.
 */
export default function ScheduleEditDialog({
  schedule,
  onClose,
  onSaved,
}: {
  schedule: TTarsSchedule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [value, setValue] = useState<ScheduleSettingsValue>({
    frequency: String(schedule.frequency),
    frequencyUnit: schedule.frequency_unit,
    startTime: toLocalInput(schedule.start_time),
    endTime: toLocalInput(schedule.end_time),
  });

  const updateMutation = useUpdateTarsScheduleMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
      onClose();
      onSaved();
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const invalid = settingsInvalid(value);

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !updateMutation.isLoading && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_sched_edit')}
        description={schedule.dataset_name}
        className="w-11/12 md:max-w-lg"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={<ScheduleSettings value={value} onChange={setValue} />}
        buttons={
          <Button
            variant="submit"
            disabled={invalid || updateMutation.isLoading}
            onClick={() =>
              updateMutation.mutate({
                id: schedule.id,
                data: {
                  frequency: Number(value.frequency),
                  frequencyUnit: value.frequencyUnit,
                  startTime: value.startTime,
                  endTime: value.endTime === '' ? undefined : value.endTime,
                },
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
