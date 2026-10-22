import type { TranslationKeys } from '~/hooks';
import type { Localize } from './layout';

/** The summary fields the time breakdown reads (see `summarizeTrace`). */
export type BreakdownInput = {
  modelPercent: number | null;
  toolSuccessPercent?: number | null;
  toolFailPercent?: number | null;
  otherPercent?: number | null;
  modelDurationMs?: number | null;
  toolSuccessWaitMs?: number | null;
  toolFailWaitMs?: number | null;
  otherWaitMs?: number | null;
};

export type BreakdownKey = 'model' | 'toolSuccess' | 'toolFail' | 'other';

export type BreakdownShare = {
  key: BreakdownKey;
  percent: number;
  durationMs: number | null;
  labelKey: TranslationKeys;
  descKey: TranslationKeys;
};

/**
 * One color per share, for the bar's segments and the hover card's dots alike:
 * the model on the chart's generation series, tool outcomes on the status
 * roles. A dot is solid, its segment a lighter tint.
 */
export const BREAKDOWN_TONES: Record<BreakdownKey, { dot: string; segment: string }> = {
  model: { dot: 'bg-series-2', segment: 'bg-series-2/40' },
  toolSuccess: { dot: 'bg-status-success', segment: 'bg-status-success/40' },
  toolFail: { dot: 'bg-status-error', segment: 'bg-status-error/40' },
  other: { dot: 'bg-text-tertiary', segment: 'bg-border-medium' },
};

/** Below this, "other" is rounding noise rather than time worth naming. */
const OTHER_MIN_PERCENT = 1;

/**
 * The shares of the run's time, in legend order, that the bar, the hover card
 * and the text report all draw from. Tools are split by outcome only when both
 * outcomes occurred; otherwise the one share is just "tools" or "failed tools".
 */
export function breakdownShares(summary: BreakdownInput): BreakdownShare[] {
  if (summary.modelPercent == null) {
    return [];
  }
  const success = summary.toolSuccessPercent ?? 0;
  const fail = summary.toolFailPercent ?? 0;
  const other = summary.otherPercent ?? 0;
  const split = success > 0 && fail > 0;
  const shares: BreakdownShare[] = [
    {
      key: 'model',
      percent: summary.modelPercent,
      durationMs: summary.modelDurationMs ?? null,
      labelKey: 'com_ui_tars_audit_trace_model_label',
      descKey: 'com_ui_tars_audit_trace_breakdown_desc_model',
    },
  ];
  if (success > 0) {
    shares.push({
      key: 'toolSuccess',
      percent: success,
      durationMs: summary.toolSuccessWaitMs ?? null,
      labelKey: split
        ? 'com_ui_tars_audit_trace_success_tool'
        : 'com_ui_tars_audit_trace_tool_label',
      descKey: split
        ? 'com_ui_tars_audit_trace_breakdown_desc_success_tool'
        : 'com_ui_tars_audit_trace_breakdown_desc_tool',
    });
  }
  if (fail > 0) {
    shares.push({
      key: 'toolFail',
      percent: fail,
      durationMs: summary.toolFailWaitMs ?? null,
      labelKey: 'com_ui_tars_audit_trace_fail_tool',
      descKey: 'com_ui_tars_audit_trace_breakdown_desc_fail_tool',
    });
  }
  if (other >= OTHER_MIN_PERCENT) {
    shares.push({
      key: 'other',
      percent: other,
      durationMs: summary.otherWaitMs ?? null,
      labelKey: 'com_ui_tars_audit_trace_other',
      descKey: 'com_ui_tars_audit_trace_breakdown_desc_other',
    });
  }
  return shares;
}

/** One line for the bar's accessible name and the text report: `模型 60%、工具 30%、其他 10%`. */
export function formatBreakdownText(shares: BreakdownShare[], localize: Localize): string {
  return shares
    .map((share) =>
      localize('com_ui_tars_audit_trace_breakdown_share', {
        label: localize(share.labelKey),
        percent: share.percent,
      }),
    )
    .join(localize('com_ui_tars_audit_trace_list_separator'));
}
