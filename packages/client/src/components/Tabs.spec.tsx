import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { TabsVariant } from './Tabs';
import { Tabs, TabsList, TabsTrigger } from './Tabs';

const renderTabs = (variant?: TabsVariant) =>
  render(
    <Tabs defaultValue="one">
      <TabsList variant={variant}>
        <TabsTrigger value="one" variant={variant}>
          One
        </TabsTrigger>
        <TabsTrigger value="two" variant={variant}>
          Two
        </TabsTrigger>
      </TabsList>
    </Tabs>,
  );

describe('Tabs', () => {
  it('keeps the filled selection by default', () => {
    renderTabs();

    const selected = screen.getByRole('tab', { name: 'One' });
    expect(selected).toHaveAttribute('data-variant', 'default');
    expect(selected).toHaveClass('data-[state=active]:bg-surface-primary', 'min-w-theme-tab');
    expect(screen.getByRole('tablist')).toHaveClass('bg-surface-primary');
  });

  it('marks the underline selection with the brand color and a bar, flush left', () => {
    renderTabs('underline');

    const selected = screen.getByRole('tab', { name: 'One' });
    expect(selected).toHaveAttribute('data-variant', 'underline');
    expect(selected).toHaveAttribute('data-state', 'active');
    expect(selected).toHaveClass(
      'data-[state=active]:text-brand-primary',
      'data-[state=active]:border-current',
      'border-b-2',
      'px-0',
    );
    expect(selected).not.toHaveClass('min-w-theme-tab', 'data-[state=active]:bg-surface-primary');
    expect(screen.getByRole('tablist')).not.toHaveClass('bg-surface-primary');
  });
});
