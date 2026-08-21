import { Button } from '@librechat/client';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { useLocalize } from '~/hooks';

/**
 * A failed load, told apart from an empty one.
 *
 * Rendering both as "nothing here" hides outages: a 404 from a backend that has
 * not picked up a new route looks exactly like a knowledge base with no
 * schedules, and there is no way to tell from the screen which happened.
 */
export default function ScheduleLoadFailed({ onRetry }: { onRetry: () => void }) {
  const localize = useLocalize();

  return (
    <div className="flex flex-col items-center gap-3 py-12 text-sm text-text-secondary">
      <TriangleAlert className="size-8 text-pwc-danger" aria-hidden />
      <p>{localize('com_ui_tars_sched_load_failed')}</p>
      <Button variant="outline" onClick={onRetry} className="gap-1.5">
        <RotateCw className="size-4" aria-hidden />
        {localize('com_ui_refresh')}
      </Button>
    </div>
  );
}
