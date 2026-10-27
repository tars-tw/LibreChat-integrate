import {
  isTarsEmbeddingSplitBy,
  isTarsEmbeddingGroupBy,
  isTarsEmbeddingRangeTooLong,
  TARS_EMBEDDING_MAX_RANGE_DAYS,
  tarsEmbeddingUsageConfigSchema,
} from 'librechat-data-provider';
import type {
  TTarsEmbeddingUsageConfig,
  TTarsEmbeddingUsageQuery,
  TTarsTokenReportRange,
  TTarsEmbeddingUsageSummary,
  TTarsMessageEmbeddingUsage,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { LangflowServiceFetchOptions } from './langflow/client';

/**
 * Embedding token usage (pwc_tars `embedding_usage_log`). Kept apart from the
 * chat token report: it never counts against a user's quota, so it is shown as
 * a section of its own rather than folded into the chat totals.
 */

/**
 * Served by pwc_tars's `/api/langflow-service` blueprint, so it is authenticated
 * with the service key. That key reads usage of the whole organisation, so the
 * LibreChat routes calling these must stay behind `requireTarsAdmin`.
 */
const EMBEDDING_USAGE_BASE = '/api/langflow-service/embedding-usage';

/** The summary route's query string, as Express hands it over. */
export interface TarsEmbeddingUsageRequestQuery {
  group_by?: string | string[];
  split_by?: string | string[];
  user_group_ids?: string | string[];
  user_id?: string | string[];
}

export type TarsEmbeddingUsageRequest =
  | { query: TTarsEmbeddingUsageQuery; error?: undefined }
  | { error: string; query?: undefined };

/** `tarsEmbeddingUsage` from librechat.yaml, or its defaults when unset or invalid. */
export function getTarsEmbeddingUsageConfig(
  appConfig?: Pick<AppConfig, 'config'> | null,
): TTarsEmbeddingUsageConfig {
  const parsed = tarsEmbeddingUsageConfigSchema.safeParse(
    appConfig?.config?.tarsEmbeddingUsage ?? {},
  );
  return parsed.success ? parsed.data : tarsEmbeddingUsageConfigSchema.parse({});
}

/**
 * `user_group_ids` (comma-separated, or repeated) and `user_id` from a request
 * query. Blank values mean no filter, as they would match no row upstream.
 */
function filtersOf(
  query: TarsEmbeddingUsageRequestQuery,
): Pick<TTarsEmbeddingUsageQuery, 'user_group_ids' | 'user_id'> {
  const groupIds = [query.user_group_ids ?? []]
    .flat()
    .flatMap((value) => String(value).split(','))
    .map((id) => id.trim())
    .filter((id) => id !== '');
  const userId = typeof query.user_id === 'string' ? query.user_id.trim() : '';
  return {
    user_group_ids: groupIds.length > 0 ? groupIds : undefined,
    user_id: userId !== '' ? userId : undefined,
  };
}

/**
 * The summary request for an already validated date range, refusing what
 * pwc_tars would: a range past its limit, an unknown `group_by` (default
 * `model`), and a `split_by` on anything but a daily report.
 */
export function parseTarsEmbeddingUsageRequest(
  range: TTarsTokenReportRange,
  query: TarsEmbeddingUsageRequestQuery,
): TarsEmbeddingUsageRequest {
  if (isTarsEmbeddingRangeTooLong(range)) {
    return { error: `The range may cover at most ${TARS_EMBEDDING_MAX_RANGE_DAYS} days` };
  }
  const groupBy = query.group_by ?? 'model';
  if (!isTarsEmbeddingGroupBy(groupBy)) {
    return { error: 'Unknown group_by' };
  }
  const splitBy = query.split_by || undefined;
  if (splitBy !== undefined && (groupBy !== 'day' || !isTarsEmbeddingSplitBy(splitBy))) {
    return { error: 'split_by only applies to a daily report' };
  }
  return {
    query: {
      ...range,
      group_by: groupBy,
      split_by: isTarsEmbeddingSplitBy(splitBy) ? splitBy : undefined,
      ...filtersOf(query),
    },
  };
}

/** The envelope's `data`, or an error when pwc_tars answered without one. */
function required<T>(data: T | undefined, what: string): T {
  if (data == null) {
    throw new Error(`pwc_tars returned no ${what}`);
  }
  return data;
}

export interface TarsEmbeddingUsageClient {
  /** Usage per group for the period. */
  fetchSummary: (query: TTarsEmbeddingUsageQuery) => Promise<TTarsEmbeddingUsageSummary>;
  /**
   * The usage one chat message spent: its knowledge-base searches and memory
   * lookups. A LibreChat turn's response messageId is the pwc_tars message id,
   * so the audit report's ids work as they are.
   */
  fetchMessage: (messageId: string) => Promise<TTarsMessageEmbeddingUsage>;
}

export interface TarsEmbeddingUsageDeps {
  /** Reaches pwc_tars's langflow-service routes; the app passes `langflowServiceFetch`. */
  request: <T>(path: string, options: LangflowServiceFetchOptions) => Promise<T | undefined>;
  config: TTarsEmbeddingUsageConfig;
}

export function createTarsEmbeddingUsageClient({
  request,
  config,
}: TarsEmbeddingUsageDeps): TarsEmbeddingUsageClient {
  return {
    fetchSummary: async (query) => {
      const data = await request<TTarsEmbeddingUsageSummary>(`${EMBEDDING_USAGE_BASE}/summary`, {
        method: 'GET',
        query: {
          group_by: query.group_by,
          split_by: query.group_by === 'day' ? query.split_by : undefined,
          start_date: query.start_date,
          end_date: query.end_date,
          user_group_ids: query.user_group_ids?.length ? query.user_group_ids.join(',') : undefined,
          user_id: query.user_id || undefined,
        },
        timeoutMs: config.reportTimeoutMs,
      });
      return required(data, 'embedding usage summary');
    },
    fetchMessage: async (messageId) => {
      const data = await request<TTarsMessageEmbeddingUsage>(
        `${EMBEDDING_USAGE_BASE}/messages/${encodeURIComponent(messageId)}`,
        { method: 'GET', timeoutMs: config.messageTimeoutMs },
      );
      return required(data, 'embedding usage of the message');
    },
  };
}
