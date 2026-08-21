import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dropdown,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsSchedule, TTarsScheduleDatasetType } from 'librechat-data-provider';
import type { ScheduleSettingsValue } from './Settings';
import { useCreateTarsScheduleMutation, useTarsKnowledgeBaseDatasetsQuery } from '~/data-provider';
import ScheduleSettings, { settingsInvalid } from './Settings';
import { datasetTypeKey, defaultStart } from './helpers';
import { useLocalize } from '~/hooks';

interface Candidate {
  id: string;
  type: TTarsScheduleDatasetType;
  name: string;
}

/** `type:id`, so two datasets of different kinds can never collide. */
const optionValue = (candidate: Candidate) => `${candidate.type}:${candidate.id}`;

/**
 * Schedules a dataset that is already imported.
 *
 * pwc_tars' own page could only set a schedule during import, which meant
 * re-importing to add one afterwards. `create_schedule` never required that —
 * it takes the dataset id, its kind and the knowledge base.
 *
 * Only websites and document groups are offered: those are the two kinds this
 * fork manages, and a dataset that already has a schedule is left out so a
 * second one cannot be armed against it.
 */
export default function ScheduleCreateDialog({
  knowledgeBaseId,
  schedules,
  onClose,
}: {
  knowledgeBaseId: string;
  schedules: TTarsSchedule[];
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const datasetsQuery = useTarsKnowledgeBaseDatasetsQuery(knowledgeBaseId);
  const [selected, setSelected] = useState('');
  const [value, setValue] = useState<ScheduleSettingsValue>({
    frequency: '1',
    frequencyUnit: 'day',
    startTime: defaultStart(),
    endTime: '',
  });

  const candidates: Candidate[] = useMemo(() => {
    const data = datasetsQuery.data;
    if (data == null) {
      return [];
    }
    const scheduled = new Set(
      schedules.map((schedule) => `${schedule.dataset_type}:${schedule.dataset_id}`),
    );
    const websites: Candidate[] = data.websites.map((site) => ({
      id: site.id,
      type: 'website' as const,
      name: site.name ?? site.url ?? site.id,
    }));
    const groups: Candidate[] = data.file_systems.map((link) => ({
      id: link.dataset_file_system_id,
      type: 'file_system' as const,
      name: link.name ?? link.dataset_file_system_id,
    }));
    return [...websites, ...groups].filter((candidate) => !scheduled.has(optionValue(candidate)));
  }, [datasetsQuery.data, schedules]);

  useEffect(() => {
    if (selected === '' && candidates.length > 0) {
      setSelected(optionValue(candidates[0]));
    }
  }, [candidates, selected]);

  const createMutation = useCreateTarsScheduleMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_sched_created'), status: 'success' });
      onClose();
    },
    onError: () =>
      showToast({ message: localize('com_ui_tars_sched_create_failed'), status: 'error' }),
  });

  const chosen = candidates.find((candidate) => optionValue(candidate) === selected);
  const canCreate = chosen != null && !settingsInvalid(value) && !createMutation.isLoading;

  /** Loading, nothing left to schedule, and the form are three outcomes. */
  const body = () => {
    if (datasetsQuery.isLoading) {
      return (
        <div className="flex h-32 items-center justify-center">
          <Spinner />
        </div>
      );
    }
    if (candidates.length === 0) {
      return (
        <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
          {localize('com_ui_tars_sched_no_candidates')}
        </p>
      );
    }
    return (
      <>
        <div className="space-y-1.5">
          <Label id="tars-sched-dataset-label">{localize('com_ui_tars_sched_dataset')}</Label>
          <Dropdown
            value={selected}
            onChange={setSelected}
            options={candidates.map((candidate) => {
              const key = datasetTypeKey(candidate.type);
              return {
                value: optionValue(candidate),
                label: key != null ? `${candidate.name} (${localize(key)})` : candidate.name,
              };
            })}
            aria-labelledby="tars-sched-dataset-label"
            searchable={candidates.length > 8}
            searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
            searchEmptyText={localize('com_ui_no_results_found')}
            sizeClasses="w-full"
            className="w-full"
          />
        </div>

        <ScheduleSettings value={value} onChange={setValue} />
      </>
    );
  };

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && !createMutation.isLoading && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_sched_new')}
        className="w-11/12 md:max-w-lg"
        showCloseButton={true}
        mainClassName="min-w-0"
        main={<div className="min-w-0 space-y-4">{body()}</div>}
        buttons={
          <Button
            variant="submit"
            disabled={!canCreate}
            onClick={() =>
              chosen != null &&
              createMutation.mutate({
                datasetId: chosen.id,
                datasetType: chosen.type,
                knowledgeBaseId,
                frequency: Number(value.frequency),
                frequencyUnit: value.frequencyUnit,
                startTime: value.startTime,
                endTime: value.endTime === '' ? undefined : value.endTime,
              })
            }
          >
            {createMutation.isLoading ? <Spinner className="size-4" /> : localize('com_ui_create')}
          </Button>
        }
      />
    </OGDialog>
  );
}
