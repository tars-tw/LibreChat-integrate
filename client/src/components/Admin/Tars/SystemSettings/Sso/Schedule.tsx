import { useEffect, useState } from 'react';
import {
  Input,
  Label,
  Button,
  Spinner,
  Dropdown,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsSsoConfig } from 'librechat-data-provider';
import {
  useTarsSyncScheduleQuery,
  useSaveTarsSyncScheduleMutation,
  useDeleteTarsSyncScheduleMutation,
} from '~/data-provider';
import { FREQUENCY_UNITS, toScheduleInputValue } from '../helpers';
import { useLocalize } from '~/hooks';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

/** Automatic AD sync window for one configuration. */
export default function SyncScheduleModal({
  config,
  onOpenChange,
}: {
  config: TTarsSsoConfig;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: schedule, isLoading } = useTarsSyncScheduleQuery(config.id);

  const [frequency, setFrequency] = useState('1');
  const [unit, setUnit] = useState<string>('day');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  useEffect(() => {
    if (!schedule) {
      return;
    }
    setFrequency(String(schedule.frequency ?? 1));
    setUnit(schedule.frequency_unit ?? 'day');
    setStartTime(toScheduleInputValue(schedule.start_time));
    setEndTime(toScheduleInputValue(schedule.end_time));
  }, [schedule]);

  const onError = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const saveMutation = useSaveTarsSyncScheduleMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_sso_schedule_saved'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const deleteMutation = useDeleteTarsSyncScheduleMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_sso_schedule_cleared'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });

  const handleSave = () => {
    const parsed = Number(frequency);
    if (!Number.isInteger(parsed) || parsed < 1) {
      showToast({ message: localize('com_ui_tars_sso_schedule_invalid'), status: 'error' });
      return;
    }
    if (startTime === '') {
      showToast({ message: localize('com_ui_tars_sso_schedule_start_required'), status: 'error' });
      return;
    }
    saveMutation.mutate({
      id: config.id,
      data: {
        frequency: parsed,
        frequency_unit: unit,
        start_time: startTime,
        ...(endTime === '' ? {} : { end_time: endTime }),
      },
    });
  };

  const unitOptions = FREQUENCY_UNITS.map((value) => ({
    value,
    label: localize(`com_ui_tars_sso_unit_${value}`),
  }));

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_sso_schedule')}
        showCloseButton={true}
        className="w-11/12 md:max-w-lg"
        main={
          isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                {localize('com_ui_tars_sso_schedule_hint')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tars-schedule-frequency">
                    {localize('com_ui_tars_sso_frequency')}
                  </Label>
                  <Input
                    id="tars-schedule-frequency"
                    type="number"
                    min={1}
                    className="mt-1"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                  />
                </div>
                <div>
                  <Label id="tars-schedule-unit-label">
                    {localize('com_ui_tars_sso_frequency_unit')}
                  </Label>
                  <Dropdown
                    value={unit}
                    options={unitOptions}
                    onChange={setUnit}
                    aria-labelledby="tars-schedule-unit-label"
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <Label htmlFor="tars-schedule-start">
                    {localize('com_ui_tars_sso_schedule_start')}
                  </Label>
                  <Input
                    id="tars-schedule-start"
                    type="datetime-local"
                    className="mt-1"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="tars-schedule-end">
                    {localize('com_ui_tars_sso_schedule_end')}
                  </Label>
                  <Input
                    id="tars-schedule-end"
                    type="datetime-local"
                    className="mt-1"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
              {schedule?.last_execute_at != null && schedule.last_execute_at !== '' && (
                <p className="text-xs text-text-secondary">
                  {localize('com_ui_tars_sso_schedule_last', { time: schedule.last_execute_at })}
                </p>
              )}
            </div>
          )
        }
        buttons={
          <>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate(config.id)}
              disabled={deleteMutation.isLoading}
            >
              {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_tars_sso_schedule_clear')}
            </Button>
            <Button variant="submit" onClick={handleSave} disabled={saveMutation.isLoading}>
              {saveMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
            </Button>
          </>
        }
      />
    </OGDialog>
  );
}
