import { Spinner } from '@librechat/client';
import type { StatusMeta } from './helpers';
import { useLocalize } from '~/hooks';

/** One dataset's processing state, shared by all four tabs. */
export default function StatusBadge({ meta }: { meta: StatusMeta }) {
  const localize = useLocalize();

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${meta.className}`}
    >
      {meta.spinning === true && <Spinner className="size-3" />}
      {localize(meta.labelKey)}
    </span>
  );
}
