import { Input, Label } from '@librechat/client';
import { UNLIMITED } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * A token ceiling, held as the raw string pwc_tars will receive. `-1` is its
 * "no ceiling" sentinel, so the unlimited state is a real value the operator
 * picks rather than an empty field — an empty ceiling means *unset*, which
 * makes enforcement fall through to the next rule instead.
 */
export const isUnlimitedField = (value: string): boolean => value.trim() === String(UNLIMITED);

export const toLimitField = (value: number | null | undefined): string =>
  value == null ? '' : String(value);

/** The payload value, or null when the operator left the ceiling unset. */
export const fromLimitField = (value: string): number | null =>
  value.trim() === '' ? null : Number(value);

/** A ceiling is usable when it is unlimited or a positive number, as pwc_tars requires. */
export const isValidLimitField = (value: string): boolean => {
  if (isUnlimitedField(value)) {
    return true;
  }
  const parsed = Number(value);
  return value.trim() !== '' && Number.isFinite(parsed) && parsed > 0;
};

export default function LimitInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const localize = useLocalize();
  const unlimited = isUnlimitedField(value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <button
          type="button"
          aria-pressed={unlimited}
          onClick={() => onChange(unlimited ? '' : String(UNLIMITED))}
          className={
            unlimited
              ? 'shrink-0 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
              : 'shrink-0 whitespace-nowrap rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary hover:text-text-primary'
          }
        >
          {localize('com_ui_tars_quota_unlimited')}
        </button>
      </div>
      <Input
        id={id}
        type={unlimited ? 'text' : 'number'}
        min="1"
        disabled={unlimited}
        value={unlimited ? localize('com_ui_tars_quota_unlimited') : value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
