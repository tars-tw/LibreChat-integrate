import { X } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import type { TTarsTokenUser } from 'librechat-data-provider';
import { useTarsTokenReportUserQuery } from '~/data-provider';
import EmbeddingUsage from './EmbeddingUsage';
import { personIdentity } from '../helpers';
import { formatTokens } from './helpers';
import { useLocalize } from '~/hooks';
import Trend from './Trend';
import Stat from './Stat';

/**
 * One person's usage for the report's period, shown on the page itself: the
 * prompt/completion split, the day-by-day series and the embedding usage their
 * chats spent. It uses the same per-person report as the member dialog, so no
 * extra API is involved. Downloading is the report's own button, which exports
 * this person while one is picked.
 */
export default function PersonUsage({
  user,
  range,
  onClear,
}: {
  user: TTarsTokenUser;
  range: { start_date: string; end_date: string };
  onClear: () => void;
}) {
  const localize = useLocalize();
  const usageQuery = useTarsTokenReportUserQuery({ ...range, user_id: user.id });
  const usage = usageQuery.data;
  const { primary, secondary } = personIdentity(user, user.id);

  return (
    <section className="border-border-light rounded-xl border">
      <header className="border-border-light flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="min-w-0">
          <h2 className="text-text-primary truncate text-sm font-medium">{primary}</h2>
          {secondary != null && <p className="text-text-secondary truncate text-xs">{secondary}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-secondary hidden text-xs sm:inline">
            {`${range.start_date} ~ ${range.end_date}`}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={onClear}
            aria-label={localize('com_ui_clear')}
            title={localize('com_ui_clear')}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="space-y-4 p-4">
        {usageQuery.isFetching && (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        )}

        {!usageQuery.isFetching && usage == null && (
          <p className="text-text-secondary py-8 text-center text-sm">
            {localize('com_ui_tars_audit_no_data')}
          </p>
        )}

        {!usageQuery.isFetching && usage != null && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat
                compact
                label={localize('com_ui_tars_report_col_tokens')}
                value={formatTokens(usage.total_tokens)}
              />
              <Stat
                compact
                label={localize('com_ui_tars_usage_input_tokens')}
                value={formatTokens(usage.prompt_tokens)}
              />
              <Stat
                compact
                label={localize('com_ui_tars_usage_output_tokens')}
                value={formatTokens(usage.completion_tokens)}
              />
              <Stat
                compact
                label={localize('com_ui_tars_report_col_logs')}
                value={formatTokens(usage.log_count)}
              />
            </div>

            <Trend
              days={usage.daily_usage}
              title={localize('com_ui_tars_report_daily_usage')}
              compact
            />
          </>
        )}

        <EmbeddingUsage range={range} userId={user.id} compact />
      </div>
    </section>
  );
}
