/** Section shell shared by the system settings cards. */
export default function Card({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border-light">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-light px-4 py-3">
        <div>
          <h2 className="text-base font-medium text-text-primary">{title}</h2>
          {description != null && (
            <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
          )}
        </div>
        {actions}
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}
