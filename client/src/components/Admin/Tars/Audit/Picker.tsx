import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Label } from '@librechat/client';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useLocalize } from '~/hooks';

export interface PickerOption {
  value: string;
  label: string;
}

/**
 * The first candidate that is actually readable.
 *
 * pwc_tars stores optional display names as nullable strings, so a person who
 * never set one can arrive as `''` rather than `null` — and `??` would keep
 * that empty string, leaving a blank row at the top of the list.
 */
export const pickerLabel = (...candidates: (string | null | undefined)[]): string => {
  for (const candidate of candidates) {
    if (candidate != null && candidate.trim() !== '') {
      return candidate;
    }
  }
  return '';
};

/**
 * A searchable multi-select for the audit filters.
 *
 * `MultiSelect` from `@librechat/client` has no search box, and these lists are
 * every user and every knowledge base in the tenant — long enough that scrolling
 * to find one is the slow path. Built on plain elements so the filter text,
 * checked state and keyboard handling stay in one readable place.
 */
export default function Picker({
  id,
  label,
  options,
  selected,
  onChange,
  placeholder,
  disabled,
  chips = false,
}: {
  id: string;
  label: string;
  options: PickerOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  /** Show every pick as a removable chip instead of a one-line summary. */
  chips?: boolean;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  /** Clicking anywhere else commits the selection, as a native `<select>` would. */
  useEffect(() => {
    if (!open) {
      return;
    }
    /** Opening the list is a deliberate act, so typing should go straight to it. */
    filterRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, filter]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const labelByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option.label])),
    [options],
  );

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  /** One pick reads better as its own name than as a count. */
  const summarize = (): string => {
    if (selected.length === 0) {
      return placeholder;
    }
    if (selected.length === 1) {
      return labelByValue.get(selected[0]) ?? placeholder;
    }
    return localize('com_ui_tars_audit_selected_count', { 0: String(selected.length) });
  };
  const summary = summarize();

  /**
   * Props for a control nested in the trigger button. It must not also toggle
   * the list, and a `<button>` cannot nest, so it is a keyboard-reachable span.
   */
  const nestedAction = (label: string, action: () => void) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation();
      action();
    },
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation();
        event.preventDefault();
        action();
      }
    },
  });

  const renderValue = () => {
    if (!chips || selected.length === 0) {
      return (
        <span
          className={`truncate ${selected.length === 0 ? 'text-text-secondary' : ''}`}
          title={selected.length > 0 ? summary : undefined}
        >
          {summary}
        </span>
      );
    }
    return (
      <span className="flex min-w-0 flex-wrap gap-1">
        {selected.map((value) => {
          /** A pick whose option is gone (a removed user) still shows, so it can be removed. */
          const label = labelByValue.get(value) ?? value;
          return (
            <span
              key={value}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-tertiary py-0.5 pl-2 pr-1 text-xs text-text-primary"
            >
              <span className="truncate" title={label}>
                {label}
              </span>
              <span
                {...nestedAction(localize('com_ui_tars_audit_remove_option', { 0: label }), () =>
                  toggle(value),
                )}
                className="rounded-full p-0.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              >
                <X className="size-3" aria-hidden />
              </span>
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`flex w-full items-center justify-between gap-2 rounded-md border border-border-light bg-surface-primary px-3 text-left text-sm text-text-primary disabled:opacity-50 ${
            chips ? 'min-h-10 py-1.5' : 'h-10'
          }`}
        >
          {renderValue()}
          <span className="flex shrink-0 items-center gap-1">
            {selected.length > 0 && (
              <span
                {...nestedAction(localize('com_ui_clear'), () => onChange([]))}
                className="rounded p-0.5 text-text-secondary hover:bg-surface-tertiary"
              >
                <X className="size-3.5" aria-hidden />
              </span>
            )}
            <ChevronDown className="size-4 text-text-secondary" aria-hidden />
          </span>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border-light bg-surface-primary shadow-lg">
            <div className="flex items-center gap-2 border-b border-border-light px-2 py-1.5">
              <Search className="size-4 shrink-0 text-text-secondary" aria-hidden />
              <Input
                ref={filterRef}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={localize('com_ui_tars_audit_search_placeholder')}
                className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
              />
            </div>
            <ul role="listbox" aria-multiselectable className="max-h-60 overflow-y-auto py-1">
              {visible.length === 0 && (
                <li className="px-3 py-2 text-sm text-text-secondary">
                  {localize('com_ui_no_results_found')}
                </li>
              )}
              {visible.map((option) => {
                const checked = selectedSet.has(option.value);
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      onClick={() => toggle(option.value)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-tertiary"
                    >
                      <Check
                        className={`size-4 shrink-0 text-brand-primary ${
                          checked ? 'opacity-100' : 'opacity-0'
                        }`}
                        aria-hidden
                      />
                      <span className="truncate">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
