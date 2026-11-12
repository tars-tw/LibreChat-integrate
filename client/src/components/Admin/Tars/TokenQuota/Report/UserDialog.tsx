import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TTarsTokenUserUsage } from 'librechat-data-provider';
import { useTarsTokenReportUserQuery } from '~/data-provider';
import { downloadPersonReportCsvs } from './export';
import EmbeddingUsage from './EmbeddingUsage';
import { formatTokens } from './helpers';
import { personName } from '../helpers';
import { useLocalize } from '~/hooks';
import Trend from './Trend';
import Stat from './Stat';

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
  const { showToast } = useToastContext();
  const [exporting, setExporting] = useState(false);

  const userId = user?.user_id == null ? '' : String(user.user_id);
  const usageQuery = useTarsTokenReportUserQuery(
    user == null ? null : { ...range, user_id: userId },
  );
  const usage = usageQuery.data;

  if (user == null) {
    return null;
  }

  const handleExport = async () => {
    if (exporting) {
      return;
    }

    setExporting(true);
    try {
      const { embeddingLeftOut } = await downloadPersonReportCsvs(
        range,
        {
          id: userId,
          username: user.username,
          display_name: user.display_name,
          email: user.email,
        },
        localize,
      );

      if (embeddingLeftOut != null) {
        showToast({
          message:
            embeddingLeftOut === 'range'
              ? localize('com_ui_tars_embedding_export_skipped', {
                  0: 'TARS_EMBEDDING_MAX_RANGE_DAYS',
                })
              : localize('com_ui_tars_embedding_export_failed'),
          status: 'warning',
        });
      }
    } catch {
      showToast({
        message: localize('com_ui_tars_report_export_failed'),
        status: 'error',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={personName(user)}
        description={user.email ?? undefined}
        showCloseButton={true}
        className="w-11/12 md:max-w-4xl"
        main={
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-text-secondary text-sm">
                {`${localize('com_ui_tars_audit_period')}: ${range.start_date} ~ ${range.end_date}`}
              </p>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={handleExport}
              >
                {exporting ? (
                  <Spinner className="mr-2 size-4" />
                ) : (
                  <Download className="mr-2 size-4" aria-hidden />
                )}
                {localize('com_ui_tars_report_export')}
              </Button>
            </div>

            {usageQuery.isFetching && (
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            )}

            {!usageQuery.isFetching && usage == null && (
              <p className="text-text-secondary py-12 text-center text-sm">
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

            {userId !== '' && <EmbeddingUsage range={range} userId={userId} compact />}
          </div>
        }
      />
    </OGDialog>
  );
}
