import { useRef, useEffect } from 'react';
import type { PromptCategory } from './filter';
import { ALL_CATEGORIES, UNCATEGORIZED } from './filter';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const CHIP_CLASSES =
  'focus-visible:ring-ring-primary inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors select-none focus-visible:ring-2 focus-visible:outline-hidden';

/**
 * One row of category chips (全部 first), single choice, scrolling sideways when
 * it overflows. A vertical wheel scrolls it too, since a mouse has no other way
 * to reach the chips past the edge.
 */
export default function CategoryFilter({
  categories,
  selected,
  onSelect,
  className,
}: {
  categories: PromptCategory[];
  selected: string;
  onSelect: (category: string) => void;
  className?: string;
}) {
  const localize = useLocalize();
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || row.scrollWidth <= row.clientWidth) {
        return;
      }
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    };
    row.addEventListener('wheel', handleWheel, { passive: false });
    return () => row.removeEventListener('wheel', handleWheel);
  }, []);

  const total = categories.reduce((sum, category) => sum + category.count, 0);
  const chips = [
    { value: ALL_CATEGORIES, label: localize('com_ui_all_proper'), count: total },
    ...categories.map(({ value, count }) => ({
      value,
      label: value === UNCATEGORIZED ? localize('com_ui_no_category') : value,
      count,
    })),
  ];

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={localize('com_ui_tars_prompts_category_filter')}
      className={cn('scrollbar-hover flex gap-1.5 overflow-x-auto pb-3', className)}
    >
      {chips.map(({ value, label, count }) => {
        const isSelected = selected === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isSelected}
            title={label}
            onClick={(event) => {
              event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
              onSelect(value);
            }}
            className={cn(
              CHIP_CLASSES,
              isSelected
                ? 'border-border-chrome-heavy bg-surface-active-alt text-text-primary'
                : 'border-border-chrome bg-surface-secondary text-text-secondary hover:bg-surface-hover hover:text-text-primary',
            )}
          >
            <span className="max-w-32 truncate">{label}</span>
            <span className={isSelected ? 'text-text-secondary' : 'text-text-tertiary'}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
