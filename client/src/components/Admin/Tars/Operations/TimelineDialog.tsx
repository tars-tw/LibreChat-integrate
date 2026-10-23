import { Inbox } from 'lucide-react';
import { Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsActionLog, TTarsActionLogModule } from 'librechat-data-provider';
import { actionConfig, FALLBACK_ACTION, moduleLabel, toneClasses } from './helpers';
import { useTarsUserOperationLogsQuery } from '~/data-provider';
import { formatDateTime } from '../Users/helpers';
import { useLocalize } from '~/hooks';

/** Who the timeline is for. */
export interface TimelineTarget {
  userId: string;
  username: string | null;
  email: string | null;
}

/**
 * One operator's whole activity in the current window.
 *
 * pwc_tars returns this unpaged and newest-first, which is what a timeline
 * wants: the question being asked is "what did this person do", not "give me
 * the first twenty things".
 */
export default function TimelineDialog({
  target,
  window: activeWindow,
  modules,
  locale,
  onClose,
  onSelectLog,
}: {
  target: TimelineTarget | null;
  window: { start_date?: string; end_date?: string };
  modules: TTarsActionLogModule[];
  locale: string;
  onClose: () => void;
  onSelectLog: (log: TTarsActionLog) => void;
}) {
  const localize = useLocalize();
  const query = useTarsUserOperationLogsQuery(target?.userId ?? null, activeWindow);
  const logs = query.data ?? [];

  return (
    <OGDialog open={target != null} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={target?.username ?? localize('com_ui_tars_ops_timeline_title')}
        description={target?.email ?? undefined}
        showCloseButton={true}
        className="w-11/12 md:max-w-5xl"
        /**
         * The dialog body is a grid item, and a grid item defaults to
         * `min-width: auto` — one long description would otherwise stretch the
         * track past the dialog and push the footer out of view.
         */
        mainClassName="min-w-0"
        /**
         * The X glyph sits 5px inside its 24px box, so 19px lands its stroke on
         * the 24px padding line the footer's 取消 button ends on.
         */
        closeButtonClassName="right-[19px]"
        main={
          <div className="space-y-4">
            <div className="bg-surface-secondary flex flex-wrap gap-6 rounded-lg px-4 py-3 text-sm">
              <span>
                <span className="text-text-secondary">
                  {localize('com_ui_tars_ops_timeline_total')}
                </span>
                <span className="text-text-primary ml-2 font-semibold tabular-nums">
                  {logs.length}
                </span>
              </span>
              <span>
                <span className="text-text-secondary">
                  {localize('com_ui_tars_ops_timeline_latest')}
                </span>
                <span className="text-text-primary ml-2 font-semibold">
                  {logs.length > 0 ? formatDateTime(logs[0].created_at, locale) : '—'}
                </span>
              </span>
            </div>

            <div className="max-h-[55vh] overflow-y-auto pr-1">
              {query.isFetching && logs.length === 0 && (
                <div className="text-text-secondary flex items-center justify-center gap-2 py-10 text-sm">
                  <Spinner className="size-4" />
                  {localize('com_ui_loading')}
                </div>
              )}

              {!query.isFetching && logs.length === 0 && (
                <div className="text-text-secondary flex flex-col items-center gap-2 py-10 text-sm">
                  <Inbox className="size-6" aria-hidden />
                  {localize('com_ui_tars_ops_timeline_empty')}
                </div>
              )}

              {/*
                Marker and card sit in one flex row, and the rail is the segment
                below each marker. Laid out rather than absolutely positioned, so
                nothing can escape the dialog's padding.
              */}
              <ol className="space-y-3">
                {logs.map((log, index) => {
                  const config = actionConfig(log.action_type);
                  const Icon = config?.icon ?? FALLBACK_ACTION.icon;
                  const tone = config?.tone ?? FALLBACK_ACTION.tone;
                  return (
                    <li key={log.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`flex size-6 shrink-0 items-center justify-center rounded-full ${toneClasses(tone)}`}
                        >
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        {index < logs.length - 1 && (
                          <span className="bg-border-light mt-1 w-px flex-1" aria-hidden />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectLog(log)}
                        className="border-border-light hover:bg-surface-tertiary min-w-0 flex-1 rounded-lg border px-3 py-2 text-left transition-colors"
                      >
                        <div className="flex min-w-0 items-baseline justify-between gap-2">
                          <span className="text-text-primary truncate text-sm font-medium">
                            {config != null ? localize(config.labelKey) : (log.action_type ?? '—')}
                          </span>
                          <span className="text-text-secondary shrink-0 text-xs">
                            {formatDateTime(log.created_at, locale)}
                          </span>
                        </div>
                        <p className="text-text-secondary mt-0.5 text-sm break-words">
                          {log.description ?? '—'}
                        </p>
                        <p className="text-text-secondary mt-0.5 text-xs break-words">
                          {moduleLabel(log.module, modules)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        }
      />
    </OGDialog>
  );
}
