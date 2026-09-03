import * as React from 'react';
import { fieldControl, fieldEmbedded, fieldFlush, fieldInvalid } from './Field';
import { floatingField } from './floating';
import { cn } from '~/utils';
import './Field.css';

/** `title` edits a heading in place, so the field takes the heading's type scale. `inline` shares
 *  a row with icon Buttons, so it takes their height role and the row stays one height when a
 *  theme sizes fields and buttons apart. `floating` is the sign-in form field whose label rests
 *  inside it and lifts on focus. `flush` draws no border or ring because the surrounding frame owns
 *  the indicator, and `embedded` fills a list or popover row edge to edge. */
export const INPUT_VARIANTS: Record<
  'default' | 'inline' | 'title' | 'title-sm' | 'floating' | 'flush' | 'embedded',
  string
> = {
  default: '',
  inline: 'h-theme-button',
  title: 'h-theme-field-lg text-2xl font-semibold tracking-tight',
  'title-sm': 'text-base font-semibold tracking-tight',
  floating: floatingField,
  flush: fieldFlush,
  embedded: fieldEmbedded,
};

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  colorTransition?: boolean;
  variant?: keyof typeof INPUT_VARIANTS;
};

/** Types whose native picker otherwise only opens from the small calendar/clock icon. */
const PICKER_TYPES = new Set(['date', 'datetime-local', 'month', 'time', 'week']);

const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>> =
  React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, colorTransition, variant = 'default', onClick, type, ...props }, ref) => {
      const handleClick = (event: React.MouseEvent<HTMLInputElement>) => {
        onClick?.(event);
        const target = event.currentTarget;
        if (
          typeof type === 'string' &&
          PICKER_TYPES.has(type) &&
          !target.disabled &&
          !target.readOnly
        ) {
          try {
            (target as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            // Browsers without transient activation (e.g. a click that lost focus
            // mid-handler) throw here; the native icon click still works as a fallback.
          }
        }
      };

      return (
        <input
          type={type}
          className={cn(
            fieldControl,
            'ring-offset-surface-primary',
            fieldInvalid,
            INPUT_VARIANTS[variant],
            colorTransition && 'transition-colors',
            className ?? '',
          )}
          onClick={handleClick}
          ref={ref}
          placeholder={variant === 'floating' ? ' ' : undefined}
          {...props}
        />
      );
    },
  );

Input.displayName = 'Input';

export { Input };
