import { useState } from 'react';
import { Plus, Code, Pencil, Trash2 } from 'lucide-react';
import { Label, Button, useToastContext, OGDialog, OGDialogTemplate } from '@librechat/client';
import McpToolEditorModal, {
  toToolDraft,
  emptyToolDraft,
  validateToolDraft,
  toolDraftToStored,
} from './McpToolEditorModal';
import { useLocalize } from '~/hooks';

const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

function paramsCount(tool: Record<string, unknown>): number {
  const params = Array.isArray(tool.parameters) ? tool.parameters.length : 0;
  const body = asRecord(tool.request_body);
  const bodyProps = Array.isArray(body.properties) ? body.properties.length : 0;
  return params + bodyProps;
}

/**
 * Structured editor for `connection_config.tools[]` (custom_api servers), replacing a raw
 * JSON textarea with a list + per-tool form. `value`/`onChange` operate on the same wire
 * shape the backend stores (`toolToDraft`/`toolDraftToStored` convert at the edges).
 */
export default function McpCustomApiTools({
  value,
  onChange,
}: {
  value: Record<string, unknown>[];
  onChange: (tools: Record<string, unknown>[]) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [editingIndex, setEditingIndex] = useState<number | null | 'new'>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const otherNames = (excludeIndex: number | null) =>
    new Set(
      value.filter((_, i) => i !== excludeIndex).map((tool) => String(asRecord(tool).name ?? '')),
    );

  const handleSaveTool = (draft: ReturnType<typeof toToolDraft>) => {
    const stored = toolDraftToStored(draft);
    if (editingIndex === 'new') {
      onChange([...value, stored]);
    } else if (typeof editingIndex === 'number') {
      onChange(value.map((tool, i) => (i === editingIndex ? stored : tool)));
    }
    setEditingIndex(null);
  };

  const handleImport = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      showToast({ message: localize('com_ui_tars_mcp_invalid_json'), status: 'error' });
      return;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (items.length === 0) {
      showToast({ message: localize('com_ui_tars_mcp_tool_import_empty'), status: 'error' });
      return;
    }
    const seenNames = otherNames(null);
    const imported: Record<string, unknown>[] = [];
    for (const item of items) {
      const draft = toToolDraft(item);
      const validationError = validateToolDraft(draft, seenNames);
      if (validationError) {
        showToast({
          message: `${localize('com_ui_tars_mcp_tool_import_failed')}: ${localize(validationError)}`,
          status: 'error',
        });
        return;
      }
      seenNames.add(draft.name.trim());
      imported.push(toolDraftToStored(draft));
    }
    onChange([...value, ...imported]);
    setImportOpen(false);
    setImportText('');
    showToast({
      message: localize('com_ui_tars_mcp_tool_import_success', { count: imported.length }),
      status: 'success',
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">{localize('com_ui_tars_mcp_tools_json_hint')}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Code className="icon-sm mr-1" />
            {localize('com_ui_tars_mcp_tool_import')}
          </Button>
          <Button variant="outline" onClick={() => setEditingIndex('new')}>
            <Plus className="icon-sm mr-1" />
            {localize('com_ui_tars_mcp_tool_add')}
          </Button>
        </div>
      </div>

      {value.length === 0 ? (
        <p className="rounded-lg border border-border-light py-8 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_mcp_tool_empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-light">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-surface-secondary text-left text-text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">{localize('com_ui_name')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_mcp_tool_method')}</th>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_mcp_tool_path')}</th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_ui_tars_mcp_tool_params_count')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {value.map((tool, index) => {
                const record = asRecord(tool);
                return (
                  <tr key={index} className="border-t border-border-light hover:bg-surface-hover">
                    <td className="px-3 py-2 font-mono text-xs text-text-primary">
                      {String(record.name ?? '')}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
                        {String(record.method ?? 'GET')}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                      {String(record.path ?? '')}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{paramsCount(record)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          aria-label={localize('com_ui_edit')}
                          title={localize('com_ui_edit')}
                          onClick={() => setEditingIndex(index)}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                        >
                          <Pencil className="icon-sm" />
                        </button>
                        <button
                          type="button"
                          aria-label={localize('com_ui_delete')}
                          title={localize('com_ui_delete')}
                          onClick={() => onChange(value.filter((_, i) => i !== index))}
                          className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                        >
                          <Trash2 className="icon-sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingIndex != null && (
        <McpToolEditorModal
          isEdit={editingIndex !== 'new'}
          draft={editingIndex === 'new' ? emptyToolDraft() : toToolDraft(value[editingIndex])}
          otherNames={otherNames(editingIndex === 'new' ? null : editingIndex)}
          onSave={handleSaveTool}
          onOpenChange={(open) => !open && setEditingIndex(null)}
        />
      )}

      {importOpen && (
        <OGDialog open={true} onOpenChange={(open) => !open && setImportOpen(false)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_mcp_tool_import')}
            showCloseButton={true}
            className="w-11/12 md:max-w-xl"
            main={
              <div className="space-y-2">
                <Label htmlFor="tars-mcp-tool-import">
                  {localize('com_ui_tars_mcp_tools_json_hint')}
                </Label>
                <textarea
                  id="tars-mcp-tool-import"
                  rows={12}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 font-mono text-xs text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
                  placeholder={
                    '[\n  {\n    "name": "create_issue",\n    "description": "...",\n    "method": "POST",\n    "path": "/issues",\n    "parameters": [],\n    "request_body": { "content_type": "application/json", "properties": [] }\n  }\n]'
                  }
                />
              </div>
            }
            buttons={
              <Button variant="submit" onClick={handleImport}>
                {localize('com_ui_tars_mcp_tool_import')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
