import { toTarsDateTime } from './syslogs';
import { tarsFetch } from './client';

/** Running a job on demand crawls or downloads before it answers. */
const RUN_TIMEOUT_MS = 300000;

/** The dataset kinds pwc_tars can schedule. API datasets are read-only here. */
export const TARS_SCHEDULE_DATASET_TYPES = ['website', 'file_system', 'api'] as const;
export type TarsScheduleDatasetType = (typeof TARS_SCHEDULE_DATASET_TYPES)[number];

/**
 * One recurring dataset refresh (`DatasetScheduleRecord.to_json()`), enriched by
 * `get_schedules` with the dataset and knowledge-base names.
 *
 * `last_status` is the one the UI reads — `status` is an unused integer flag.
 * pwc_tars rewrites `last_status` to `stopped` in the response when `end_time`
 * has passed, so it does not always match what is stored.
 */
export interface TarsSchedule {
  id: string;
  dataset_id: string;
  dataset_type: string;
  dataset_name: string;
  knowledge_base_id: string;
  knowledge_base_name: string;
  frequency: number;
  frequency_unit: string;
  start_time: string | null;
  end_time: string | null;
  last_execute_time: string | null;
  next_execute_time: string | null;
  execution_duration: number | null;
  execution_type: string | null;
  execution_count: number;
  retry_count: number;
  max_retry_count: number;
  last_status: string | null;
  description: string | null;
  message: string | null;
  /** Only meaningful for `file_system` schedules; it lives on the link row. */
  is_sync_all: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TarsScheduleInput {
  datasetId: string;
  datasetType: TarsScheduleDatasetType;
  knowledgeBaseId: string;
  frequency: number;
  frequencyUnit: string;
  /** `YYYY-MM-DDTHH:MM` from a `datetime-local` input. */
  startTime: string;
  endTime?: string;
  description?: string;
}

export interface TarsScheduleUpdate {
  frequency: number;
  frequencyUnit: string;
  startTime: string;
  endTime?: string;
}

/**
 * The schedules of one knowledge base, or of every knowledge base the caller
 * may see (`GET /api/schedule/get_schedules`).
 */
export async function fetchTarsSchedules(
  tarsId: string,
  knowledgeBaseId?: string,
  baseUrl?: string,
): Promise<TarsSchedule[]> {
  const data = await tarsFetch<{ schedule_list?: TarsSchedule[] }>('/api/schedule/get_schedules', {
    query: {
      user_id: tarsId,
      /** Omitting it asks for every accessible knowledge base. */
      ...(knowledgeBaseId != null && knowledgeBaseId !== ''
        ? { knowledge_base_id: knowledgeBaseId }
        : {}),
    },
    baseUrl,
  });
  return data?.schedule_list ?? [];
}

/**
 * Schedules a dataset (`POST /api/schedule/create_schedule`).
 *
 * pwc_tars registers the APScheduler job as part of this call, so a successful
 * response means the job is already armed.
 */
export async function createTarsSchedule(
  tarsId: string,
  input: TarsScheduleInput,
  baseUrl?: string,
): Promise<TarsSchedule | null> {
  const data = await tarsFetch<{ schedule?: TarsSchedule }>('/api/schedule/create_schedule', {
    method: 'POST',
    baseUrl,
    body: {
      dataset_id: input.datasetId,
      dataset_type: input.datasetType,
      knowledge_base_id: input.knowledgeBaseId,
      frequency: input.frequency,
      frequency_unit: input.frequencyUnit,
      start_time: toTarsDateTime(input.startTime),
      end_time: toTarsDateTime(input.endTime),
      execution_type: 'auto',
      description: input.description ?? '',
      created_by: tarsId,
      status: 1,
    },
  });
  return data?.schedule ?? null;
}

/**
 * Changes the cadence (`POST /api/schedule/update_schedule`).
 *
 * `enable` is deliberately not sent: pwc_tars forwards it to a model that has
 * no such column, so it is silently dropped. Turning a schedule on or off is
 * `restartTarsSchedule` / `stopTarsSchedule`.
 */
export async function updateTarsSchedule(
  scheduleId: string,
  update: TarsScheduleUpdate,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/schedule/update_schedule', {
    method: 'POST',
    baseUrl,
    body: {
      schedule_id: scheduleId,
      /** Required by the endpoint's field check even though it is ignored. */
      enable: true,
      frequency: update.frequency,
      frequency_unit: update.frequencyUnit,
      start_time: toTarsDateTime(update.startTime),
      end_time: toTarsDateTime(update.endTime),
    },
  });
}

export async function deleteTarsSchedule(scheduleId: string, baseUrl?: string): Promise<void> {
  await tarsFetch(`/api/schedule/delete_schedule/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
    baseUrl,
  });
}

/**
 * Runs the job once, now (`GET /api/knowledge_detail/run_scheduled_job_now`).
 * pwc_tars exposes it as a GET even though it acts; the LibreChat route in
 * front of it is a POST.
 */
export async function runTarsScheduleNow(scheduleId: string, baseUrl?: string): Promise<void> {
  await tarsFetch('/api/knowledge_detail/run_scheduled_job_now', {
    query: { schedule_id: scheduleId },
    timeoutMs: RUN_TIMEOUT_MS,
    baseUrl,
  });
}

/** Removes the job from the scheduler (`GET .../stop_scheduled_job`). */
export async function stopTarsSchedule(scheduleId: string, baseUrl?: string): Promise<void> {
  await tarsFetch('/api/knowledge_detail/stop_scheduled_job', {
    query: { schedule_id: scheduleId },
    baseUrl,
  });
}

/** Re-arms a stopped job (`POST /api/schedule/restart_scheduled_job`). */
export async function restartTarsSchedule(scheduleId: string, baseUrl?: string): Promise<void> {
  await tarsFetch('/api/schedule/restart_scheduled_job', {
    method: 'POST',
    body: { schedule_id: scheduleId },
    baseUrl,
  });
}

/**
 * Whether the run should pull every file under the path
 * (`PUT /api/schedule/update_sync_all/<id>`).
 *
 * The flag lives on the document-group link rather than the schedule, so this
 * only applies to `file_system` schedules.
 */
export async function updateTarsScheduleSyncAll(
  scheduleId: string,
  isSyncAll: boolean,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(`/api/schedule/update_sync_all/${encodeURIComponent(scheduleId)}`, {
    method: 'PUT',
    body: { is_sync_all: isSyncAll },
    baseUrl,
  });
}
