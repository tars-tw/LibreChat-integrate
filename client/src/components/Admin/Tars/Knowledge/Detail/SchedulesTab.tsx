import { useMemo, useState } from 'react';
import { Spinner } from '@librechat/client';
import { CalendarClock } from 'lucide-react';
import type { TTarsSchedule } from 'librechat-data-provider';
import ScheduleCreateDialog from '../../Schedules/CreateDialog';
import ScheduleActionDialog from '../../Schedules/ActionDialog';
import ScheduleLoadFailed from '../../Schedules/LoadFailed';
import { useTarsSchedulesQuery } from '~/data-provider';
import ScheduleTable from '../../Schedules/Table';
import { matchesName } from './helpers';
import { useLocalize } from '~/hooks';
import Toolbar from './Toolbar';

/**
 * The recurring refreshes of one knowledge base.
 *
 * Schedules cut across dataset kinds — a website and a document group can each
 * have one — so they get their own tab rather than a column on two others.
 */
export default function SchedulesTab({
  knowledgeBaseId,
  locale,
}: {
  knowledgeBaseId: string;
  locale: string;
}) {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TTarsSchedule | null>(null);
  const [creating, setCreating] = useState(false);

  const schedulesQuery = useTarsSchedulesQuery(knowledgeBaseId);
  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);

  const visible = useMemo(
    () => schedules.filter((schedule) => matchesName(schedule.dataset_name, search)),
    [schedules, search],
  );

  /** Loading, empty and populated are three outcomes, not a nested ternary. */
  const body = () => {
    if (schedulesQuery.isLoading) {
      return (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      );
    }
    /** Checked before the empty state, which it would otherwise look like. */
    if (schedulesQuery.isError) {
      return <ScheduleLoadFailed onRetry={() => void schedulesQuery.refetch()} />;
    }
    if (visible.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-sm text-text-secondary">
          <CalendarClock className="size-8 text-text-tertiary" aria-hidden />
          {localize(
            schedules.length === 0 ? 'com_ui_tars_sched_empty' : 'com_ui_tars_kb_ds_no_match',
          )}
        </div>
      );
    }
    return <ScheduleTable schedules={visible} locale={locale} onSelect={setSelected} />;
  };

  return (
    <div className="space-y-3">
      <Toolbar
        search={search}
        onSearchChange={setSearch}
        onRefresh={() => void schedulesQuery.refetch()}
        isRefreshing={schedulesQuery.isFetching}
        addLabel={localize('com_ui_tars_sched_new')}
        onAdd={() => setCreating(true)}
      />

      {body()}

      {selected != null && (
        <ScheduleActionDialog
          schedule={selected}
          locale={locale}
          onClose={() => setSelected(null)}
        />
      )}

      {creating && (
        <ScheduleCreateDialog
          knowledgeBaseId={knowledgeBaseId}
          schedules={schedules}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
