import type { TTarsSchedule } from 'librechat-data-provider';
import { statusMeta } from './helpers';
import { useLocalize } from '~/hooks';

/** A schedule's last outcome. */
export default function ScheduleStatusBadge({ schedule }: { schedule: TTarsSchedule }) {
  const localize = useLocalize();
  const meta = statusMeta(schedule.last_status);
  const Icon = meta.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${meta.className}`}
    >
      {/* Running is the only state that is still changing, so it is the only
          one that animates — colour alone does not say "in progress". */}
      <Icon
        className={`size-3.5 ${schedule.last_status === 'running' ? 'animate-spin' : ''}`}
        aria-hidden
      />
      {localize(meta.labelKey)}
    </span>
  );
}
