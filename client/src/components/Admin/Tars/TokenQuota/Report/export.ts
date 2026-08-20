import { dataService } from 'librechat-data-provider';
import type { TTarsTokenReportRange } from 'librechat-data-provider';
import type { useLocalize } from '~/hooks';
import { toCsvBlob, downloadBlob } from '../../Users/helpers';

type Localize = ReturnType<typeof useLocalize>;

/**
 * Chrome only lets a page start one download per gesture unless they are spaced
 * out; a frame between them is enough for all three to land.
 */
const SPACING_MS = 150;

const stampOf = (range: TTarsTokenReportRange): string =>
  `${range.start_date.replace(/-/g, '')}_${range.end_date.replace(/-/g, '')}`;

const text = (value: string | number | null | undefined): string =>
  value == null ? '' : String(value);

/**
 * The report export, as the same three datasets the pwc_tars page wrote to one
 * workbook: group totals, every account's totals, and the raw usage log. They
 * ship as three CSVs because this client deliberately has no spreadsheet
 * dependency — see the note on `toCsvBlob`.
 */
export async function downloadTokenReportCsvs(
  range: TTarsTokenReportRange,
  localize: Localize,
): Promise<void> {
  const data = await dataService.getTarsTokenReportExport(range);
  const stamp = stampOf(range);

  const files: { name: string; headers: string[]; rows: string[][] }[] = [
    {
      name: `TokenReport_Groups_${stamp}.csv`,
      headers: [
        localize('com_ui_tars_quota_col_group'),
        localize('com_ui_tars_report_col_users'),
        localize('com_ui_tars_report_col_logs'),
        localize('com_ui_tars_report_col_tokens'),
      ],
      rows: data.group_usage.map((group) => [
        text(group.user_group_name ?? group.user_group_id),
        text(group.user_count),
        text(group.log_count),
        text(group.total_tokens),
      ]),
    },
    {
      name: `TokenReport_Users_${stamp}.csv`,
      headers: [
        localize('com_ui_tars_report_col_username'),
        localize('com_ui_tars_report_col_display_name'),
        localize('com_ui_tars_report_col_logs'),
        localize('com_ui_tars_usage_input_tokens'),
        localize('com_ui_tars_usage_output_tokens'),
        localize('com_ui_tars_report_col_tokens'),
      ],
      rows: data.usage_summary.map((user) => [
        text(user.username),
        text(user.display_name),
        text(user.log_count),
        text(user.prompt_tokens),
        text(user.completion_tokens),
        text(user.total_tokens),
      ]),
    },
    {
      name: `TokenReport_Logs_${stamp}.csv`,
      headers: [
        localize('com_ui_tars_report_col_time'),
        localize('com_ui_tars_report_col_username'),
        localize('com_ui_tars_report_col_display_name'),
        localize('com_ui_tars_quota_col_group'),
        localize('com_ui_tars_quota_col_provider'),
        localize('com_ui_tars_usage_input_tokens'),
        localize('com_ui_tars_usage_output_tokens'),
        localize('com_ui_tars_report_col_tokens'),
      ],
      rows: data.user_usage_log.map((log) => [
        text(log.created_at),
        text(log.username),
        text(log.display_name),
        text(log.user_group_name),
        text(log.provider),
        text(log.prompt_tokens),
        text(log.completion_tokens),
        text(log.total_tokens),
      ]),
    },
  ];

  for (const file of files) {
    downloadBlob(toCsvBlob(file.headers, file.rows), file.name);
    await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
  }
}
