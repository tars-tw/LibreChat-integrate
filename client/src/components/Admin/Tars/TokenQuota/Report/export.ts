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

const asTextCell = (value: string): string => `="${value}"`;

/** The optional per-day split pwc_tars returns, which the shared daily type does not declare. */
type DayParts = { prompt_tokens?: number; completion_tokens?: number };

interface CsvFile {
  name: string;
  headers: string[];
  rows: string[][];
}

async function saveFiles(files: CsvFile[]): Promise<void> {
  for (const file of files) {
    downloadBlob(toCsvBlob(file.headers, file.rows), file.name);
    await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
  }
}

/**
 * The embedding usage file: the by-day, by-purpose, by-brain, by-knowledge-base
 * and by-model totals one under the other, as the pwc_tars sheet lays them out.
 * With a `userId` it covers only that person's usage.
 * Null when it cannot be read, so the chat files still download without it.
 */
async function embeddingRows(
  range: TTarsTokenReportRange,
  localize: Localize,
  userId?: string,
): Promise<string[][] | null> {
  try {
    const groupBys = TARS_EMBEDDING_GROUP_BY.filter((group_by) => group_by !== 'domain');
    const reports = await Promise.all(
      groupBys.map((group_by) =>
        dataService.getTarsEmbeddingUsageSummary({
          ...range,
          group_by,
          ...(userId ? { user_id: userId } : {}),
        }),
      ),
    );
    return reports.flatMap((report, index) => {
      const by = groupBys[index];
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

/** Columns prepended to every row of a per-person file, so it says whose it is. */
interface Identity {
  headers: string[];
  cells: string[];
}

const embeddingFile = (
  name: string,
  rows: string[][],
  localize: Localize,
  who?: Identity,
): CsvFile => ({
  name,
  headers: [
    ...(who?.headers ?? []),
    localize('com_ui_tars_embedding_col_dimension'),
    localize('com_ui_tars_embedding_col_item'),
    localize('com_ui_tars_embedding_col_tokens'),
    localize('com_ui_tars_embedding_requests'),
    localize('com_ui_tars_embedding_col_texts'),
  ],
  rows: who == null ? rows : rows.map((row) => [...who.cells, ...row]),
});

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

  const files: CsvFile[] = [
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
    files.push(embeddingFile(`TokenReport_Embedding_${stamp}.csv`, embedding, localize));
  }

  await saveFiles(files);
  if (tooLong) {
    return { embeddingLeftOut: 'range' };
  }
  return { embeddingLeftOut: embedding == null ? 'failed' : null };
}

/**
 * One person's report: their day-by-day chat usage, and the embedding usage their
 * chats and uploads spent. Same rules as the group export for the embedding file —
 * left out for a range pwc_tars will not summarize or a failed read, and absent when
 * the person has none.
 */
export async function downloadPersonReportCsvs(
  range: TTarsTokenReportRange,
  user: {
    id: string;
    username?: string | null;
    display_name?: string | null;
    email?: string | null;
  },
  localize: Localize,
): Promise<{ embeddingLeftOut: EmbeddingLeftOut | null }> {
  const tooLong = isTarsEmbeddingRangeTooLong(range);
  const [report, embedding] = await Promise.all([
    dataService.getTarsTokenReportUser({ ...range, user_id: user.id }),
    tooLong ? Promise.resolve(null) : embeddingRows(range, localize, user.id),
  ]);
  const stamp = stampOf(range);
  const who = user.username ?? user.id;
  const identity: Identity = {
    headers: [
      localize('com_ui_tars_report_col_username'),
      localize('com_ui_tars_report_col_display_name'),
      'Email',
    ],
    cells: [text(user.username), text(user.display_name), text(user.email)],
  };

  const files: CsvFile[] = [
    {
      name: `TokenReport_User_${who}_${stamp}.csv`,
      headers: [
        ...identity.headers,
        localize('com_ui_tars_usage_col_date'),
        localize('com_ui_tars_report_col_logs'),
        localize('com_ui_tars_usage_input_tokens'),
        localize('com_ui_tars_usage_output_tokens'),
        localize('com_ui_tars_report_col_tokens'),
      ],
      rows: (report.usage?.daily_usage ?? []).map((day) => {
        const parts = day as DayParts;
        return [
          ...identity.cells,
          asTextCell(day.date),
          text(day.log_count),
          text(parts.prompt_tokens),
          text(parts.completion_tokens),
          text(day.total_tokens),
        ];
      }),
    },
  ];
  if (embedding != null && embedding.length > 0) {
    files.push(
      embeddingFile(`TokenReport_Embedding_${who}_${stamp}.csv`, embedding, localize, identity),
    );
  }

  await saveFiles(files);
  if (tooLong) {
    return { embeddingLeftOut: 'range' };
  }
  return { embeddingLeftOut: embedding == null ? 'failed' : null };
}
