import type {
  TTarsEmbeddingSplitBy,
  TTarsEmbeddingUsageRow,
  TTarsEmbeddingUsageSummary,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

type Localize = (key: TranslationKeys, values?: Record<string, string | number>) => string;

export const EMBEDDING_DIMENSION_LABEL_KEYS: Record<TTarsEmbeddingSplitBy, TranslationKeys> = {
  purpose: 'com_ui_tars_embedding_group_purpose',
  domain: 'com_ui_tars_embedding_group_domain',
  knowledge_base: 'com_ui_tars_embedding_group_knowledge_base',
  model: 'com_ui_tars_embedding_group_model',
};

const PURPOSE_LABEL_KEYS: Record<string, TranslationKeys> = {
  kb_ingest: 'com_ui_tars_embedding_purpose_kb_ingest',
  kb_query: 'com_ui_tars_embedding_purpose_kb_query',
  memory: 'com_ui_tars_embedding_purpose_memory',
  mcp_tool_rank: 'com_ui_tars_embedding_purpose_mcp_tool_rank',
};

/**
 * The theme's categorical series slots, in slot order: the order keeps touching
 * segments apart for color-vision deficiency, and the theme's contract
 * (`series.spec.ts`) covers these seven. Static names so Tailwind sees them.
 */
const SERIES_CLASSES = [
  'bg-series-1',
  'bg-series-2',
  'bg-series-3',
  'bg-series-4',
  'bg-series-5',
  'bg-series-6',
  'bg-series-7',
];

/**
 * Each purpose's slot, the same in every period and view. Slot 3, the palette's
 * least saturated light step, goes to tool ranking: pwc_tars embeds for it only
 * when a chat offers more MCP tools than its cap.
 */
const PURPOSE_SLOTS = new Map(
  ['kb_query', 'kb_ingest', 'mcp_tool_rank', 'memory'].map((purpose, slot) => [purpose, slot]),
);

/** The folded series: the solid neutral the audit trace breakdown gives its "other" share. */
const OTHER_KEY = 'other';
const OTHER_CLASS = 'bg-text-tertiary';

export const embeddingPurposeLabel = (purpose: string | null | undefined, localize: Localize) => {
  const key = purpose == null ? undefined : PURPOSE_LABEL_KEYS[purpose];
  return key ? localize(key) : (purpose ?? '-');
};

/**
 * What a group or split value reads as. Usage with no id is unattributed:
 * memory and tool ranking touch no knowledge base, and some usage traces to no brain.
 */
export const embeddingValueLabel = (
  dimension: TTarsEmbeddingSplitBy,
  value: string | null | undefined,
  label: string | null | undefined,
  localize: Localize,
): string => {
  if (dimension === 'purpose') {
    return embeddingPurposeLabel(value, localize);
  }
  if (dimension === 'model') {
    return value ?? '-';
  }
  if (value == null) {
    return localize('com_ui_tars_embedding_unattributed');
  }
  return label ?? value;
};

/** One series of the stacked chart: its legend text and the fill of its segments. */
export interface EmbeddingSeries {
  key: string;
  label: string;
  className: string;
}

export interface EmbeddingStackedDay {
  date: string;
  total: number;
  /** Tokens per series key. */
  values: Map<string, number>;
}

export interface EmbeddingSeriesNaming {
  /** What the report is split by: a purpose keeps a fixed slot, other values rank by tokens. */
  dimension: TTarsEmbeddingSplitBy;
  labelOf: (row: TTarsEmbeddingUsageRow) => string;
  /** The name of the series the values past the last slot fold into. */
  otherLabel: string;
}

interface SeriesTally {
  key: string;
  label: string;
  tokens: number;
  fixedSlot?: number;
}

const UNFIXED = Number.MAX_SAFE_INTEGER;

/** Fixed slots first, then the period's heaviest; ties by key so a redraw keeps the order. */
const bySlot = (a: SeriesTally, b: SeriesTally) =>
  (a.fixedSlot ?? UNFIXED) - (b.fixedSlot ?? UNFIXED) ||
  b.tokens - a.tokens ||
  a.key.localeCompare(b.key);

/**
 * The series in stack order, and the series each split value is drawn in. A
 * purpose keeps its slot whatever else the period holds; the open-ended
 * dimensions rank by the period's tokens, so a value keeps one color across
 * every day and the table. Past the seventh slot the rest fold into one neutral
 * series: the palette has no further validated hue, and reusing one would draw
 * two values as one.
 */
const assignSeries = (
  tallies: SeriesTally[],
  { dimension, otherLabel }: EmbeddingSeriesNaming,
): { series: EmbeddingSeries[]; seriesOf: Map<string, string> } => {
  let next = dimension === 'purpose' ? PURPOSE_SLOTS.size : 0;
  const series: EmbeddingSeries[] = [];
  const seriesOf = new Map<string, string>();
  for (const tally of tallies.sort(bySlot)) {
    const className = SERIES_CLASSES[tally.fixedSlot ?? next++];
    if (className == null) {
      seriesOf.set(tally.key, OTHER_KEY);
    } else {
      series.push({ key: tally.key, label: tally.label, className });
      seriesOf.set(tally.key, tally.key);
    }
  }
  if (series.length < seriesOf.size) {
    series.push({ key: OTHER_KEY, label: otherLabel, className: OTHER_CLASS });
  }
  return { series, seriesOf };
};

const DAY_MS = 86_400_000;

/** Every `YYYY-MM-DD` from `start` to `end`, both included. */
const daysBetween = (start: string, end: string): string[] => {
  const first = Date.parse(start);
  const count = Math.floor((Date.parse(end) - first) / DAY_MS) + 1;
  if (!Number.isFinite(count) || count <= 0) {
    return [];
  }
  return Array.from({ length: count }, (_, index) =>
    new Date(first + index * DAY_MS).toISOString().slice(0, 10),
  );
};

/**
 * A `group_by=day&split_by=…` report as one stacked column per day, with its
 * series in stack order (see `assignSeries`). A series is keyed by its split
 * value rather than its label, so two values that read alike stay apart.
 *
 * pwc_tars lists only days with usage, so given the report's `span` the days
 * without any become empty columns, as on the chat trend. A cut-off report
 * starts at the first day it kept: the days before it did have usage.
 */
export const stackEmbeddingDays = (
  rows: TTarsEmbeddingUsageRow[],
  naming: EmbeddingSeriesNaming,
  span?: Pick<TTarsEmbeddingUsageSummary, 'start_date' | 'end_date' | 'rows_cut_off'>,
): { series: EmbeddingSeries[]; days: EmbeddingStackedDay[] } => {
  const tallies = new Map<string, SeriesTally>();
  const byDate = new Map<string, Map<string, number>>();
  let earliest: string | undefined;
  for (const row of rows) {
    const key = row.split == null ? 'none' : `value:${row.split}`;
    const tally = tallies.get(key) ?? {
      key,
      label: naming.labelOf(row),
      tokens: 0,
      fixedSlot:
        naming.dimension === 'purpose' && row.split != null
          ? PURPOSE_SLOTS.get(row.split)
          : undefined,
    };
    tally.tokens += row.input_tokens;
    tallies.set(key, tally);
    const date = row.group ?? '';
    const values = byDate.get(date) ?? new Map<string, number>();
    values.set(key, (values.get(key) ?? 0) + row.input_tokens);
    byDate.set(date, values);
    if (earliest == null || date < earliest) {
      earliest = date;
    }
  }

  const { series, seriesOf } = assignSeries([...tallies.values()], naming);
  const days: EmbeddingStackedDay[] = [...byDate].map(([date, tokensByKey]) => {
    const values = new Map<string, number>();
    let total = 0;
    for (const [key, tokens] of tokensByKey) {
      const target = seriesOf.get(key) ?? OTHER_KEY;
      values.set(target, (values.get(target) ?? 0) + tokens);
      total += tokens;
    }
    return { date, total, values };
  });
  if (span != null && earliest != null) {
    const start = span.rows_cut_off ? earliest : span.start_date;
    for (const date of daysBetween(start, span.end_date)) {
      if (!byDate.has(date)) {
        days.push({ date, total: 0, values: new Map<string, number>() });
      }
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { series, days };
};
