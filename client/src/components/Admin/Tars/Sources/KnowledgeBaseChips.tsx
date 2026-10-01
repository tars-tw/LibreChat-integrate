import { CircleOff } from 'lucide-react';
import { useLocalize } from '~/hooks';

/**
 * The knowledge bases a data source is granted to, as a table cell.
 *
 * A connection is only useful once it is granted to a base, and that grant was
 * previously invisible until the row was opened. Every name renders — wrapping
 * onto more lines rather than collapsing into a "+N" that hides which bases a
 * source is actually granted to.
 */
export default function KnowledgeBaseChips({
  names,
  emptyLabel,
}: {
  names: string[];
  /** What an empty cell means for this source; defaults to "not granted". */
  emptyLabel?: string;
}) {
  const localize = useLocalize();

  if (names.length === 0) {
    const label = emptyLabel ?? localize('com_ui_tars_db_allowed_kbs_none');
    return (
      <span role="img" aria-label={label} title={label} className="inline-flex">
        <CircleOff className="size-3.5 text-text-tertiary" aria-hidden />
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {names.map((name, index) => (
        <span
          key={`${index}-${name}`}
          className="max-w-[16rem] truncate rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary"
          title={name}
        >
          {name}
        </span>
      ))}
    </span>
  );
}
