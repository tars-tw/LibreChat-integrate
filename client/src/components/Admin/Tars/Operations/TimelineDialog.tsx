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
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="space-y-4">
            <div className="flex flex-wrap gap-6 rounded-lg bg-surface-secondary px-4 py-3 text-sm">
              <span>
                <span className="text-text-secondary">
                  {localize('com_ui_tars_ops_timeline_total')}
                </span>
                <span className="ml-2 font-semibold tabular-nums text-text-primary">
                  {logs.length}
                </span>
              </span>
              <span>
                <span className="text-text-secondary">
                  {localize('com_ui_tars_ops_timeline_latest')}
                </span>
                <span className="ml-2 font-semibold text-text-primary">
                  {logs.length > 0 ? formatDateTime(logs[0].created_at, locale) : '—'}
                </span>
              </span>
            </div>

            <div className="max-h-[55vh] overflow-y-auto pr-1">
              {query.isFetching && logs.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
                  <Spinner className="size-4" />
                  {localize('com_ui_loading')}
                </div>
              )}

              {!query.isFetching && logs.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-sm text-text-secondary">
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
                          <span className="mt-1 w-px flex-1 bg-border-light" aria-hidden />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectLog(log)}
                        className="min-w-0 flex-1 rounded-lg border border-border-light px-3 py-2 text-left transition-colors hover:bg-surface-tertiary"
                      >
                        <div className="flex min-w-0 items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-text-primary">
                            {config != null ? localize(config.labelKey) : (log.action_type ?? '—')}
                          </span>
                          <span className="shrink-0 text-xs text-text-secondary">
                            {formatDateTime(log.created_at, locale)}
                          </span>
                        </div>
                        <p
                          className="mt-0.5 truncate text-sm text-text-secondary"
                          title={log.description ?? undefined}
                        >
                          {log.description ?? '—'}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-text-secondary">
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
