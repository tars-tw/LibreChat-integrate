import {
  dataService,
  TARS_EMBEDDING_GROUP_BY,
  isTarsEmbeddingRangeTooLong,
} from 'librechat-data-provider';
import type { TTarsTokenReportRange } from 'librechat-data-provider';
import type { useLocalize } from '~/hooks';
import { embeddingValueLabel, EMBEDDING_DIMENSION_LABEL_KEYS } from './embedding';
import { toCsvBlob, downloadBlob } from '../../Users/helpers';

type Localize = ReturnType<typeof useLocalize>;

/**
 * Chrome only lets a page start one download per gesture unless they are spaced
 * out; a frame between them is enough for every file to land.
 */
const SPACING_MS = 150;

const stampOf = (range: TTarsTokenReportRange): string =>
  `${range.start_date.replace(/-/g, '')}_${range.end_date.replace(/-/g, '')}`;

const text = (value: string | number | null | undefined): string =>
  value == null ? '' : String(value);

/**
 * The embedding usage file: the by-day, by-purpose, by-brain, by-knowledge-base
 * and by-model totals one under the other, as the pwc_tars sheet lays them out.
 * Null when it cannot be read, so the chat files still download without it.
 */
async function embeddingRows(
  range: TTarsTokenReportRange,
  localize: Localize,
): Promise<string[][] | null> {
  try {
    const reports = await Promise.all(
      TARS_EMBEDDING_GROUP_BY.map((group_by) =>
        dataService.getTarsEmbeddingUsageSummary({ ...range, group_by }),
      ),
    );
    return reports.flatMap((report, index) => {
      const by = TARS_EMBEDDING_GROUP_BY[index];
      const dimension =
        by === 'day'
          ? localize('com_ui_tars_embedding_by_day')
          : localize(EMBEDDING_DIMENSION_LABEL_KEYS[by]);
      return report.rows.map((row) => [
        dimension,
        by === 'day'
          ? text(row.group)
          : embeddingValueLabel(by, row.group, row.group_label, localize),
        text(row.input_tokens),
        text(row.request_count),
        text(row.text_count),
      ]);
    });
  } catch {
    return null;
  }
}

/** Why an export leaves the embedding usage out: a range pwc_tars will not summarize, or a failed read. */
export type EmbeddingLeftOut = 'range' | 'failed';

/**
 * The report export, as the same datasets the pwc_tars page wrote to one
 * workbook: group totals, every account's totals, the raw usage log, and the
 * embedding usage. They ship as separate CSVs because this client deliberately
 * has no spreadsheet dependency — see the note on `toCsvBlob`.
 *
 * Resolves why the embedding file was left out, if it was, so the caller can
 * say why it is missing. A period with no embedding usage has no file either,
 * which needs no explanation.
 */
export async function downloadTokenReportCsvs(
  range: TTarsTokenReportRange,
  localize: Localize,
): Promise<{ embeddingLeftOut: EmbeddingLeftOut | null }> {
  const tooLong = isTarsEmbeddingRangeTooLong(range);
  const [data, embedding] = await Promise.all([
    dataService.getTarsTokenReportExport(range),
    tooLong ? Promise.resolve(null) : embeddingRows(range, localize),
  ]);
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
  if (embedding != null && embedding.length > 0) {
    files.push({
      name: `TokenReport_Embedding_${stamp}.csv`,
      headers: [
        localize('com_ui_tars_embedding_col_dimension'),
        localize('com_ui_tars_embedding_col_item'),
        localize('com_ui_tars_embedding_col_tokens'),
        localize('com_ui_tars_embedding_requests'),
        localize('com_ui_tars_embedding_col_texts'),
      ],
      rows: embedding,
    });
  }

  for (const file of files) {
    downloadBlob(toCsvBlob(file.headers, file.rows), file.name);
    await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
  }
  if (tooLong) {
    return { embeddingLeftOut: 'range' };
  }
  return { embeddingLeftOut: embedding == null ? 'failed' : null };
}
