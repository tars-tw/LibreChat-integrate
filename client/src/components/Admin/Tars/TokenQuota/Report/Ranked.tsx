import { formatTokens, percentOf } from './helpers';
import { useLocalize } from '~/hooks';

export interface RankedItem {
  key: string;
  label: string;
  value: number;
  /** A pre-computed share, for series whose percentage pwc_tars already returns. */
  share?: number;
}

/**
 * A ranked breakdown: label, value, and a bar relative to the leader. The same
 * shape the message audit report uses for its per-brain split, so the two
 * reports read alike.
 */
export default function Ranked({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: RankedItem[];
  emptyHint?: string;
}) {
  const localize = useLocalize();
  const ranked = [...items].sort((a, b) => b.value - a.value);
  const total = ranked.reduce((sum, item) => sum + item.value, 0);
  const leader = ranked[0]?.value ?? 0;

  return (
    <section className="border-border-light rounded-xl border">
      <header className="border-border-light border-b px-4 py-2">
        <h2 className="text-text-primary text-sm font-medium">{title}</h2>
      </header>
      {ranked.length === 0 ? (
        <p className="text-text-secondary px-4 py-6 text-sm">
          {emptyHint ?? localize('com_ui_tars_audit_no_data')}
        </p>
      ) : (
        <ul className="divide-border-light divide-y">
          {ranked.map((item) => (
            <li key={item.key} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-text-primary min-w-0 truncate text-sm" title={item.label}>
                  {item.label}
                </span>
                <span className="text-text-secondary shrink-0 text-xs tabular-nums">
                  {`${item.share ?? percentOf(item.value, total)}% · ${formatTokens(item.value)}`}
                </span>
              </div>
              <div className="bg-surface-tertiary mt-2 h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-brand-primary h-full rounded-full"
                  style={{
                    width: `${leader === 0 ? 0 : Math.round((item.value / leader) * 100)}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
