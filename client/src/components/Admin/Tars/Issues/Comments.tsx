import { useMemo } from 'react';
import type { TTarsTicketComment } from 'librechat-data-provider';
import { formatDateTime } from '../Users/helpers';
import { toDisplayComment } from './helpers';
import { useLocalize } from '~/hooks';

const PANEL_CLASSES =
  'h-[9.5rem] overflow-y-auto rounded-lg border border-border-light bg-surface-secondary p-2';

/**
 * The customer ↔ PwC conversation on the Issue Tracker. Sized to match the
 * description field beside it so the two columns end level.
 */
export default function Comments({
  comments,
  error,
  locale,
}: {
  comments: TTarsTicketComment[];
  error?: string | null;
  locale: string;
}) {
  const localize = useLocalize();
  const displayed = useMemo(() => comments.map(toDisplayComment), [comments]);

  if (error != null && error !== '') {
    return (
      <div className={PANEL_CLASSES}>
        <p className="text-xs text-text-secondary">
          {localize('com_ui_tars_issues_comments_error', { 0: error })}
        </p>
      </div>
    );
  }

  if (displayed.length === 0) {
    return (
      <div className={PANEL_CLASSES}>
        <p className="text-xs text-text-secondary">{localize('com_ui_tars_issues_no_comments')}</p>
      </div>
    );
  }

  return (
    <ul className={`${PANEL_CLASSES} space-y-1.5`}>
      {displayed.map((comment) => (
        <li
          key={comment.id}
          className={`rounded-md px-3 py-2 ${
            comment.isCustomer ? 'bg-surface-tertiary' : 'bg-orange-100 dark:bg-orange-900/40'
          }`}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`shrink-0 text-xs font-semibold ${
                  comment.isCustomer ? 'text-text-primary' : 'text-orange-700 dark:text-orange-300'
                }`}
              >
                {localize(
                  comment.isCustomer
                    ? 'com_ui_tars_issues_side_customer'
                    : 'com_ui_tars_issues_side_pwc',
                )}
              </span>
              {comment.author != null && (
                <span className="truncate text-xs text-text-secondary">{comment.author}</span>
              )}
            </span>
            <span className="shrink-0 text-xs text-text-secondary">
              {formatDateTime(comment.created_at, locale)}
              {comment.edited_at != null && comment.edited_at !== ''
                ? ` ${localize('com_ui_tars_issues_comment_edited')}`
                : ''}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-text-primary">{comment.body}</p>
        </li>
      ))}
    </ul>
  );
}
