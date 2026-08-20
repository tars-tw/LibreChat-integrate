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
    <section className="rounded-xl border border-border-light">
      <header className="border-b border-border-light px-4 py-2">
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
      </header>
      {ranked.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-secondary">
          {emptyHint ?? localize('com_ui_tars_audit_no_data')}
        </p>
      ) : (
        <ul className="divide-y divide-border-light">
          {ranked.map((item) => (
            <li key={item.key} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-text-primary" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                  {`${item.share ?? percentOf(item.value, total)}% · ${formatTokens(item.value)}`}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                <div
                  className="h-full rounded-full bg-brand-primary"
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
