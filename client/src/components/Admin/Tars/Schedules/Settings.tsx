import { Dropdown, Input, Label } from '@librechat/client';
import { FREQUENCY_UNITS, unitKey } from './helpers';
import { useLocalize } from '~/hooks';

export interface ScheduleSettingsValue {
  frequency: string;
  frequencyUnit: string;
  startTime: string;
  endTime: string;
}

/** Whether the cadence is one pwc_tars will accept. */
export const settingsInvalid = (value: ScheduleSettingsValue): boolean => {
  const frequency = Number(value.frequency);
  if (!Number.isInteger(frequency) || frequency < 1) {
    return true;
  }
  if (value.startTime === '') {
    return true;
  }
  /** An end before the start would arm a job that can never run. */
  return value.endTime !== '' && value.endTime <= value.startTime;
};

/** The cadence fields, shared by the create and edit dialogs. */
export default function ScheduleSettings({
  value,
  onChange,
}: {
  value: ScheduleSettingsValue;
  onChange: (next: ScheduleSettingsValue) => void;
}) {
  const localize = useLocalize();
  const set = <K extends keyof ScheduleSettingsValue>(key: K, next: ScheduleSettingsValue[K]) =>
    onChange({ ...value, [key]: next });

  const frequency = Number(value.frequency);
  const frequencyInvalid = !Number.isInteger(frequency) || frequency < 1;
  const rangeInvalid = value.endTime !== '' && value.endTime <= value.startTime;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tars-sched-frequency">
            {localize('com_ui_tars_sched_frequency')}
            <span className="ml-0.5 text-pwc-danger">*</span>
          </Label>
          <Input
            id="tars-sched-frequency"
            type="number"
            min={1}
            value={value.frequency}
            onChange={(event) => set('frequency', event.target.value)}
            aria-invalid={frequencyInvalid}
          />
          {frequencyInvalid && (
            <p className="text-xs text-pwc-danger">
              {localize('com_ui_tars_sched_frequency_invalid')}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label id="tars-sched-unit-label">{localize('com_ui_tars_sched_frequency_unit')}</Label>
          <Dropdown
            value={value.frequencyUnit}
            onChange={(next) => set('frequencyUnit', next)}
            options={FREQUENCY_UNITS.map((unit) => {
              const key = unitKey(unit);
              return { value: unit, label: key != null ? localize(key) : unit };
            })}
            aria-labelledby="tars-sched-unit-label"
            sizeClasses="w-full"
            className="w-full"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tars-sched-start">
            {localize('com_ui_tars_sched_start')}
            <span className="ml-0.5 text-pwc-danger">*</span>
          </Label>
          <Input
            id="tars-sched-start"
            type="datetime-local"
            value={value.startTime}
            onChange={(event) => set('startTime', event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tars-sched-end">{localize('com_ui_tars_sched_end')}</Label>
          <Input
            id="tars-sched-end"
            type="datetime-local"
            value={value.endTime}
            onChange={(event) => set('endTime', event.target.value)}
            aria-invalid={rangeInvalid}
          />
          {rangeInvalid ? (
            <p className="text-xs text-pwc-danger">{localize('com_ui_tars_sched_range_invalid')}</p>
          ) : (
            /* pwc_tars marks a schedule stopped once the end time passes. */
            <p className="text-xs text-text-secondary">{localize('com_ui_tars_sched_end_hint')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
