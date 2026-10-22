import { TooltipAnchor } from '@librechat/client';
import { TARS_TRACE_EVENT } from 'librechat-data-provider';
import { Hourglass, Sparkles, Workflow, Wrench } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { TraceSummary } from './summary';
import type { ChartRow } from './layout';
import {
  LANE_HEIGHT_PX,
  NESTED_LANE_HEIGHT_PX,
  pct,
  fmtMs,
  laneBox,
  fmtClock,
  fmtElapsedTick,
  statusKindLabel,
} from './layout';
import { RowIcon, rowLabel, statusKindIcon } from './icons';
import { retryFailureReason } from './outcome';
import { barGeometry } from './summary';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Measured for the widest label (the nested sub-task one); every row must share it to stay time-aligned. */
const TRACK_LABEL_PX = 96;
/** Height of the ruler below the tracks, which the status overlay must stop above. */
const RULER_PX = 21;

/**
 * A tool that ran is green and one that failed is red, on the status roles the
 * shared `Chip` uses for those tones. Model time takes the series color the
 * native trace viewer gives a generation, since it is neither outcome.
 */
const BAR_TONES = {
  model: 'border-series-2/40 bg-series-2/15 text-text-primary',
  good: 'border-status-success-border bg-status-success-subtle text-status-success',
  bad: 'border-status-error-border bg-status-error-subtle text-status-error',
} as const;

/** A bar that did not fail takes its track's tone. */
const TRACK_TONES = { model: 'model', tool: 'good' } as const;

