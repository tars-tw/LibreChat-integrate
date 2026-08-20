import { useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import type { TTarsTokenDailyUsage } from 'librechat-data-provider';
import { formatTokens, shortDate } from './helpers';
import { useLocalize } from '~/hooks';

const TAB_BASE =
  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors hover:text-text-primary';

/**
 * Daily token usage for the period, as a bar column per day. Bars are relative
 * to the busiest day so a quiet range still reads, and each column is labelled
 * for screen readers because the table view repeats the same numbers.
 */
export default function Trend({
  days,
  title,
  compact,
}: {
  days: TTarsTokenDailyUsage[];
  title: string;
  compact?: boolean;
}) {
  const localize = useLocalize();
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const total = days.reduce((sum, day) => sum + day.total_tokens, 0);
  const average = days.length === 0 ? 0 : total / days.length;
  const peak = days.reduce((max, day) => Math.max(max, day.total_tokens), 0);
  const heightOf = (tokens: number) =>
    peak === 0 ? 0 : Math.max((tokens / peak) * 100, tokens > 0 ? 2 : 0);

  return (
    <section className="rounded-xl border border-border-light">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <div className="flex items-center gap-1 text-text-secondary">
            <button
              type="button"
              onClick={() => setView('chart')}
              className={`${TAB_BASE} ${view === 'chart' ? 'bg-surface-tertiary text-text-primary' : ''}`}
            >
              <BarChart3 className="size-4" aria-hidden />
              {localize('com_ui_tars_usage_view_chart')}
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={`${TAB_BASE} ${view === 'table' ? 'bg-surface-tertiary text-text-primary' : ''}`}
            >
              <Table2 className="size-4" aria-hidden />
              {localize('com_ui_tars_usage_view_table')}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-px w-6 border-t border-dashed border-border-heavy" aria-hidden />
            {`${localize('com_ui_tars_usage_daily_average')} ${formatTokens(Math.round(average))}`}
          </span>
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 tabular-nums text-text-primary">
            {formatTokens(total)}
          </span>
        </div>
      </header>

      {view === 'chart' && (
        <div className="overflow-x-auto p-4">
          <div
            className={`relative flex ${compact ? 'h-40' : 'h-64'} min-w-[36rem] items-end gap-1`}
          >
            {peak > 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border-heavy"
                style={{ bottom: `${(average / peak) * 100}%` }}
                aria-hidden
              />
            )}
            {days.map((day) => (
              <div
                key={day.date}
                className="group flex h-full flex-1 flex-col justify-end"
                title={`${day.date} · ${formatTokens(day.total_tokens)}`}
              >
                <div
                  role="img"
                  aria-label={`${day.date} ${formatTokens(day.total_tokens)}`}
                  className={`rounded-t transition-colors ${
                    day.total_tokens >= average && day.total_tokens > 0
                      ? 'bg-brand-primary'
                      : 'bg-brand-primary/35 group-hover:bg-brand-primary/60'
                  }`}
                  style={{ height: `${heightOf(day.total_tokens)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex min-w-[36rem] gap-1">
            {days.map((day, index) => (
              <span
                key={day.date}
                className="flex-1 text-center text-[10px] tabular-nums text-text-secondary"
              >
                {index % 3 === 0 ? shortDate(day.date) : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {view === 'table' && (
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="sticky top-0 bg-surface-secondary text-left text-text-secondary">
              <tr>
                <th className="w-[30%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_usage_col_date')}
                </th>
                <th className="w-[20%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_report_col_logs')}
                </th>
                <th className="w-[25%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_report_col_tokens')}
                </th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_usage_col_share')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date} className="border-t border-border-light">
                  <td className="px-3 py-2 tabular-nums text-text-primary">{day.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {formatTokens(day.log_count)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                    {formatTokens(day.total_tokens)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                      <div
                        className="h-full rounded-full bg-brand-primary"
                        style={{ width: `${heightOf(day.total_tokens)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
