import { useMemo } from 'react';
import { HoverCard, HoverCardPortal, HoverCardTrigger, HoverCardContent } from '@librechat/client';
import type { BreakdownInput } from './breakdown';
import { BREAKDOWN_TONES, breakdownShares, formatBreakdownText } from './breakdown';
import { useLocalize } from '~/hooks';
import { fmtMs } from './layout';
import { cn } from '~/utils';

/** Where the run's time went: a segmented bar whose hover card names each share. */
export default function BreakdownMeter({ summary }: { summary: BreakdownInput }) {
  const localize = useLocalize();
  const shares = useMemo(() => breakdownShares(summary), [summary]);
  if (shares.length === 0) {
    return null;
  }
  const colon = localize('com_ui_tars_audit_trace_colon');

  return (
    <HoverCard openDelay={100} closeDelay={50}>
      <HoverCardTrigger asChild>
        {/* The padding only widens the hover target; the bar stays 8px, as `SegmentedMeter` draws one. */}
        <div
          role="img"
          aria-label={formatBreakdownText(shares, localize)}
          className="group/breakdown -my-2 flex cursor-help items-center py-2"
        >
          <div className="bg-surface-tertiary flex h-2 w-28 gap-0.5 overflow-hidden rounded-full transition-opacity group-hover/breakdown:opacity-90 sm:w-32">
            {shares.map(({ key, percent }) => (
              <div
                key={key}
                style={{ width: `${percent}%` }}
                className={cn('h-full min-w-[2px]', BREAKDOWN_TONES[key].segment)}
              />
            ))}
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent side="top" className="w-auto max-w-xs">
          <ul className="flex flex-col gap-1.5 text-xs">
            {shares.map((share) => (
              <li key={share.key} className="flex items-start gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-[5px] inline-block size-[7px] shrink-0 rounded-full',
                    BREAKDOWN_TONES[share.key].dot,
                  )}
                />
                <div className="leading-relaxed">
                  <strong className="text-text-primary font-medium">
                    {localize(share.labelKey)} {share.percent}%
                    {(share.durationMs ?? 0) > 0 &&
                      localize('com_ui_tars_audit_trace_duration_note', {
                        duration: fmtMs(Math.round(share.durationMs ?? 0), localize),
                      })}
                    {colon}
                  </strong>
                  <span className="text-text-tertiary">{localize(share.descKey)}</span>
                </div>
              </li>
            ))}
          </ul>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
