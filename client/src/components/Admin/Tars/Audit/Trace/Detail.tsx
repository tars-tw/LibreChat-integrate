import { TARS_TRACE_EVENT } from 'librechat-data-provider';
import { Chip, OGDialog, OGDialogTitle, TooltipAnchor, OGDialogContent } from '@librechat/client';
import {
  Check,
  Clock,
  Globe,
  Timer,
  Layers,
  Scissors,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import type { TTarsJsonField, TTarsTraceRow } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { DialogBar, ScrollBox, DetailField, DialogFrame, TraceErrorBoundary } from './Parts';
import { fmtMs, fmtClock, rowTurn, pairedToolRows } from './layout';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { retryFailureReason } from './outcome';
import { buildDetailExportJson } from './json';
import { RowIcon, rowLabel } from './icons';
import { useCopyFeedback } from './copy';
import { rowDurationMs } from './time';
import { stringList } from './values';
import { useLocalize } from '~/hooks';

const OMITTED_PAYLOAD_KEYS = new Set([
  'type',
  'event_type',
  'system_prompt',
  'systemprompt',
  'turn',
  'turn_index',
  'turnindex',
  'turn_number',
  'turnnumber',
  'turn_id',
  'turnid',
  'started_at',
  'ended_at',
  'duration',
  'duration_ms',
  'durationms',
  'ok',
  'status',
  'sources',
]);

function isOmittedPayloadKey(key: string): boolean {
  return OMITTED_PAYLOAD_KEYS.has(key.toLowerCase());
}

type Field = { key: string; label: string; value: TTarsJsonField | undefined };

/**
 * One bar's full record: a tool call and its result are shown together by
 * tool_use_id; any other event lists its payload fields. Each field scrolls on
 * its own, and the dialog body scrolls too, so one huge output cannot push the
 * fields after it off screen.
 */
export default function TraceDetail({
  trace,
  row,
  onClose,
}: {
  trace: TTarsTraceRow[];
  row: TTarsTraceRow | null;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const jsonCopy = useCopyFeedback();

  if (!row) {
    return null;
  }
  const { call, result } = row.tool_use_id
    ? pairedToolRows(trace, row.tool_use_id)
    : { call: undefined, result: undefined };
  const primary = result ?? call ?? row;
  const title = rowLabel(localize, primary);
  const isTool = primary.tool_name != null || primary.event_type === TARS_TRACE_EVENT.langflowRoute;
  const duration = rowDurationMs(primary);

  const turnNumber = rowTurn(primary.turn, row.payload);

  const sources = stringList(
    result?.payload?.sources ?? call?.payload?.sources ?? row.payload?.sources,
  );

  const fields: Field[] = [];
  if (call) {
    fields.push({
      key: 'input',
      label: localize('com_ui_tars_audit_trace_tool_input'),
      value: call.payload?.input,
    });
  }
  if (result) {
    fields.push({
      key: 'output',
      label: localize('com_ui_tars_audit_trace_tool_output'),
      value: result.payload?.output,
    });
  }
  if (!call && !result && row.payload) {
    /** system_prompt and fixed stat strip fields (turn, timing, etc.) are omitted so the space is reserved for content like text */
    const entries = Object.entries(row.payload) as [string, TTarsJsonField | undefined][];
    for (const [key, value] of entries) {
      if (value != null && !isOmittedPayloadKey(key)) {
        fields.push({ key, label: key, value });
      }
    }
  }
  const outputLimit = result?.payload?.model_output_limit ?? 0;

  /** A stat chip's leading icon. */
  const chipIcon = (Icon: React.ElementType) => (
    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
  );
  let statusBadge: ReactNode;
  if (primary.ok === true) {
    statusBadge = (
      <Chip tone="success" leading={chipIcon(Check)}>
        {localize('com_ui_tars_audit_trace_success')}
      </Chip>
    );
  } else if (primary.ok === false) {
    statusBadge = (
      <Chip tone="error" leading={chipIcon(AlertTriangle)}>
        {localize('com_ui_tars_audit_trace_fail')}
      </Chip>
    );
  } else {
    statusBadge = (
      <Chip tone="neutral" leading={<RowIcon row={primary} className="size-3.5" />}>
        {isTool
          ? localize('com_ui_tars_audit_trace_tool_label')
          : localize('com_ui_tars_audit_trace_model_label')}
      </Chip>
    );
  }

  let clockText: string | null = null;
  if (primary.started_at) {
    clockText = primary.ended_at
      ? `${fmtClock(primary.started_at)} → ${fmtClock(primary.ended_at)}`
      : fmtClock(primary.started_at);
  }

  let retryDescription = '';
  if (call != null && call.attempt > 1) {
    retryDescription = call.retry_of
      ? localize('com_ui_tars_audit_trace_retry_tooltip', {
          attempt: call.attempt,
          reason: retryFailureReason(trace, call.retry_of),
        })
      : localize('com_ui_tars_audit_trace_attempt_nth', { n: call.attempt });
  }

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent className="flex max-h-[90vh] w-11/12 max-w-3xl flex-col overflow-hidden">
        <DialogFrame>
          <DialogBar>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="bg-surface-tertiary text-text-secondary flex size-7 shrink-0 items-center justify-center rounded-lg">
                  <RowIcon row={primary} className="size-4" />
                </div>
                <OGDialogTitle className="min-w-0">
                  <span className="block truncate">{title}</span>
                </OGDialogTitle>
                {/* The chat's name for the call is the title; the stored name stays beside it. */}
                {primary.tool_name && primary.tool_name !== title && (
                  <span className="text-text-tertiary truncate font-mono text-xs">
                    {primary.tool_name}
                  </span>
                )}
              </div>
              <CopyButton
                isCopied={jsonCopy.isCopied}
                onClick={() =>
                  jsonCopy.copyText(
                    JSON.stringify(buildDetailExportJson(row, call, result), null, 2),
                  )
                }
                label={localize('com_ui_tars_audit_trace_copy_json')}
                className="ml-0 text-xs font-medium"
              />
            </div>
          </DialogBar>
          <ScrollBox className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
            <TraceErrorBoundary
              title={localize('com_ui_tars_audit_trace_detail_error')}
              resetKey={primary.id || primary.tool_use_id}
            >
              <div className="border-border-light bg-surface-secondary/40 mb-4 flex flex-wrap items-center gap-2 rounded-xl border p-2.5 text-xs shadow-sm">
                {statusBadge}

                {turnNumber != null && turnNumber > 0 && (
                  <Chip tone="neutral" leading={chipIcon(Layers)}>
                    {localize('com_ui_tars_audit_trace_turn_n', { turn: turnNumber })}
                  </Chip>
                )}

                {duration != null && (
                  <Chip tone="neutral" leading={chipIcon(Timer)}>
                    <span className="tabular-nums">{fmtMs(duration, localize)}</span>
                  </Chip>
                )}

                {clockText != null && (
                  <Chip tone="neutral" leading={chipIcon(Clock)}>
                    <span className="tabular-nums">{clockText}</span>
                  </Chip>
                )}

                {call != null && call.attempt > 1 && (
                  <TooltipAnchor
                    description={retryDescription}
                    render={
                      <Chip tone="warning" leading={chipIcon(RefreshCw)} className="cursor-default">
                        {localize('com_ui_tars_audit_trace_attempt_nth', { n: call.attempt })}
                      </Chip>
                    }
                  />
                )}

                {result?.payload?.truncated === true && (
                  <Chip tone="warning" leading={chipIcon(Scissors)}>
                    {localize('com_ui_tars_audit_trace_truncated')}
                    {result.payload.output_len_chars != null
                      ? ` ${localize('com_ui_tars_audit_trace_char_count', {
                          chars: result.payload.output_len_chars.toLocaleString(),
                        })}`
                      : ''}
                  </Chip>
                )}

                {outputLimit > 0 && (
                  <Chip tone="neutral">
                    {localize('com_ui_tars_audit_trace_model_output_limit')}:{' '}
                    {localize('com_ui_tars_audit_trace_char_count', {
                      chars: outputLimit.toLocaleString(),
                    })}
                  </Chip>
                )}
              </div>

              {sources && sources.length > 0 && (
                <section className="mb-3.5 flex flex-col gap-1.5">
                  <h4 className="text-text-secondary flex items-center gap-1.5 text-xs font-medium">
                    <Globe className="text-text-tertiary size-3.5" aria-hidden="true" />
                    <span>{localize('com_ui_tars_audit_trace_sources_label')}</span>
                    <span className="text-text-tertiary text-xs font-normal tabular-nums">
                      ({sources.length})
                    </span>
                  </h4>
                  <div className="border-border-light bg-surface-secondary/40 rounded-xl border p-2.5 text-xs">
                    <ul className="space-y-1.5">
                      {sources.map((src, i) => {
                        const isUrl = /^https?:\/\//i.test(src);
                        return (
                          <li key={i} className="flex items-start gap-1.5 break-all">
                            <span className="text-text-tertiary shrink-0 tabular-nums">
                              {i + 1}.
                            </span>
                            {isUrl ? (
                              <a
                                href={src}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-text-primary decoration-border-medium hover:text-text-secondary inline-flex items-center gap-1 underline"
                              >
                                <span>{src}</span>
                                <ExternalLink
                                  className="size-3 shrink-0 opacity-70"
                                  aria-hidden="true"
                                />
                              </a>
                            ) : (
                              <span className="text-text-primary">{src}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </section>
              )}

              {/* The row id is in the key so switching rows resets each field's chunk progress. */}
              {fields.map(({ key, label, value }) => (
                <DetailField
                  key={`${primary.id || primary.tool_use_id || primary.event_type}-${key}`}
                  label={label}
                  value={value}
                  isError={key === 'output' && primary.ok === false}
                />
              ))}
              {fields.length === 0 && (!sources || sources.length === 0) && (
                <div className="text-text-tertiary py-6 text-center text-xs">
                  {localize('com_ui_tars_audit_trace_no_record')}
                </div>
              )}
            </TraceErrorBoundary>
          </ScrollBox>
        </DialogFrame>
      </OGDialogContent>
    </OGDialog>
  );
}
