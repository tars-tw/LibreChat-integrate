import { useLocalize } from '~/hooks';

/** How many knowledge-base names fit in a cell before the rest become "+N". */
const CHIP_LIMIT = 2;

/**
 * The knowledge bases a data source is granted to, as a table cell.
 *
 * A connection is only useful once it is granted to a base, and that grant was
 * previously invisible until the row was opened.
 */
export default function KnowledgeBaseChips({ names }: { names: string[] }) {
  const localize = useLocalize();

  if (names.length === 0) {
    return (
      <span className="text-text-tertiary">{localize('com_ui_tars_db_allowed_kbs_none')}</span>
    );
  }

  const shown = names.slice(0, CHIP_LIMIT);
  const overflow = names.length - shown.length;

  return (
    <span className="flex flex-wrap items-center gap-1" title={names.join(', ')}>
      {shown.map((name) => (
        <span
          key={name}
          className="max-w-[10rem] truncate rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary"
        >
          {name}
        </span>
      ))}
      {overflow > 0 && <span className="text-xs text-text-tertiary">+{overflow}</span>}
    </span>
  );
}
