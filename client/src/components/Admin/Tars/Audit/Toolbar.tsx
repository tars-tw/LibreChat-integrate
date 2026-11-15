import { useState } from 'react';
import { Button } from '@librechat/client';
import { Download, SlidersHorizontal } from 'lucide-react';
import type { AuditColumn } from './helpers';
import ColumnPicker from './ColumnPicker';
import { useLocalize } from '~/hooks';

/** The column picker and CSV export buttons above an audit table. */
export default function Toolbar({
  columns,
  visible,
  onVisibleChange,
  onExport,
  canExport,
  columnsHint,
}: {
  columns: AuditColumn[];
  visible: string[];
  onVisibleChange: (fields: string[]) => void;
  onExport: () => void;
  canExport: boolean;
  columnsHint?: string;
}) {
  const localize = useLocalize();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setPickerOpen(true)}
        aria-label={localize('com_ui_tars_audit_columns')}
        title={localize('com_ui_tars_audit_columns')}
      >
        <SlidersHorizontal className="text-text-primary size-4 dark:text-white" aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onExport}
        disabled={!canExport}
        aria-label={localize('com_ui_tars_audit_export')}
        title={localize('com_ui_tars_audit_export')}
      >
        <Download className="text-text-primary size-4 dark:text-white" aria-hidden />
      </Button>
      <ColumnPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        columns={columns}
        visible={visible}
        onChange={onVisibleChange}
        hint={columnsHint}
      />
    </div>
  );
}
