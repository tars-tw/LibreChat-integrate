import { ListChecks } from 'lucide-react';
import type { TTarsActionLogSummary } from 'librechat-data-provider';
import { ACTION_ORDER, actionConfig, toneClasses } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * Counts per action verb for the whole filtered set — pwc_tars recomputes them
 * against the same filters, so these describe the query, not the visible page.
 *
 * Each card doubles as a filter toggle: clicking one narrows the trail to that
 * verb, which is the question the number usually prompts.
 */
export default function Summary({
  summary,
  selected,
  onToggle,
}: {
  summary: TTarsActionLogSummary;
  selected: string[];
  onToggle: (action: string) => void;
}) {
  const localize = useLocalize();

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
      <div className="border-border-light rounded-xl border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-secondary truncate text-xs">
            {localize('com_ui_tars_ops_summary_total')}
          </span>
          <ListChecks className="text-text-secondary size-4 shrink-0" aria-hidden />
        </div>
        <p className="text-text-primary mt-1 text-xl font-semibold tabular-nums">{summary.total}</p>
      </div>

      {ACTION_ORDER.map((action) => {
        const config = actionConfig(action);
        if (config == null) {
          return null;
        }
        const Icon = config.icon;
        const active = selected.includes(action);
        const label = localize(config.labelKey);
        return (
          <button
            key={action}
            type="button"
            onClick={() => onToggle(action)}
            aria-pressed={active}
            title={label}
            className={`hover:bg-surface-tertiary rounded-xl border p-3 text-left transition-colors ${
              active ? 'border-brand-primary' : 'border-border-light'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-secondary truncate text-xs">{label}</span>
              <span className={`shrink-0 rounded-md p-1 ${toneClasses(config.tone)}`}>
                <Icon className="size-3.5" aria-hidden />
              </span>
            </div>
            <p className="text-text-primary mt-1 text-xl font-semibold tabular-nums">
              {summary[config.summaryKey]}
            </p>
          </button>
        );
      })}
    </div>
  );
}
