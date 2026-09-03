import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Plus, RotateCw, Search } from 'lucide-react';
import { Button, Dropdown, Input, Label, Spinner } from '@librechat/client';
import type { TTarsSchedule } from 'librechat-data-provider';
import { useTarsKnowledgeBasesQuery, useTarsSchedulesQuery } from '~/data-provider';
import ScheduleCreateDialog from './CreateDialog';
import ScheduleActionDialog from './ActionDialog';
import ScheduleLoadFailed from './LoadFailed';
import { useLocalize } from '~/hooks';
import ScheduleTable from './Table';

/** Sentinel for the "all knowledge bases" option, which has no id of its own. */
const ALL = '__all__';

/**
 * Every schedule the caller can see, filterable by knowledge base.
 *
 * Creating one needs a knowledge base to scope the dataset picker, so the
 * button only becomes available once a specific one is chosen — pwc_tars' own
 * page handled that by navigating away instead.
 */
export default function ScheduleManager() {
  const localize = useLocalize();
  const { i18n } = useTranslation();

  const [knowledgeBaseId, setKnowledgeBaseId] = useState(ALL);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TTarsSchedule | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: knowledgeBases = [] } = useTarsKnowledgeBasesQuery();
  const scoped = knowledgeBaseId === ALL ? undefined : knowledgeBaseId;
  const schedulesQuery = useTarsSchedulesQuery(scoped);

  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') {
      return schedules;
    }
    return schedules.filter(
      (schedule) =>
        schedule.dataset_name.toLowerCase().includes(needle) ||
        schedule.knowledge_base_name.toLowerCase().includes(needle),
    );
  }, [schedules, search]);

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
    if (filtered.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-text-secondary">
          <CalendarClock className="size-10 text-text-tertiary" aria-hidden />
          {localize(
            schedules.length === 0 ? 'com_ui_tars_sched_empty' : 'com_ui_tars_kb_ds_no_match',
          )}
        </div>
      );
    }
    return (
      <ScheduleTable
        schedules={filtered}
        locale={i18n.language}
        showKnowledgeBase
        onSelect={setSelected}
      />
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label id="tars-sched-kb-label">{localize('com_ui_tars_nav_kb_list')}</Label>
          <Dropdown
            value={knowledgeBaseId}
            onChange={setKnowledgeBaseId}
            options={[
              { value: ALL, label: localize('com_ui_tars_sched_all_knowledge_bases') },
              ...knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name })),
            ]}
            aria-labelledby="tars-sched-kb-label"
            searchable={knowledgeBases.length > 8}
            searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
            searchEmptyText={localize('com_ui_no_results_found')}
            sizeClasses="min-w-[16rem]"
          />
        </div>

        <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('com_ui_tars_kb_ds_search')}
            aria-label={localize('com_ui_tars_kb_ds_search')}
            className="pl-9"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => void schedulesQuery.refetch()}
          disabled={schedulesQuery.isFetching}
          aria-label={localize('com_ui_refresh')}
          title={localize('com_ui_refresh')}
          className="text-text-secondary"
        >
          {schedulesQuery.isFetching ? (
            <Spinner className="size-4" />
          ) : (
            <RotateCw className="size-4" aria-hidden />
          )}
        </Button>

        <Button
          variant="submit"
          onClick={() => setCreating(true)}
          disabled={scoped == null}
          title={scoped == null ? localize('com_ui_tars_sched_pick_kb_first') : undefined}
          className="ml-auto gap-1.5"
        >
          <Plus className="size-4" aria-hidden />
          {localize('com_ui_tars_sched_new')}
        </Button>
      </div>

      {scoped == null && (
        /* Creating needs a knowledge base to scope the dataset picker. */
        <p className="text-xs text-text-secondary">{localize('com_ui_tars_sched_pick_kb_first')}</p>
      )}

      {body()}

      {selected != null && (
        <ScheduleActionDialog
          schedule={selected}
          locale={i18n.language}
          onClose={() => setSelected(null)}
        />
      )}

      {creating && scoped != null && (
        <ScheduleCreateDialog
          knowledgeBaseId={scoped}
          schedules={schedules}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
