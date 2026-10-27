import { useMemo, useState } from 'react';
import { Alert, Spinner } from '@librechat/client';
import {
  isTarsEmbeddingSplitBy,
  TARS_EMBEDDING_DIMENSIONS,
  isTarsEmbeddingRangeTooLong,
  TARS_EMBEDDING_MAX_RANGE_DAYS,
} from 'librechat-data-provider';
import type {
  TTarsTokenReportRange,
  TTarsEmbeddingSplitBy,
  TTarsEmbeddingUsageRow,
  TTarsEmbeddingUsageSummary,
} from 'librechat-data-provider';
import {
  stackEmbeddingDays,
  embeddingValueLabel,
  EMBEDDING_DIMENSION_LABEL_KEYS,
} from './embedding';
import { useTarsEmbeddingUsageQuery } from '~/data-provider';
import { getResponseStatus } from '~/utils/errors';
import { SELECT_CLASS } from '../helpers';
import { formatTokens } from './helpers';
import { useLocalize } from '~/hooks';
import Stacked from './Stacked';
import Ranked from './Ranked';
import Stat from './Stat';

/**
 * The dimension a summary was grouped by. Each part is labelled by it rather
 * than by the picker, which moves on while the previous view's rows are still
 * shown (`keepPreviousData`).
 */
const groupedBy = (
  summary: TTarsEmbeddingUsageSummary | undefined,
  fallback: TTarsEmbeddingSplitBy,
): TTarsEmbeddingSplitBy => {
  const by = summary?.group_by;
  return isTarsEmbeddingSplitBy(by) ? by : fallback;
};

/**
 * Embedding token usage for the report's period (pwc_tars `embedding_usage_log`).
 * A section of its own because it never counts against a chat quota: the daily
 * chart stacks each day by the chosen dimension, then that dimension's split and
 * the model split. `userGroupIds` / `userId` narrow every part of it, totals
 * included. Hidden when the request is refused (401/403).
 */
