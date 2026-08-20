import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { TTarsAuditDomainStat, TTarsAuditSummary } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

/** One headline number. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border-light p-4">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{value}</p>
      {hint != null && <p className="mt-0.5 text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

/**
 * The period rollup: headline totals, the like/dislike split, and the per-brain
 * breakdown. The breakdown is sorted by message count so the busiest brain leads
 * — pwc_tars returns it in whatever order the rows happened to group.
 */
export default function Statistics({
  summary,
  details,
  likes,
  dislikes,
}: {
  summary: TTarsAuditSummary | null;
  details: TTarsAuditDomainStat[];
  likes: number;
  dislikes: number;
}) {
  const localize = useLocalize();

  if (summary == null) {
    return (
      <div className="py-12 text-center text-sm text-text-secondary">
        {localize('com_ui_tars_audit_no_data')}
      </div>
    );
  }

  const ranked = [...details].sort((a, b) => b.message_count - a.message_count);
  const busiest = ranked[0]?.message_count ?? 0;
  const rated = likes + dislikes;
  const likeShare = rated === 0 ? 0 : Math.round((likes / rated) * 100);

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        {localize('com_ui_tars_audit_period')}
        {': '}
        {summary.date_range.start_date} ~ {summary.date_range.end_date}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={localize('com_ui_tars_audit_total_messages')}
          value={String(summary.total_messages)}
        />
        <Stat
          label={localize('com_ui_tars_audit_total_conversations')}
          value={String(summary.total_conversations)}
        />
        <Stat
          label={localize('com_ui_tars_audit_total_domains')}
          value={String(summary.total_domains)}
          hint={localize('com_ui_tars_audit_active_domains_hint')}
        />
        <Stat
          label={localize('com_ui_tars_audit_total_feedback')}
          value={String(rated)}
          hint={
            rated === 0
              ? undefined
              : localize('com_ui_tars_audit_like_share', { 0: String(likeShare) })
          }
        />
      </div>

      {rated > 0 && (
        <div className="rounded-xl border border-border-light p-4">
          <p className="mb-3 text-sm font-medium text-text-primary">
            {localize('com_ui_tars_audit_feedback_split')}
          </p>
          {/* The filled share is the positive one, so the brand fill reads as the good news. */}
          <div
            className="h-3 overflow-hidden rounded-full bg-surface-tertiary"
            role="img"
            aria-label={localize('com_ui_tars_audit_like_share', { 0: String(likeShare) })}
          >
            <div
              className="h-full rounded-full bg-brand-primary"
              style={{ width: `${likeShare}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-sm text-text-secondary">
            <span className="flex items-center gap-1.5">
              <ThumbsUp className="size-4 text-brand-primary" aria-hidden />
              <span className="tabular-nums text-text-primary">{likes}</span>
              {localize('com_ui_tars_audit_col_like')}
            </span>
            <span className="flex items-center gap-1.5">
              {localize('com_ui_tars_audit_col_dislike')}
              <span className="tabular-nums text-text-primary">{dislikes}</span>
              <ThumbsDown className="size-4" aria-hidden />
            </span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border-light">
        <header className="border-b border-border-light px-4 py-2">
          <h3 className="text-sm font-medium text-text-primary">
            {localize('com_ui_tars_audit_domain_stats')}
          </h3>
        </header>
        {ranked.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-secondary">
            {localize('com_ui_tars_audit_no_data')}
          </p>
        ) : (
          <ul className="divide-y divide-border-light">
            {ranked.map((detail) => (
              <li key={detail.domain_name} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-text-primary">
                    {detail.domain_name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                    {localize('com_ui_tars_audit_domain_counts', {
                      0: String(detail.message_count),
                      1: String(detail.conversation_count),
                    })}
                  </span>
                </div>
                {/* A bar relative to the busiest brain, so the mix reads at a glance. */}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                  <div
                    className="h-full rounded-full bg-brand-primary"
                    style={{
                      width: `${busiest === 0 ? 0 : Math.round((detail.message_count / busiest) * 100)}%`,
                    }}
                  />
                </div>
                {detail.knowledge_bases.length > 0 && (
                  <p className="mt-1.5 truncate text-xs text-text-secondary">
                    {detail.knowledge_bases.map((kb) => kb.name).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