/** One labelled row of the chart, with a gridline under each ruler tick. */
function Track({
  label,
  icon: Icon,
  laneCount,
  nested = false,
  ticks,
  total,
  children,
}: {
  label: string;
  icon?: React.ElementType;
  laneCount: number;
  nested?: boolean;
  ticks: number[];
  total: number;
  children: ReactNode;
}) {
  const height = (nested ? NESTED_LANE_HEIGHT_PX : LANE_HEIGHT_PX) * laneCount;
  return (
    <div
      className={cn(
        'border-border-light relative flex items-stretch border-t border-dashed first:border-t-0',
        nested && 'bg-surface-secondary',
      )}
      style={{ minHeight: height }}
    >
      <div
        className={cn(
          'text-text-secondary flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap',
          nested && 'pl-3.5',
        )}
        style={{ width: TRACK_LABEL_PX }}
      >
        {Icon != null && <Icon className="text-text-tertiary size-3.5 shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className="relative flex-1">
        {ticks.map((tick) => (
          <span
            key={tick}
            aria-hidden
            className="bg-border-light absolute top-0 bottom-0 w-px"
            style={{ left: `${pct(tick, total)}%` }}
          />
        ))}
        {children}
      </div>
    </div>
  );
}

/**
 * The Gantt-style timeline: model turns, top-level tool calls and each delegate's
 * sub-calls on their own tracks, with status notices as dashed lines across all
 * of them. Clicking a bar opens its full input/output.
 */
export default function TraceChart({
  summary,
  onSelect,
}: {
  summary: TraceSummary;
  onSelect: (row: ChartRow) => void;
}) {
  const localize = useLocalize();
  const { chart, modelRows, topToolRows, nestedByParent, chartTicks, tickStep } = summary;
  const total = chart.total;
  const DOT = localize('com_ui_tars_audit_trace_inline_separator');

  const renderBar = (row: ChartRow, index: number, laneCount: number, small = false) => {
    const failed =
      row.ok === false &&
      (row.event_type === TARS_TRACE_EVENT.toolResult ||
        row.event_type === TARS_TRACE_EVENT.langflowRoute);
    const tone = failed ? 'bad' : TRACK_TONES[row._track];
    const label = rowLabel(localize, row);
    const { left, width } = barGeometry(row._start, row._end, total);
    const { top, bottom } = laneBox(
      row._lane,
      laneCount,
      small ? NESTED_LANE_HEIGHT_PX : LANE_HEIGHT_PX,
    );
    const style: CSSProperties = { left: `${left}%`, width: `${width}%`, top, bottom };
    /** The bar shows the chat's name for the call; its stored name and timing are on hover. */
    const description = [
      label,
      row.tool_name && row.tool_name !== label ? row.tool_name : null,
      fmtMs(row.duration_ms ?? row._end - row._start, localize),
      row.attempt > 1
        ? localize('com_ui_tars_audit_trace_retry_tooltip', {
            attempt: row.attempt,
            reason: retryFailureReason(summary.trace, row.retry_of),
          })
        : null,
    ]
      .filter(Boolean)
      .join(DOT);
    return (
      <TooltipAnchor
        key={`${row.event_type}-${row.tool_use_id || row.id || index}`}
        description={description}
        side="top"
        render={
          <button
            type="button"
            className={cn(
              'hover:ring-border-heavy focus-visible:ring-ring-primary absolute flex min-w-2 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-xs font-medium whitespace-nowrap hover:z-10 hover:ring-1 focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none',
              BAR_TONES[tone],
            )}
            style={style}
            onClick={() => onSelect(row)}
          >
            <RowIcon row={row} className="size-3" />
            <span className="truncate">{label}</span>
            {row.attempt > 1 && (
              <span className="border-status-warning-border bg-status-warning-subtle text-status-warning rounded-full border px-1.5 text-xs font-semibold tabular-nums">
                #{row.attempt}
              </span>
            )}
          </button>
        }
      />
    );
  };

  const hasMarkers = chart.statusMarkers.length > 0;

  return (
    <div className="border-border-light bg-surface-secondary mb-3 overflow-x-auto rounded-xl border p-3 pb-2">
      <div className={cn('relative min-w-[560px]', hasMarkers ? 'pt-3.5' : 'pt-0.5')}>
        {/* A Langflow-routed message has no model turns of its own. */}
        {(!summary.isLangflowRoute || modelRows.length > 0) && (
          <Track
            icon={Sparkles}
            label={localize('com_ui_tars_audit_trace_model_label')}
            laneCount={summary.modelLanes}
            ticks={chartTicks}
            total={total}
          >
            {summary.waitRegions.map((wait) => {
              const { top, bottom } = laneBox(wait.lane, summary.modelLanes, LANE_HEIGHT_PX);
              const { left, width } = barGeometry(wait.start, wait.end, total);
              return (
                <TooltipAnchor
                  key={`wait-${wait.turn}`}
                  description={localize('com_ui_tars_audit_trace_wait_region_tooltip', {
                    clock: fmtClock(chart.baseMs + wait.start),
                    duration: fmtMs(wait.end - wait.start, localize),
                  })}
                  side="top"
                  render={
                    <span
                      className="border-border-heavy bg-surface-tertiary/40 text-text-tertiary absolute flex items-center overflow-hidden rounded-l-md border border-r-0 border-dashed px-1.5 select-none"
                      style={{ left: `${left}%`, width: `${width}%`, top, bottom }}
                    >
                      <Hourglass className="size-3 shrink-0 opacity-70" aria-hidden="true" />
                    </span>
                  }
                />
              );
            })}
            {modelRows.map((row, index) => renderBar(row, index, summary.modelLanes))}
          </Track>
        )}
        <Track
          icon={Wrench}
          label={localize('com_ui_tars_audit_trace_tool_label')}
          laneCount={summary.topToolLanes}
          ticks={chartTicks}
          total={total}
        >
          {topToolRows.map((row, index) => renderBar(row, index, summary.topToolLanes))}
        </Track>
        {Object.entries(nestedByParent).map(([parentId, rows]) => (
          <Track
            key={parentId}
            icon={Workflow}
            label={localize('com_ui_tars_audit_trace_subtask')}
            laneCount={summary.nestedLaneCounts[parentId]}
            ticks={chartTicks}
            total={total}
            nested
          >
            {rows.map((row, index) =>
              renderBar(row, index, summary.nestedLaneCounts[parentId], true),
            )}
          </Track>
        ))}

        <div className="border-border-light mt-0.5 flex items-stretch border-t border-dashed">
          <div aria-hidden className="shrink-0" style={{ width: TRACK_LABEL_PX }} />
          <div className="relative h-5 flex-1">
            {chartTicks.map((tick) => (
              <span
                key={tick}
                className="text-text-secondary absolute top-0 flex -translate-x-1/2 flex-col items-center text-xs leading-none whitespace-nowrap tabular-nums"
                style={{ left: `${pct(tick, total)}%` }}
              >
                <span aria-hidden className="bg-text-secondary h-1 w-px" />
                <span className="mt-1">{fmtElapsedTick(tick, tickStep, localize)}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Overlaid on the whole chart rather than one track, so each line spans every track. */}
        <div
          className="pointer-events-none absolute top-0 right-0"
          style={{ left: TRACK_LABEL_PX, bottom: RULER_PX }}
        >
          {chart.statusMarkers.map((marker, index) => {
            const Icon = statusKindIcon(marker.payload?.kind);
            const kind = statusKindLabel(localize, marker.payload?.kind);
            return (
              <TooltipAnchor
                key={`status-${index}`}
                description={localize('com_ui_tars_audit_trace_status_marker_tooltip', {
                  clock: fmtClock(marker.started_at),
                  kind,
                  message: marker.payload?.message || '—',
                })}
                side="top"
                render={
                  <span
                    className="pointer-events-auto absolute top-0 bottom-0"
                    style={{ left: `${pct(marker._start, total)}%` }}
                  >
                    <span className="border-border-heavy absolute top-0 bottom-0 left-0 border-l border-dashed" />
                    <span className="text-text-secondary absolute top-0 left-1 flex items-center gap-0.5 text-xs leading-none whitespace-nowrap">
                      <Icon className="size-2.5" aria-hidden />
                      {kind}
                    </span>
                  </span>
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
