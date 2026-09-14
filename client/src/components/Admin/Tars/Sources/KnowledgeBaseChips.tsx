import { useLocalize } from '~/hooks';

/**
 * The knowledge bases a data source is granted to, as a table cell.
 *
 * A connection is only useful once it is granted to a base, and that grant was
 * previously invisible until the row was opened. Every name renders — wrapping
 * onto more lines rather than collapsing into a "+N" that hides which bases a
 * source is actually granted to.
 */
export default function KnowledgeBaseChips({ names }: { names: string[] }) {
  const localize = useLocalize();

  if (names.length === 0) {
    return (
      <span className="text-text-tertiary">{localize('com_ui_tars_db_allowed_kbs_none')}</span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {names.map((name) => (
        <span
          key={name}
          className="max-w-[16rem] truncate rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary"
          title={name}
        >
          {name}
        </span>
      ))}
    </span>
  );
}
