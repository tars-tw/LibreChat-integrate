import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Label } from '@librechat/client';
import type { HeaderRow } from './boundValues';
import SystemVariablesHint from './SystemVariablesHint';
import { mcpActionClass } from './actions';
import { useLocalize } from '~/hooks';

/**
 * Static headers an OpenAPI / custom API server sends with every call
 * (`connection_config.headers`). A value may use `{{TARS_*}}` system variables,
 * which pwc_tars resolves to the calling user at execution time.
 */
export default function McpStaticHeaders({
  value,
  onChange,
}: {
  value: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
}) {
  const localize = useLocalize();
  const update = (index: number, key: keyof HeaderRow, text: string) =>
    onChange(value.map((row, i) => (i === index ? { ...row, [key]: text } : row)));

  return (
    <div className="border-border-light space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <Label>{localize('com_ui_tars_mcp_static_headers')}</Label>
        <Button variant="outline" onClick={() => onChange([...value, { name: '', value: '' }])}>
          <Plus className="icon-sm mr-1" />
          {localize('com_ui_tars_mcp_static_header_add')}
        </Button>
      </div>
      <SystemVariablesHint hint={localize('com_ui_tars_mcp_static_headers_hint')} />
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1.5fr_2rem] items-center gap-2">
              <Input
                aria-label={localize('com_ui_name')}
                value={row.name}
                onChange={(event) => update(index, 'name', event.target.value)}
                placeholder="X-User-Email"
              />
              <Input
                aria-label={localize('com_ui_tars_mcp_header_value')}
                value={row.value}
                onChange={(event) => update(index, 'value', event.target.value)}
                placeholder="{{TARS_CURRENT_USER_EMAIL}}"
              />
              <button
                type="button"
                title={localize('com_ui_tars_mcp_static_header_remove')}
                aria-label={localize('com_ui_tars_mcp_static_header_remove')}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className={mcpActionClass('danger')}
              >
                <Trash2 className="icon-sm" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
