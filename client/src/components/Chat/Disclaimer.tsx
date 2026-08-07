import { memo } from 'react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The AI-output disclaimer. It sits inside the composer's column so it hugs the input
 * box and travels with it, rather than at the page footer; `Footer` still renders it
 * where there is no composer (e.g. a shared conversation). Hidden on small screens,
 * matching the footer it was split out of.
 */
function Disclaimer({ className }: { className?: string }) {
  const localize = useLocalize();

  return (
    <div
      className={cn(
        'hidden px-2 pt-3.5 text-center text-xs leading-tight text-text-secondary sm:block',
        className,
      )}
    >
      {localize('com_ui_ai_disclaimer')}
    </div>
  );
}

const MemoizedDisclaimer = memo(Disclaimer);
MemoizedDisclaimer.displayName = 'Disclaimer';

export default MemoizedDisclaimer;
