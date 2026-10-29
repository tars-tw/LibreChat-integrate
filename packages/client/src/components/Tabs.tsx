import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn, disabledInkClasses } from '~/utils';
import { focusOutlineRole } from './Focus';

const Tabs: React.ForwardRefExoticComponent<
  TabsPrimitive.TabsProps & React.RefAttributes<HTMLDivElement>
> = TabsPrimitive.Root;

/**
 * `default` marks the selected tab with a fill; `underline` (page-level navigation) with
 * the brand color and a bar under it, starting flush with the content's left edge.
 */
export type TabsVariant = 'default' | 'underline';

const LIST_VARIANTS: Record<TabsVariant, string> = {
  default: 'bg-surface-primary inline-flex items-center justify-center rounded-md',
  underline: 'border-border-light flex w-full items-end gap-10 border-b',
};

const TRIGGER_VARIANTS: Record<TabsVariant, string> = {
  default:
    'data-[state=active]:bg-surface-primary data-[state=active]:text-text-primary rounded-theme-tab min-w-theme-tab justify-center px-3 py-1.5',
  underline:
    'hover:text-text-primary data-[state=active]:text-brand-primary -mb-px border-b-2 border-transparent px-0 pt-1 pb-2 data-[state=active]:border-current',
};

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  variant?: TabsVariant;
};

const TabsList: React.ForwardRefExoticComponent<
  TabsListProps & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ className = '', variant = 'default', ...props }, ref) => (
    <TabsPrimitive.List
      ref={ref}
      data-variant={variant}
      className={cn(LIST_VARIANTS[variant], className)}
      {...props}
    />
  ),
);
TabsList.displayName = TabsPrimitive.List.displayName;

type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  /** Matches the `TabsList` it sits in. */
  variant?: TabsVariant;
};

const TabsTrigger: React.ForwardRefExoticComponent<
  TabsTriggerProps & React.RefAttributes<HTMLButtonElement>
> = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(
  ({ className = '', variant = 'default', ...props }, ref) => (
    <TabsPrimitive.Trigger
      data-variant={variant}
      className={cn(
        'text-text-secondary inline-flex items-center text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50',
        TRIGGER_VARIANTS[variant],
        disabledInkClasses,
        focusOutlineRole,
        className,
      )}
      {...props}
      ref={ref}
    />
  ),
);
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent: React.ForwardRefExoticComponent<
  Omit<TabsPrimitive.TabsContentProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
> = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className = '', ...props }, ref) => (
  <TabsPrimitive.Content className={cn('mt-2 rounded-md p-6', className)} {...props} ref={ref} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
