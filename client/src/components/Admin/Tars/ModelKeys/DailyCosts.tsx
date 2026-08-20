import { useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import type { TTarsUsageDailyCost } from 'librechat-data-provider';
import { formatCurrency, shortDate } from './helpers';
import { useLocalize } from '~/hooks';

const TAB_BASE =
  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors hover:text-text-primary';

/**
 * Daily spend for the queried month, as a bar column per day with the period
 * average drawn across it. Bars are relative to the busiest day so an idle month
 * still reads, and the columns are labelled for screen readers because the chart
 * carries information the table view repeats.
 */
export default function DailyCosts({ days }: { days: TTarsUsageDailyCost[] }) {
  const localize = useLocalize();
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const total = days.reduce((sum, day) => sum + day.cost, 0);
  const average = days.length === 0 ? 0 : total / days.length;
  const peak = days.reduce((max, day) => Math.max(max, day.cost), 0);
  const heightOf = (cost: number) =>
    peak === 0 ? 0 : Math.max((cost / peak) * 100, cost > 0 ? 2 : 0);

  return (
    <section className="rounded-xl border border-border-light">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-4 py-2">
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
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-px w-6 border-t border-dashed border-border-heavy" aria-hidden />
            {localize('com_ui_tars_usage_daily_average')} {formatCurrency(average)}
          </span>
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 tabular-nums text-text-primary">
            {formatCurrency(total)}
          </span>
        </div>
      </header>

      {view === 'chart' && (
        <div className="overflow-x-auto p-4">
          <div className="relative flex h-64 min-w-[36rem] items-end gap-1">
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
                title={`${day.date} · ${formatCurrency(day.cost)}`}
              >
                <div
                  role="img"
                  aria-label={`${day.date} ${formatCurrency(day.cost)}`}
                  className={`rounded-t transition-colors ${
                    day.cost >= average && day.cost > 0
                      ? 'bg-brand-primary'
                      : 'bg-brand-primary/35 group-hover:bg-brand-primary/60'
                  }`}
                  style={{ height: `${heightOf(day.cost)}%` }}
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-surface-secondary text-left text-text-secondary">
              <tr>
                <th className="w-[30%] px-3 py-2 font-medium">
                  {localize('com_ui_tars_usage_col_date')}
                </th>
                <th className="w-[25%] px-3 py-2 text-right font-medium">
                  {localize('com_ui_tars_usage_col_amount')}
                </th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_usage_col_share')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date} className="border-t border-border-light">
                  <td className="px-3 py-2 tabular-nums text-text-primary">{day.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                    {formatCurrency(day.cost)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                      <div
                        className="h-full rounded-full bg-brand-primary"
                        style={{ width: `${heightOf(day.cost)}%` }}
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
