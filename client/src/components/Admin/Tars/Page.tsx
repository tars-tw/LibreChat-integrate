import type { ReactNode } from 'react';
import { cn } from '~/utils';

interface TarsPageProps {
  /** Omitted when the content renders its own heading. */
  title?: string;
  children: ReactNode;
  /** How the column lays out its children; stacked with `space-y-6` by default. */
  className?: string;
  /** Added to the scrolling shell, e.g. to let a full-height page scroll inside itself. */
  shellClassName?: string;
  titleClassName?: string;
}

/**
 * The full-page frame every TARS management screen shares. Up to `2xl` it keeps the
 * 1280px column laptops are tuned for; wider screens get up to 1920px with roomier
 * gutters, so the page is not mostly margin next to the side nav.
 */
export default function TarsPage({
  title,
  children,
  className = 'space-y-6',
  shellClassName,
  titleClassName,
}: TarsPageProps) {
  return (
    <div className={cn('bg-presentation h-full w-full overflow-y-auto', shellClassName)}>
      <div className={cn('mx-auto max-w-7xl p-6 2xl:max-w-[120rem] 2xl:px-12', className)}>
        {title != null && (
          <h1 className={cn('text-text-primary text-2xl font-semibold', titleClassName)}>
            {title}
          </h1>
        )}
        {children}
      </div>
    </div>
  );
}
