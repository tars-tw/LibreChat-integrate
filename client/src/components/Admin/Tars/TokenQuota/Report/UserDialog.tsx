import { Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsTokenUserUsage } from 'librechat-data-provider';
import { useTarsTokenReportUserQuery } from '~/data-provider';
import { formatTokens } from './helpers';
import { useLocalize } from '~/hooks';
import Trend from './Trend';

/** One headline number, matching the report's own tiles. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-light p-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

/**
 * One person's usage across the queried period: the prompt/completion split the
 * group tables cannot show, plus their day-by-day series.
 */
export default function UserDialog({
  user,
  range,
  onClose,
}: {
  user: TTarsTokenUserUsage | null;
  range: { start_date: string; end_date: string };
  onClose: () => void;
}) {
  const localize = useLocalize();
  const usageQuery = useTarsTokenReportUserQuery(
    user == null ? null : { ...range, user_id: String(user.user_id ?? '') },
  );
  const usage = usageQuery.data;

  if (user == null) {
    return null;
  }

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={`${user.display_name ?? user.username ?? ''}`}
        showCloseButton={true}
        className="w-11/12 md:max-w-4xl"
        main={
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              {`${localize('com_ui_tars_audit_period')}: ${range.start_date} ~ ${range.end_date}`}
            </p>

            {usageQuery.isFetching && (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            )}

            {!usageQuery.isFetching && usage == null && (
              <p className="py-12 text-center text-sm text-text-secondary">
                {localize('com_ui_tars_audit_no_data')}
              </p>
            )}

            {!usageQuery.isFetching && usage != null && (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat
                    label={localize('com_ui_tars_report_col_tokens')}
                    value={formatTokens(usage.total_tokens)}
                  />
                  <Stat
                    label={localize('com_ui_tars_usage_input_tokens')}
                    value={formatTokens(usage.prompt_tokens)}
                  />
                  <Stat
                    label={localize('com_ui_tars_usage_output_tokens')}
                    value={formatTokens(usage.completion_tokens)}
                  />
                  <Stat
                    label={localize('com_ui_tars_report_col_logs')}
                    value={formatTokens(usage.log_count)}
                  />
                </div>

                <Trend
                  days={usage.daily_usage}
                  title={localize('com_ui_tars_report_daily_usage')}
                  compact={true}
                />
              </>
            )}
          </div>
        }
      />
    </OGDialog>
  );
}
