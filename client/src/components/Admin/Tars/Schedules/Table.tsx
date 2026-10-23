import { Settings2 } from 'lucide-react';
import { Button } from '@librechat/client';
import type { TTarsSchedule } from 'librechat-data-provider';
import Pagination, { usePagination } from '../Knowledge/Pagination';
import { datasetTypeKey, unitKey } from './helpers';
import { formatDateTime } from '../Users/helpers';
import ScheduleStatusBadge from './StatusBadge';
import { useLocalize } from '~/hooks';

/**
 * The schedule table, shared by the knowledge-base tab and the standalone page.
 *
 * The knowledge-base column only earns its place when the rows can come from
 * more than one, which is what `showKnowledgeBase` decides.
 */
export default function ScheduleTable({
  schedules,
  locale,
  showKnowledgeBase,
  onSelect,
}: {
  schedules: TTarsSchedule[];
  locale: string;
  showKnowledgeBase?: boolean;
  onSelect: (schedule: TTarsSchedule) => void;
}) {
  const localize = useLocalize();
  const paged = usePagination(schedules);

  const cadence = (schedule: TTarsSchedule) => {
    const key = unitKey(schedule.frequency_unit);
    const unit = key != null ? localize(key) : schedule.frequency_unit;
    return localize('com_ui_tars_sched_every', { 0: String(schedule.frequency), 1: unit });
  };

  const datasetType = (schedule: TTarsSchedule) => {
    const key = datasetTypeKey(schedule.dataset_type);
    return key != null ? localize(key) : schedule.dataset_type;
  };

  return (
    <div className="space-y-3">
      <div className="border-border-light overflow-x-auto rounded-lg border">
        <table
          className={`w-full ${showKnowledgeBase === true ? 'min-w-[68rem]' : 'min-w-[60rem]'} border-collapse text-sm`}
        >
          <thead className="bg-surface-secondary">
            <tr className="text-text-secondary text-left">
              <th className="w-[22%] px-3 py-2 font-medium">
                {localize('com_ui_tars_sched_dataset')}
              </th>
              {showKnowledgeBase === true && (
                <th className="w-[18%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_nav_kb_list')}
                </th>
              )}
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_ds_sync_mode')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_sched_cadence')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_kb_status')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_sched_next_run')}</th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_sched_runs')}</th>
              <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((schedule) => (
              <tr key={schedule.id} className="border-border-light hover:bg-surface-hover border-t">
                <td className="max-w-0 px-3 py-1.5">
                  <span className="text-text-primary block truncate" title={schedule.dataset_name}>
                    {schedule.dataset_name}
                  </span>
                </td>
                {showKnowledgeBase === true && (
                  <td className="text-text-secondary max-w-0 px-3 py-1.5">
                    <span className="block truncate" title={schedule.knowledge_base_name}>
                      {schedule.knowledge_base_name}
                    </span>
                  </td>
                )}
                <td className="text-text-secondary px-3 py-1.5 whitespace-nowrap">
                  {datasetType(schedule)}
                </td>
                <td className="text-text-secondary px-3 py-1.5 whitespace-nowrap">
                  {cadence(schedule)}
                </td>
                <td className="px-3 py-1.5">
                  <ScheduleStatusBadge schedule={schedule} />
                </td>
                <td className="text-text-secondary px-3 py-1.5 whitespace-nowrap">
                  {schedule.next_execute_time == null
                    ? '—'
                    : formatDateTime(schedule.next_execute_time, locale)}
                </td>
                <td className="text-text-secondary px-3 py-1.5 tabular-nums">
                  {schedule.execution_count}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onSelect(schedule)}
                      aria-label={localize('com_ui_tars_sched_manage')}
                      title={localize('com_ui_tars_sched_manage')}
                      className="text-text-secondary"
                    >
                      <Settings2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination state={paged} />
    </div>
  );
}
