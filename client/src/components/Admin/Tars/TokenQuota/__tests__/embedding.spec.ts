import type { TTarsEmbeddingSplitBy, TTarsEmbeddingUsageRow } from 'librechat-data-provider';
import type { EmbeddingSeriesNaming } from '../Report/embedding';
import { stackEmbeddingDays, embeddingValueLabel } from '../Report/embedding';

const localize = (key: string) => `<${key}>`;

const row = (group: string, split: string | null, tokens: number): TTarsEmbeddingUsageRow => ({
  group,
  split,
  input_tokens: tokens,
  request_count: 1,
  text_count: 1,
  usage_rows: 1,
});

const naming = (dimension: TTarsEmbeddingSplitBy): EmbeddingSeriesNaming => ({
  dimension,
  labelOf: (r) => r.split ?? '-',
  otherLabel: 'Other',
});

/** Each series as `label=fill`, in stack order. */
const fills = (rows: TTarsEmbeddingUsageRow[], dimension: TTarsEmbeddingSplitBy) =>
  stackEmbeddingDays(rows, naming(dimension)).series.map(
    ({ label, className }) => `${label}=${className}`,
  );

describe('embedding report helpers', () => {
  it('stacks each day by its split, heaviest series first, days in date order', () => {
    const { series, days } = stackEmbeddingDays(
      [
        row('2026-10-02', 'b', 5),
        row('2026-10-01', 'a', 3),
        row('2026-10-01', 'b', 4),
        row('2026-10-01', 'a', 0),
      ],
      naming('model'),
    );

    expect(series.map(({ label, className }) => [label, className])).toEqual([
      ['b', 'bg-series-1'],
      ['a', 'bg-series-2'],
    ]);
    const [b, a] = series.map(({ key }) => key);
    expect(
      days.map(({ date, total, values }) => [date, total, values.get(b), values.get(a)]),
    ).toEqual([
      ['2026-10-01', 7, 4, 3],
      ['2026-10-02', 5, 5, undefined],
    ]);
  });

  it('keeps each purpose on its own slot whatever else the period holds', () => {
    expect(
      fills(
        [
          row('2026-10-01', 'memory', 900),
          row('2026-10-01', 'kb_ingest', 10),
          row('2026-10-01', 'kb_query', 5),
          row('2026-10-01', 'mcp_tool_rank', 1),
        ],
        'purpose',
      ),
    ).toEqual([
      'kb_query=bg-series-1',
      'kb_ingest=bg-series-2',
      'mcp_tool_rank=bg-series-3',
      'memory=bg-series-4',
    ]);
    expect(
      fills([row('2026-10-01', 'memory', 9), row('2026-10-01', 'kb_ingest', 1)], 'purpose'),
    ).toEqual(['kb_ingest=bg-series-2', 'memory=bg-series-4']);
  });

  it('gives a purpose pwc_tars adds later the slots after the known ones', () => {
    expect(
      fills(
        [
          row('2026-10-01', 'kb_query', 1),
          row('2026-10-01', 'rerank', 3),
          row('2026-10-01', 'summary', 7),
        ],
        'purpose',
      ),
    ).toEqual(['kb_query=bg-series-1', 'summary=bg-series-5', 'rerank=bg-series-6']);
  });

  it('folds every value past the seventh into one neutral Other series', () => {
    const rows = Array.from({ length: 9 }, (_, index) =>
      row(index % 2 === 0 ? '2026-10-01' : '2026-10-02', `kb${index}`, 100 - index),
    );

    const { series, days } = stackEmbeddingDays(rows, naming('knowledge_base'));

    expect(series.map(({ label, className }) => `${label}=${className}`)).toEqual([
      ...Array.from({ length: 7 }, (_, index) => `kb${index}=bg-series-${index + 1}`),
      'Other=bg-text-tertiary',
    ]);
    const other = series[7].key;
    expect(days.map((day) => [day.date, day.values.get(other), day.total])).toEqual([
      ['2026-10-01', 92, 100 + 98 + 96 + 94 + 92],
      ['2026-10-02', 93, 99 + 97 + 95 + 93],
    ]);
  });

  it('needs no Other series for seven values', () => {
    const rows = Array.from({ length: 7 }, (_, index) => row('2026-10-01', `m${index}`, 1));

    expect(stackEmbeddingDays(rows, naming('model')).series.map(({ label }) => label)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
    ]);
  });

  it('keys a series by its value, so two values that read alike stay apart', () => {
    const { series } = stackEmbeddingDays(
      [row('2026-10-01', 'kb1', 5), row('2026-10-01', 'kb2', 4), row('2026-10-01', null, 3)],
      { ...naming('knowledge_base'), labelOf: (r) => (r.split == null ? 'none' : '產品手冊') },
    );

    expect(series.map(({ label, className }) => [label, className])).toEqual([
      ['產品手冊', 'bg-series-1'],
      ['產品手冊', 'bg-series-2'],
      ['none', 'bg-series-3'],
    ]);
    expect(new Set(series.map(({ key }) => key)).size).toBe(3);
  });

  it('fills the days of the period without usage as empty columns, across month ends', () => {
    const { days } = stackEmbeddingDays(
      [row('2028-02-28', 'a', 5), row('2028-03-01', 'a', 2)],
      naming('model'),
      { start_date: '2028-02-27', end_date: '2028-03-02', rows_cut_off: false },
    );

    expect(days.map(({ date, total }) => [date, total])).toEqual([
      ['2028-02-27', 0],
      ['2028-02-28', 5],
      ['2028-02-29', 0],
      ['2028-03-01', 2],
      ['2028-03-02', 0],
    ]);
  });

  it('starts a cut-off report at the first day it kept, and draws no column without usage', () => {
    const span = { start_date: '2026-10-01', end_date: '2026-10-05' };

    const cut = stackEmbeddingDays([row('2026-10-04', 'a', 2)], naming('model'), {
      ...span,
      rows_cut_off: true,
    });
    const empty = stackEmbeddingDays([], naming('model'), { ...span, rows_cut_off: false });

    expect(cut.days.map((day) => day.date)).toEqual(['2026-10-04', '2026-10-05']);
    expect(empty).toEqual({ series: [], days: [] });
  });

  it('names purposes, keeps model names, and marks usage with no id unattributed', () => {
    expect(embeddingValueLabel('purpose', 'kb_query', null, localize)).toBe(
      '<com_ui_tars_embedding_purpose_kb_query>',
    );
    expect(embeddingValueLabel('purpose', 'something_new', null, localize)).toBe('something_new');
    expect(embeddingValueLabel('model', 'text-embedding-3-small', null, localize)).toBe(
      'text-embedding-3-small',
    );
    expect(embeddingValueLabel('domain', null, null, localize)).toBe(
      '<com_ui_tars_embedding_unattributed>',
    );
    expect(embeddingValueLabel('knowledge_base', 'kb1', '產品手冊', localize)).toBe('產品手冊');
  });
});
