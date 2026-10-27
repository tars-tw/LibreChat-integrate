import { dataService } from 'librechat-data-provider';
import type {
  TTarsEmbeddingUsageRow,
  TTarsTokenReportExport,
  TTarsEmbeddingUsageQuery,
  TTarsEmbeddingUsageSummary,
} from 'librechat-data-provider';
import { downloadBlob, toCsvBlob } from '../../Users/helpers';
import { downloadTokenReportCsvs } from '../Report/export';

jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('../../Users/helpers', () => ({
  ...jest.requireActual('../../Users/helpers'),
  toCsvBlob: jest.fn(),
  downloadBlob: jest.fn(),
}));

const RANGE = { start_date: '2026-10-01', end_date: '2026-10-07' };
const CHAT_FILES = [
  'TokenReport_Groups_20261001_20261007.csv',
  'TokenReport_Users_20261001_20261007.csv',
  'TokenReport_Logs_20261001_20261007.csv',
];

const localize = (key: string) => key;

const CHAT_EXPORT: TTarsTokenReportExport = {
  group_usage: [],
  usage_summary: [],
  user_usage_log: [],
  date_range: RANGE,
};

const row = (group: string | null, group_label?: string): TTarsEmbeddingUsageRow => ({
  group,
  group_label,
  input_tokens: 700,
  request_count: 2,
  text_count: 3,
  usage_rows: 1,
});

const summaryOf = (
  query: TTarsEmbeddingUsageQuery,
  rows: TTarsEmbeddingUsageRow[],
): TTarsEmbeddingUsageSummary => ({
  group_by: query.group_by,
  split_by: null,
  start_date: query.start_date,
  end_date: query.end_date,
  rows,
  totals: { input_tokens: 700, request_count: 2, text_count: 3, usage_rows: 1 },
  rows_cut_off: false,
});

/** Each downloaded file as its name and rows, in download order. */
const downloaded = () =>
  jest.mocked(downloadBlob).mock.calls.map(([, name], index) => ({
    name,
    rows: jest.mocked(toCsvBlob).mock.calls[index]?.[1],
  }));

describe('downloadTokenReportCsvs', () => {
  beforeEach(() => {
    jest.spyOn(dataService, 'getTarsTokenReportExport').mockResolvedValue(CHAT_EXPORT);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('adds the embedding file, every dimension one under the other', async () => {
    const rowsBy: Record<string, TTarsEmbeddingUsageRow[]> = {
      day: [row('2026-10-01')],
      purpose: [row('kb_query')],
      domain: [row('7', '產品腦')],
      knowledge_base: [row(null)],
      model: [row('text-embedding-3-small')],
    };
    const summary = jest
      .spyOn(dataService, 'getTarsEmbeddingUsageSummary')
      .mockImplementation(async (query) => summaryOf(query, rowsBy[query.group_by]));

    await expect(downloadTokenReportCsvs(RANGE, localize)).resolves.toEqual({
      embeddingLeftOut: null,
    });

    expect(summary).toHaveBeenCalledTimes(5);
    expect(downloaded().map(({ name }) => name)).toEqual([
      ...CHAT_FILES,
      'TokenReport_Embedding_20261001_20261007.csv',
    ]);
    expect(downloaded()[3].rows).toEqual([
      ['com_ui_tars_embedding_by_day', '2026-10-01', '700', '2', '3'],
      [
        'com_ui_tars_embedding_group_purpose',
        'com_ui_tars_embedding_purpose_kb_query',
        '700',
        '2',
        '3',
      ],
      ['com_ui_tars_embedding_group_domain', '產品腦', '700', '2', '3'],
      [
        'com_ui_tars_embedding_group_knowledge_base',
        'com_ui_tars_embedding_unattributed',
        '700',
        '2',
        '3',
      ],
      ['com_ui_tars_embedding_group_model', 'text-embedding-3-small', '700', '2', '3'],
    ]);
  });

  it('leaves the file out of a range past the limit without asking pwc_tars', async () => {
    const summary = jest.spyOn(dataService, 'getTarsEmbeddingUsageSummary');

    await expect(
      downloadTokenReportCsvs({ start_date: '2025-01-01', end_date: '2026-10-07' }, localize),
    ).resolves.toEqual({ embeddingLeftOut: 'range' });

    expect(summary).not.toHaveBeenCalled();
    expect(downloaded()).toHaveLength(3);
  });

  it('still downloads the chat files when the embedding usage cannot be read', async () => {
    jest.spyOn(dataService, 'getTarsEmbeddingUsageSummary').mockImplementation(async (query) => {
      if (query.group_by === 'domain') {
        throw new Error('timeout');
      }
      return summaryOf(query, [row('x')]);
    });

    await expect(downloadTokenReportCsvs(RANGE, localize)).resolves.toEqual({
      embeddingLeftOut: 'failed',
    });

    expect(downloaded().map(({ name }) => name)).toEqual(CHAT_FILES);
  });

  it('has no embedding file and nothing to explain for a period without usage', async () => {
    jest
      .spyOn(dataService, 'getTarsEmbeddingUsageSummary')
      .mockImplementation(async (query) => summaryOf(query, []));

    await expect(downloadTokenReportCsvs(RANGE, localize)).resolves.toEqual({
      embeddingLeftOut: null,
    });

    expect(downloaded().map(({ name }) => name)).toEqual(CHAT_FILES);
  });
});
