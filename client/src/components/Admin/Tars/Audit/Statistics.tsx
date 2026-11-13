import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { TTarsAuditSummary } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

/** One headline number. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-border-light rounded-xl border p-4">
      <p className="text-text-secondary text-xs">{label}</p>
      <p className="text-text-primary mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint != null && <p className="text-text-secondary mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}

/** The period rollup: headline totals and the like/dislike split. */
export default function Statistics({
  summary,
  likes,
  dislikes,
}: {
  summary: TTarsAuditSummary | null;
  likes: number;
  dislikes: number;
}) {
  const localize = useLocalize();

  if (summary == null) {
    return (
      <div className="text-text-secondary py-12 text-center text-sm">
        {localize('com_ui_tars_audit_no_data')}
      </div>
    );
  }

  const rated = likes + dislikes;
  const likeShare = rated === 0 ? 0 : Math.round((likes / rated) * 100);

  return (
    <div className="space-y-4">
      <p className="text-text-secondary text-sm">
        {localize('com_ui_tars_audit_period')}
        {': '}
        {summary.date_range.start_date} ~ {summary.date_range.end_date}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label={localize('com_ui_tars_audit_total_messages')}
          value={String(summary.total_messages)}
        />
        <Stat
          label={localize('com_ui_tars_audit_total_conversations')}
          value={String(summary.total_conversations)}
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
        <div className="border-border-light rounded-xl border p-4">
          <p className="text-text-primary mb-3 text-sm font-medium">
            {localize('com_ui_tars_audit_feedback_split')}
          </p>
          {/* The filled share is the positive one, so the brand fill reads as the good news. */}
          <div
            className="bg-surface-tertiary h-3 overflow-hidden rounded-full"
            role="img"
            aria-label={localize('com_ui_tars_audit_like_share', { 0: String(likeShare) })}
          >
            <div
              className="bg-brand-primary h-full rounded-full"
              style={{ width: `${likeShare}%` }}
            />
          </div>
          <div className="text-text-secondary mt-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5">
              <ThumbsUp className="text-brand-primary size-4" aria-hidden />
              <span className="text-text-primary tabular-nums">{likes}</span>
              {localize('com_ui_tars_audit_col_like')}
            </span>
            <span className="flex items-center gap-1.5">
              {localize('com_ui_tars_audit_col_dislike')}
              <span className="text-text-primary tabular-nums">{dislikes}</span>
              <ThumbsDown className="size-4" aria-hidden />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
