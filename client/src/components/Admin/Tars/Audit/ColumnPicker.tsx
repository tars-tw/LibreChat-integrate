import { Checkbox, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { AuditColumn } from './helpers';
import { useLocalize } from '~/hooks';

/**
 * Chooses which optional columns a table shows. Locked columns are listed but
 * disabled, so the operator can see the full column inventory in one place
 * rather than wondering why four of them are missing from the picker.
 */
export default function ColumnPicker({
  open,
  onOpenChange,
  columns,
  visible,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: AuditColumn[];
  visible: string[];
  onChange: (fields: string[]) => void;
}) {
  const localize = useLocalize();

  const toggle = (field: string) =>
    onChange(visible.includes(field) ? visible.filter((f) => f !== field) : [...visible, field]);

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_audit_columns')}
        showCloseButton={true}
        className="w-11/12 md:max-w-md"
        main={
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_audit_columns_hint')}
            </p>
            <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
              {columns.map((column) => {
                const locked = column.locked === true;
                return (
                  <li key={column.field}>
                    <label
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                        locked
                          ? 'cursor-not-allowed text-text-secondary'
                          : 'cursor-pointer text-text-primary hover:bg-surface-tertiary'
                      }`}
                    >
                      <Checkbox
                        aria-label={localize(column.labelKey)}
                        checked={locked || visible.includes(column.field)}
                        disabled={locked}
                        onCheckedChange={() => !locked && toggle(column.field)}
                      />
                      {localize(column.labelKey)}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        }
      />
    </OGDialog>
  );
}
