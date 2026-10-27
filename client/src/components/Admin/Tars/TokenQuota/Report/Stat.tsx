/** One headline number of the token report; `compact` is the user dialog's smaller tile. */
export default function Stat({
  label,
  value,
  hint,
  compact,
}: {
  label: string;
  value: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div className={`border-border-light rounded-xl border ${compact ? 'p-3' : 'p-4'}`}>
      <p className="text-text-secondary text-xs">{label}</p>
      <p
        className={`text-text-primary mt-1 font-semibold tabular-nums ${compact ? 'text-lg' : 'text-2xl'}`}
      >
        {value}
      </p>
      {hint != null && <p className="text-text-secondary mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}
