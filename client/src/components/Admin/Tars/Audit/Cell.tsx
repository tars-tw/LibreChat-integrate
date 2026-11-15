import { Button } from '@librechat/client';
import { Eye, Globe, Database, ChartGantt } from 'lucide-react';
import type { AuditColumn, AuditRow, CellFormat } from './helpers';
import type { ResponsePair } from './ResponseDialog';
import { cellText, commentLines } from './helpers';
import { useLocalize } from '~/hooks';

/** One message cell, shared by the feedback table and an expanded conversation. */
export default function AuditCell({
  row,
  column,
  format,
  onViewResponse,
  onViewTrace,
}: {
  row: AuditRow;
  column: AuditColumn;
  format: CellFormat;
  onViewResponse: (pair: ResponsePair) => void;
  onViewTrace?: (messageId: string) => void;
}) {
  const localize = useLocalize();

  if (column.kind === 'response') {
    const viewResponse = (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() =>
          onViewResponse({
            messageId: row.message_id,
            query: row.user_query,
            response: row.model_response,
          })
        }
        aria-label={localize('com_ui_tars_audit_view_response')}
        title={localize('com_ui_tars_audit_view_response')}
      >
        <Eye className="text-accent-primary size-4" aria-hidden />
      </Button>
    );
    if (!onViewTrace) {
      return viewResponse;
    }
    return (
      <div className="flex gap-1">
        {viewResponse}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onViewTrace(row.message_id)}
          aria-label={localize('com_ui_tars_audit_trace_view_button')}
          title={localize('com_ui_tars_audit_trace_view_button')}
        >
          <ChartGantt className="text-text-secondary size-4" aria-hidden />
        </Button>
      </div>
    );
  }

  if (column.kind === 'boolean') {
    const on = row[column.field as 'is_web_search' | 'is_sql_agent'] === true;
    if (!on) {
      return <span className="text-text-secondary">—</span>;
    }
    const Icon = column.field === 'is_web_search' ? Globe : Database;
    return <Icon className="text-accent-primary size-4" aria-label={localize(column.labelKey)} />;
  }

  if (column.kind === 'comments') {
    const lines = commentLines(row.comments);
    if (lines.length === 0) {
      return null;
    }
    return (
      <ul className="w-[18rem] list-disc space-y-0.5 pl-4">
        {lines.map((line, index) => (
          <li key={index} className="break-words whitespace-normal">
            {line}
          </li>
        ))}
      </ul>
    );
  }

  const text = cellText(row, column, format);
  if (column.kind === 'number') {
    return <span className="tabular-nums">{text}</span>;
  }
  return (
    <span className="block max-w-[22rem] truncate" title={text === '' ? undefined : text}>
      {text}
    </span>
  );
}
