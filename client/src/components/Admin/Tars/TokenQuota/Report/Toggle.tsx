import { BarChart3, Table2 } from 'lucide-react';
import { useLocalize } from '~/hooks';

export type ReportView = 'chart' | 'table';

const TAB_BASE =
  'hover:text-text-primary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors';
const TAB_ACTIVE = 'bg-surface-tertiary text-text-primary';

/** The chart / table switch the report's daily panels share. */
export default function Toggle({
  view,
  onChange,
}: {
  view: ReportView;
  onChange: (view: ReportView) => void;
}) {
  const localize = useLocalize();
  return (
    <div className="text-text-secondary flex items-center gap-1">
      <button
        type="button"
        aria-pressed={view === 'chart'}
        onClick={() => onChange('chart')}
        className={`${TAB_BASE} ${view === 'chart' ? TAB_ACTIVE : ''}`}
      >
        <BarChart3 className="size-4" aria-hidden />
        {localize('com_ui_tars_usage_view_chart')}
      </button>
      <button
        type="button"
        aria-pressed={view === 'table'}
        onClick={() => onChange('table')}
        className={`${TAB_BASE} ${view === 'table' ? TAB_ACTIVE : ''}`}
      >
        <Table2 className="size-4" aria-hidden />
        {localize('com_ui_tars_usage_view_table')}
      </button>
    </div>
  );
}
