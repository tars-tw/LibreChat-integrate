import { useState } from 'react';
import { Pencil, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  Switch,
  useToastContext,
} from '@librechat/client';
import type { TTarsSchedule } from 'librechat-data-provider';
import {
  useDeleteTarsScheduleMutation,
  useTarsScheduleActionMutation,
  useUpdateTarsScheduleSyncAllMutation,
} from '~/data-provider';
import { hasSyncAll, isRunning, isStopped, unitKey } from './helpers';
import ConfirmDialog from '../Knowledge/Detail/ConfirmDialog';
import { formatDateTime } from '../Users/helpers';
import ScheduleStatusBadge from './StatusBadge';
import ScheduleEditDialog from './EditDialog';
import { useLocalize } from '~/hooks';

/**
 * What can be done with one schedule.
 *
 * A stopped schedule can only be restarted or edited — pwc_tars has removed its
 * job from the scheduler, so running or stopping it again is meaningless. A job
 * that is mid-run accepts nothing until it finishes.
 */
export default function ScheduleActionDialog({
  schedule,
  locale,
  onClose,
}: {
  schedule: TTarsSchedule;
  locale: string;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onError = () =>
    showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' });

  const done = (messageKey: Parameters<typeof localize>[0]) => () => {
    showToast({ message: localize(messageKey), status: 'success' });
    onClose();
  };

  const runMutation = useTarsScheduleActionMutation('run', {
    onSuccess: done('com_ui_tars_sched_run_started'),
    onError,
  });
  const stopMutation = useTarsScheduleActionMutation('stop', {
    onSuccess: done('com_ui_tars_sched_stopped'),
    onError,
  });
  const restartMutation = useTarsScheduleActionMutation('restart', {
    onSuccess: done('com_ui_tars_sched_restarted'),
    onError,
  });
  const deleteMutation = useDeleteTarsScheduleMutation({
    onSuccess: done('com_ui_tars_sched_deleted'),
    onError,
  });
  const syncAllMutation = useUpdateTarsScheduleSyncAllMutation({ onError });

  const running = isRunning(schedule);
  const stopped = isStopped(schedule);
  const isBusy =
    runMutation.isLoading ||
    stopMutation.isLoading ||
    restartMutation.isLoading ||
    deleteMutation.isLoading;

  const fact = (label: string, value: string) => (
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="break-words text-sm text-text-primary">{value}</p>
    </div>
  );

  const unit = unitKey(schedule.frequency_unit);
  const cadence = localize('com_ui_tars_sched_every', {
    0: String(schedule.frequency),
    1: unit != null ? localize(unit) : schedule.frequency_unit,
  });

  const action = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    variant: 'submit' | 'outline' | 'destructive',
    disabled?: boolean,
  ) => (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={disabled === true || isBusy}
      className="gap-2"
    >
      {icon}
      {label}
    </Button>
  );

  return (
    <>
      <OGDialog open={!editing && !deleting} onOpenChange={(open) => !open && onClose()}>
        <OGDialogTemplate
          title={schedule.dataset_name}
          description={schedule.knowledge_base_name}
          className="w-11/12 md:max-w-lg"
          showCloseButton={true}
          mainClassName="min-w-0"
          main={
            <div className="min-w-0 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-text-secondary">{localize('com_ui_tars_kb_status')}</p>
                  <ScheduleStatusBadge schedule={schedule} />
                </div>
                {fact(localize('com_ui_tars_sched_cadence'), cadence)}
                {fact(
                  localize('com_ui_tars_sched_last_run'),
                  schedule.last_execute_time == null
                    ? '—'
                    : formatDateTime(schedule.last_execute_time, locale),
                )}
                {fact(
                  localize('com_ui_tars_sched_next_run'),
                  schedule.next_execute_time == null
                    ? '—'
                    : formatDateTime(schedule.next_execute_time, locale),
                )}
                {fact(localize('com_ui_tars_sched_runs'), String(schedule.execution_count))}
                {fact(
                  localize('com_ui_tars_sched_end'),
                  schedule.end_time == null ? '—' : formatDateTime(schedule.end_time, locale),
                )}
              </div>

              {schedule.message != null && schedule.message !== '' && (
                <div>
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_tars_sched_message')}
                  </p>
                  <p className="break-words text-sm text-text-primary">{schedule.message}</p>
                </div>
              )}

              {/* The flag lives on the document-group link, so only those have it. */}
              {hasSyncAll(schedule) && (
                <div className="space-y-2 rounded-lg border border-border-light p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-text-primary">
                      {localize('com_ui_tars_kb_ds_sync_all')}
                    </span>
                    <Switch
                      checked={schedule.is_sync_all}
                      disabled={syncAllMutation.isLoading}
                      onCheckedChange={(checked) =>
                        syncAllMutation.mutate({ id: schedule.id, isSyncAll: checked })
                      }
                      aria-label={localize('com_ui_tars_kb_ds_sync_all')}
                    />
                  </div>
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_tars_kb_ds_sync_all_hint')}
                  </p>
                </div>
              )}

              {running && (
                <p className="flex items-center gap-2 rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                  <Spinner className="size-4" />
                  {localize('com_ui_tars_sched_running_note')}
                </p>
              )}

              <div className="flex flex-col gap-2">
                {stopped
                  ? action(
                      <RotateCcw className="size-4" aria-hidden />,
                      localize('com_ui_tars_sched_restart'),
                      () => restartMutation.mutate(schedule.id),
                      'submit',
                    )
                  : action(
                      <Play className="size-4" aria-hidden />,
                      localize('com_ui_tars_sched_run_now'),
                      () => runMutation.mutate(schedule.id),
                      'submit',
                      running,
                    )}

                {action(
                  <Pencil className="size-4" aria-hidden />,
                  localize('com_ui_tars_sched_edit'),
                  () => setEditing(true),
                  'outline',
                )}

                {!stopped &&
                  action(
                    <Square className="size-4" aria-hidden />,
                    localize('com_ui_tars_sched_stop'),
                    () => stopMutation.mutate(schedule.id),
                    'outline',
                    running,
                  )}

                {action(
                  <Trash2 className="size-4" aria-hidden />,
                  localize('com_ui_tars_sched_delete'),
                  () => setDeleting(true),
                  'destructive',
                  running,
                )}
              </div>
            </div>
          }
        />
      </OGDialog>

      {editing && (
        <ScheduleEditDialog
          schedule={schedule}
          onClose={() => setEditing(false)}
          onSaved={onClose}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={localize('com_ui_tars_sched_delete')}
          message={localize('com_ui_tars_sched_delete_confirm', { 0: schedule.dataset_name })}
          note={localize('com_ui_tars_sched_delete_note')}
          confirmLabel={localize('com_ui_delete')}
          destructive
          isBusy={deleteMutation.isLoading}
          onConfirm={() => deleteMutation.mutate(schedule.id)}
          onClose={() => setDeleting(false)}
        />
      )}
    </>
  );
}
