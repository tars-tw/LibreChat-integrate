import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { EmbeddingSeries, EmbeddingStackedDay } from './embedding';
import type { ReportView } from './Toggle';
import { formatTokens, shortDate } from './helpers';
import { useLocalize } from '~/hooks';
import Toggle from './Toggle';

/**
 * Daily embedding usage as one stacked column per day, each series in its own
 * theme series slot, with a table view listing the same numbers per series —
 * the chart shows the shape, the table the exact split.
 *
 * A column is at most 24px wide with a rounded top, and its segments (like
 * neighbouring columns) are kept apart by a 2px gap of the surface rather than
 * an outline, so touching series still read as two.
 */
export default function Stacked({
  title,
  series,
  days,
  hints,
  compact,
}: {
  title: string;
  series: EmbeddingSeries[];
  days: EmbeddingStackedDay[];
  hints: string[];
  compact?: boolean;
}) {
  const localize = useLocalize();
  const [view, setView] = useState<ReportView>('chart');

  const peak = days.reduce((max, day) => Math.max(max, day.total), 0);
  const total = days.reduce((sum, day) => sum + day.total, 0);

  return (
    <section className="border-border-light rounded-xl border">
      <header className="border-border-light flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <h3 className="text-text-primary text-sm font-medium">{title}</h3>
          <Toggle view={view} onChange={setView} />
        </div>
        <span className="bg-surface-tertiary text-text-primary rounded-full px-2 py-0.5 text-xs tabular-nums">
          {formatTokens(total)}
        </span>
      </header>

      {days.length === 0 && (
        <p className="text-text-secondary px-4 py-6 text-sm">
          {localize('com_ui_tars_audit_no_data')}
        </p>
      )}

      {days.length > 0 && view === 'chart' && (
        <div className="overflow-x-auto p-4">
          <div className={`flex ${compact ? 'h-40' : 'h-56'} min-w-[36rem] items-end gap-0.5`}>
            {days.map((day) => {
              const parts = series.flatMap((item) => {
                const value = day.values.get(item.key) ?? 0;
                return value > 0 ? [{ item, value }] : [];
              });
              return (
                <div
                  key={day.date}
                  role="img"
                  aria-label={`${day.date} ${formatTokens(day.total)}`}
                  title={[
                    `${day.date} · ${formatTokens(day.total)}`,
                    ...parts.map(({ item, value }) => `${item.label}: ${formatTokens(value)}`),
                  ].join('\n')}
                  className="flex h-full flex-1 items-end justify-center"
                >
                  <div
                    className="flex w-full max-w-6 flex-col-reverse gap-0.5 overflow-hidden rounded-t"
                    style={{ height: peak === 0 ? 0 : `${(day.total / peak) * 100}%` }}
                  >
                    {parts.map(({ item, value }) => (
                      <div
                        key={item.key}
                        className={`${item.className} min-h-px grow-(--share)`}
                        style={{ '--share': value } as CSSProperties}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex min-w-[36rem] gap-0.5">
            {days.map((day, index) => (
              <span
                key={day.date}
                className="text-text-secondary flex-1 text-center text-xs tabular-nums"
              >
                {index % 3 === 0 ? shortDate(day.date) : ''}
              </span>
            ))}
          </div>
          <ul className="text-text-secondary mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {series.map((item) => (
              <li key={item.key} className="flex items-center gap-1.5">
                <span className={`size-2.5 rounded-xs ${item.className}`} aria-hidden />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {days.length > 0 && view === 'table' && (
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-surface-secondary text-text-secondary sticky top-0 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_usage_col_date')}</th>
                {series.map((item) => (
                  <th key={item.key} className="px-3 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`size-2 rounded-xs ${item.className}`} aria-hidden />
                      {item.label}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_embedding_col_tokens')}
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date} className="border-border-light border-t">
                  <td className="text-text-primary px-3 py-2 tabular-nums">{day.date}</td>
                  {series.map((item) => (
                    <td
                      key={item.key}
                      className="text-text-secondary px-3 py-2 text-right tabular-nums"
                    >
                      {formatTokens(day.values.get(item.key) ?? 0)}
                    </td>
                  ))}
                  <td className="text-text-primary px-3 py-2 text-right tabular-nums">
                    {formatTokens(day.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hints.length > 0 && (
        <p className="border-border-light text-text-secondary border-t px-4 py-2 text-xs">
          {hints.join(' ')}
        </p>
      )}
    </section>
  );
}