export default function EmbeddingUsage({
  range,
  userGroupIds,
  userId,
  compact,
}: {
  range: TTarsTokenReportRange;
  userGroupIds?: string[];
  userId?: string;
  compact?: boolean;
}) {
  const localize = useLocalize();
  const [dimension, setDimension] = useState<TTarsEmbeddingSplitBy>('purpose');
  /** The model split is always shown, so a model view gives the second list to purpose. */
  const secondBy: TTarsEmbeddingSplitBy = dimension === 'model' ? 'purpose' : 'model';
  const tooLong = isTarsEmbeddingRangeTooLong(range);
  const filtered = (userGroupIds?.length ?? 0) > 0 || !!userId;

  const base = useMemo(
    () => ({
      ...range,
      ...(userGroupIds?.length ? { user_group_ids: userGroupIds } : {}),
      ...(userId ? { user_id: userId } : {}),
    }),
    [range, userGroupIds, userId],
  );
  const dayQuery = useTarsEmbeddingUsageQuery(
    tooLong ? null : { ...base, group_by: 'day', split_by: dimension },
  );
  const dimensionQuery = useTarsEmbeddingUsageQuery(
    tooLong ? null : { ...base, group_by: dimension },
  );
  const secondQuery = useTarsEmbeddingUsageQuery(tooLong ? null : { ...base, group_by: secondBy });

  const labelFor = (by: TTarsEmbeddingSplitBy) => (row: TTarsEmbeddingUsageRow) =>
    embeddingValueLabel(by, row.group, row.group_label, localize);

  const dayData = dayQuery.data;
  const chartBy = dayData?.split_by ?? dimension;
  const rankedBy = groupedBy(dimensionQuery.data, dimension);
  const secondRankedBy = groupedBy(secondQuery.data, secondBy);

  const stacked = useMemo(
    () =>
      stackEmbeddingDays(
        dayData?.rows ?? [],
        {
          dimension: chartBy,
          labelOf: (row) => embeddingValueLabel(chartBy, row.split, row.split_label, localize),
          otherLabel: localize('com_ui_tars_embedding_other'),
        },
        dayData,
      ),
    [dayData, chartBy, localize],
  );

  const queries = [dayQuery, dimensionQuery, secondQuery];
  if (queries.some((query) => [401, 403].includes(getResponseStatus(query.error) ?? 0))) {
    return null;
  }

  const totals = dayData?.totals;
  const hints = [
    chartBy === 'domain' ? localize('com_ui_tars_embedding_hint_domain') : null,
    chartBy === 'knowledge_base' ? localize('com_ui_tars_embedding_hint_knowledge_base') : null,
    filtered ? localize('com_ui_tars_embedding_hint_filtered') : null,
    dayData?.rows_cut_off ? localize('com_ui_tars_embedding_day_cut_off') : null,
  ].filter((hint): hint is string => hint != null);

  const toItems = (by: TTarsEmbeddingSplitBy, rows: TTarsEmbeddingUsageRow[] | undefined) =>
    (rows ?? [])
      .filter((row) => row.input_tokens > 0)
      .map((row) => ({
        key: String(row.group ?? ''),
        label: labelFor(by)(row),
        value: row.input_tokens,
      }));

  return (
    <section className="border-border-light space-y-4 rounded-xl border p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-text-primary text-base font-semibold">
            {localize('com_ui_tars_embedding_title')}
          </h2>
          <p className="text-text-secondary text-xs">
            {localize('com_ui_tars_embedding_not_in_quota')}
          </p>
        </div>
        {!tooLong && (
          <label className="text-text-secondary flex items-center gap-2 text-sm">
            {localize('com_ui_tars_embedding_view_by')}
            <select
              className={SELECT_CLASS}
              value={dimension}
              onChange={(event) => setDimension(event.target.value as TTarsEmbeddingSplitBy)}
            >
              {TARS_EMBEDDING_DIMENSIONS.map((item) => (
                <option key={item} value={item}>
                  {localize(EMBEDDING_DIMENSION_LABEL_KEYS[item])}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {tooLong && (
        <p className="text-text-secondary text-sm">
          {localize('com_ui_tars_embedding_range_too_long', {
            0: String(TARS_EMBEDDING_MAX_RANGE_DAYS),
          })}
        </p>
      )}

      {!tooLong && queries.some((query) => query.isError) && (
        <Alert variant="error">{localize('com_ui_tars_embedding_load_failed')}</Alert>
      )}

      {!tooLong && dayQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Spinner className="size-5" />
        </div>
      )}

      {!tooLong && totals != null && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              compact={compact}
              label={localize('com_ui_tars_embedding_col_tokens')}
              value={formatTokens(totals.input_tokens)}
            />
            <Stat
              compact={compact}
              label={localize('com_ui_tars_embedding_requests')}
              value={formatTokens(totals.request_count)}
            />
            <Stat
              compact={compact}
              label={localize('com_ui_tars_embedding_col_texts')}
              value={formatTokens(totals.text_count)}
            />
          </div>

          <Stacked
            title={localize('com_ui_tars_embedding_by_day')}
            series={stacked.series}
            days={stacked.days}
            hints={hints}
            compact={compact}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1">
              <Ranked
                title={localize(EMBEDDING_DIMENSION_LABEL_KEYS[rankedBy])}
                items={toItems(rankedBy, dimensionQuery.data?.rows)}
              />
              {dimensionQuery.data?.rows_cut_off && (
                <p className="text-text-secondary text-xs">
                  {localize('com_ui_tars_embedding_rows_cut_off')}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Ranked
                title={localize(EMBEDDING_DIMENSION_LABEL_KEYS[secondRankedBy])}
                items={toItems(secondRankedBy, secondQuery.data?.rows)}
              />
              {secondQuery.data?.rows_cut_off && (
                <p className="text-text-secondary text-xs">
                  {localize('com_ui_tars_embedding_rows_cut_off')}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
