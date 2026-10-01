/**
 * The knowledge bases an action is about to unbind. Unbinding drops the
 * site's vectors from each base, which cannot be undone.
 */
export default function UnbindWarning({ label, names }: { label: string; names: string[] }) {
  return (
    <div className="rounded-lg border border-border-light p-3 text-sm text-pwc-danger">
      <p className="mb-1">{label}</p>
      <ul className="list-disc pl-5">
        {names.map((name, index) => (
          <li key={`${index}-${name}`}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
