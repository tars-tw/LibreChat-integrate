import * as React from 'react';
import { fieldControl } from './Field';
import { cn } from '~/utils';
import './Field.css';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** Types whose native picker otherwise only opens from the small calendar/clock icon. */
const PICKER_TYPES = new Set(['date', 'datetime-local', 'month', 'time', 'week']);

const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>> =
  React.forwardRef<HTMLInputElement, InputProps>(({ className, onClick, type, ...props }, ref) => {
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
        className={cn(fieldControl, 'ring-offset-surface-primary', className ?? '')}
        onClick={handleClick}
        ref={ref}
        {...props}
      />
    );
  });

Input.displayName = 'Input';

export { Input };
