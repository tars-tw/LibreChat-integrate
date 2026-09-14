import { useEffect, useState } from 'react';
import { Button, Spinner, Switch, useToastContext } from '@librechat/client';
import type { TTarsDatasetFileSystemLink } from 'librechat-data-provider';
import type { ScheduleSettingsValue } from '../../Schedules/Settings';
import {
  useCreateTarsScheduleMutation,
  useTarsScheduleActionMutation,
  useTarsSchedulesQuery,
  useUpdateTarsScheduleMutation,
} from '~/data-provider';
import { defaultStart, isStopped, toLocalInput } from '../../Schedules/helpers';
import ScheduleSettings, { settingsInvalid } from '../../Schedules/Settings';
import ScheduleStatusBadge from '../../Schedules/StatusBadge';
import { useLocalize } from '~/hooks';

const emptyValue: ScheduleSettingsValue = {
  frequency: '1',
  frequencyUnit: 'day',
  startTime: defaultStart(),
  endTime: '',
};

/**
 * The recurring-sync setting for one document group, inline rather than a
 * trip to the standalone schedules page — pwc_tars' own group dialog offers
 * it right here too, and it is one schedule at most since a dataset can only
 * ever be scheduled once.
 *
 * A schedule already exists whenever one is found for this dataset: enabling
 * then only ever means restarting it, and disabling only ever means stopping
 * it — `create_schedule` is reserved for the case where none exists yet.
 */
export default function GroupScheduleSection({
  knowledgeBaseId,
  link,
}: {
  knowledgeBaseId: string;
  link: TTarsDatasetFileSystemLink;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const schedulesQuery = useTarsSchedulesQuery(knowledgeBaseId);
  /**
   * Matched by dataset identity rather than `link.schedule_id`: that id lives on
   * a differently-scoped query pwc_tars does not invalidate on a schedule
   * change, so it would still read `null` right after creating one here.
   */
  const schedule =
    (schedulesQuery.data ?? []).find(
      (row) => row.dataset_type === 'file_system' && row.dataset_id === link.dataset_file_system_id,
    ) ?? null;

  const [enabled, setEnabled] = useState(schedule != null && !isStopped(schedule));
  const [value, setValue] = useState<ScheduleSettingsValue>(
    schedule != null
      ? {
          frequency: String(schedule.frequency),
          frequencyUnit: schedule.frequency_unit,
          startTime: toLocalInput(schedule.start_time),
          endTime: toLocalInput(schedule.end_time),
        }
      : emptyValue,
  );

  /** Re-seed the form whenever the schedule identity changes: loaded, created, or deleted elsewhere. */
  useEffect(() => {
    setEnabled(schedule != null && !isStopped(schedule));
    setValue(
      schedule != null
        ? {
            frequency: String(schedule.frequency),
            frequencyUnit: schedule.frequency_unit,
            startTime: toLocalInput(schedule.start_time),
            endTime: toLocalInput(schedule.end_time),
          }
        : emptyValue,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule?.id]);

  const onError = () =>
    showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' });

  const createMutation = useCreateTarsScheduleMutation({ onError });
  const updateMutation = useUpdateTarsScheduleMutation({ onError });
  const stopMutation = useTarsScheduleActionMutation('stop', { onError });
  const restartMutation = useTarsScheduleActionMutation('restart', { onError });

  const isBusy =
    createMutation.isLoading ||
    updateMutation.isLoading ||
    stopMutation.isLoading ||
    restartMutation.isLoading;

  const invalid = enabled && settingsInvalid(value);
  const canSave = !invalid && !isBusy && (schedule != null || enabled);

  const scheduleInput = () => ({
    frequency: Number(value.frequency),
    frequencyUnit: value.frequencyUnit,
    startTime: value.startTime,
    endTime: value.endTime === '' ? undefined : value.endTime,
  });

  const save = async () => {
    try {
      if (schedule == null) {
        if (!enabled) {
          return;
        }
        await createMutation.mutateAsync({
          datasetId: link.dataset_file_system_id,
          datasetType: 'file_system',
          knowledgeBaseId,
          ...scheduleInput(),
        });
        showToast({ message: localize('com_ui_tars_sched_created'), status: 'success' });
        return;
      }

      await updateMutation.mutateAsync({ id: schedule.id, data: scheduleInput() });
      const stopped = isStopped(schedule);
      if (enabled && stopped) {
        await restartMutation.mutateAsync(schedule.id);
      } else if (!enabled && !stopped) {
        await stopMutation.mutateAsync(schedule.id);
      }
      showToast({ message: localize('com_ui_tars_sched_updated'), status: 'success' });
    } catch {
      /** The mutation that failed already reported it via its own `onError`. */
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border-light p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">
          {localize('com_ui_tars_kb_ds_schedule')}
        </p>
        {schedule != null ? (
          <ScheduleStatusBadge schedule={schedule} />
        ) : (
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
            {localize('com_ui_tars_kb_ds_schedule_not_set')}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-text-primary">
          {localize('com_ui_tars_kb_ds_schedule_enable')}
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={localize('com_ui_tars_kb_ds_schedule_enable')}
        />
      </div>

      {enabled && (
        <>
          <ScheduleSettings value={value} onChange={setValue} />
          <div className="flex justify-end">
            <Button variant="submit" disabled={!canSave} onClick={save} className="gap-1.5">
              {isBusy ? <Spinner className="size-4" /> : localize('com_ui_save')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
