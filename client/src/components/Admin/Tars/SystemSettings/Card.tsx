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
    <section className="border-border-light rounded-xl border">
      <header className="border-border-light flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-text-primary text-base font-medium">{title}</h2>
          {description != null && (
            <p className="text-text-secondary mt-0.5 text-xs">{description}</p>
          )}
        </div>
        {actions}
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}
