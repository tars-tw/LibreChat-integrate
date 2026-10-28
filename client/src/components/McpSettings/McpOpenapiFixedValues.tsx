import { useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button, Dropdown, Input, Label, Spinner } from '@librechat/client';
import type { TTarsMcpParsedTool } from 'librechat-data-provider';
import SystemVariablesHint from './SystemVariablesHint';
import { mcpActionClass } from './actions';
import { useLocalize } from '~/hooks';
import {
  endpointOf,
  boundValueOf,
  setBoundValue,
  isStaleBinding,
  type BoundValues,
} from './boundValues';

const FIELD_ROW = 'grid grid-cols-[1fr_4.5rem_4.5rem_3rem_1.5fr_1.5fr] items-center gap-2';
const BOUND_ROW = 'grid grid-cols-[1.5fr_4.5rem_1fr_1.5fr_2rem] items-center gap-2';

/**
 * Per-tool fixed values for an OpenAPI server (`tool_config.bound_values`).
 * The admin loads the tools from the spec, picks one and fixes any of its
 * fields; pwc_tars then fills those fields itself and hides them from the AI.
 */
export default function McpOpenapiFixedValues({
  tools,
  loading,
  onLoadTools,
  value,
  onChange,
}: {
  tools: TTarsMcpParsedTool[];
  loading: boolean;
  onLoadTools: () => void;
  value: BoundValues;
  onChange: (bound: BoundValues) => void;
}) {
  const localize = useLocalize();
  const [selectedName, setSelectedName] = useState<string | null>(null);

  /** Keeps the selection valid as the loaded list changes. */
  useEffect(() => {
    if (tools.length === 0) {
      setSelectedName(null);
      return;
    }
    setSelectedName((prev) =>
      tools.some((tool) => tool.name === prev) ? prev : (tools[0]?.name ?? null),
    );
  }, [tools]);

  const selected = tools.find((tool) => tool.name === selectedName);
  const selectedEndpoint = selected ? endpointOf(selected) : '';
  const toolAt = (endpoint: string) => tools.find((tool) => endpointOf(tool) === endpoint);
  const configured = Object.entries(value).flatMap(([endpoint, bindings]) =>
    bindings.map((binding) => ({ endpoint, binding })),
  );

  return (
    <div className="space-y-4">
      <SystemVariablesHint hint={localize('com_ui_tars_mcp_fixed_value_hint')} />

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onLoadTools} disabled={loading} className="shrink-0">
          {loading ? <Spinner className="icon-sm mr-1" /> : <RefreshCw className="icon-sm mr-1" />}
          {localize('com_ui_tars_mcp_load_openapi_tools')}
        </Button>
        {tools.length > 0 && (
          <Dropdown
            value={selectedName ?? ''}
            onChange={setSelectedName}
            ariaLabel={localize('com_ui_tars_mcp_select_tool')}
            options={tools.map((tool) => ({
              value: tool.name ?? '',
              label: `${tool.name ?? ''} (${endpointOf(tool)})`,
            }))}
            sizeClasses="w-full"
            className="min-w-0 flex-1"
          />
        )}
      </div>
      {tools.length === 0 && (
        <p className="text-text-secondary text-xs">
          {localize('com_ui_tars_mcp_openapi_load_tools_hint')}
        </p>
      )}

      {selected != null &&
        ((selected.fields ?? []).length === 0 ? (
          <p className="text-text-secondary text-xs">
            {localize('com_ui_tars_mcp_tool_no_fields')}
          </p>
        ) : (
          <div className="space-y-2">
            <div className={`${FIELD_ROW} text-text-secondary text-xs font-medium`}>
              <span>{localize('com_ui_name')}</span>
              <span>{localize('com_ui_tars_mcp_param_location')}</span>
              <span>{localize('com_ui_tars_mcp_param_type')}</span>
              <span>{localize('com_ui_tars_mcp_param_required')}</span>
              <span>{localize('com_ui_description')}</span>
              <span>{localize('com_ui_tars_mcp_fixed_value')}</span>
            </div>
            {(selected.fields ?? []).map((field) => (
              <div key={`${field.in}:${field.name}`} className={`${FIELD_ROW} text-xs`}>
                <code className="text-text-primary truncate" title={field.name}>
                  {field.name}
                </code>
                <span className="bg-surface-tertiary text-text-secondary w-fit rounded px-1.5 py-0.5">
                  {field.in}
                </span>
                <span className="text-text-secondary truncate">{field.type ?? ''}</span>
                <span className="text-text-secondary text-center">{field.required ? '✓' : ''}</span>
                <span className="text-text-secondary truncate" title={field.description ?? ''}>
                  {field.description ?? ''}
                </span>
                <Input
                  aria-label={`${localize('com_ui_tars_mcp_fixed_value')}: ${field.name}`}
                  value={boundValueOf(value, selectedEndpoint, field)}
                  placeholder={localize('com_ui_tars_mcp_fixed_value_placeholder')}
                  onChange={(event) =>
                    onChange(setBoundValue(value, selectedEndpoint, field, event.target.value))
                  }
                />
              </div>
            ))}
          </div>
        ))}

      <div className="border-border-light space-y-2 rounded-lg border p-3">
        <Label>{localize('com_ui_tars_mcp_configured_fixed_values')}</Label>
        {configured.length === 0 ? (
          <p className="text-text-secondary text-xs">
            {localize('com_ui_tars_mcp_no_fixed_values')}
          </p>
        ) : (
          <div className="space-y-2">
            <div className={`${BOUND_ROW} text-text-secondary text-xs font-medium`}>
              <span>{localize('com_ui_tars_mcp_endpoint')}</span>
              <span>{localize('com_ui_tars_mcp_param_location')}</span>
              <span>{localize('com_ui_name')}</span>
              <span>{localize('com_ui_tars_mcp_fixed_value')}</span>
              <span />
            </div>
            {configured.map(({ endpoint, binding }) => {
              const tool = toolAt(endpoint);
              const stale = isStaleBinding(tools, endpoint, binding);
              return (
                <div
                  key={`${endpoint}:${binding.in}:${binding.name}`}
                  className={`${BOUND_ROW} text-xs`}
                >
                  <span className="min-w-0">
                    <code className="text-text-primary">{endpoint}</code>
                    {tool != null && (
                      <span className="text-text-secondary ml-1 truncate">{tool.name}</span>
                    )}
                    {stale && (
                      <span className="text-text-destructive ml-1">
                        {localize('com_ui_tars_mcp_fixed_value_stale')}
                      </span>
                    )}
                  </span>
                  <span className="bg-surface-tertiary text-text-secondary w-fit rounded px-1.5 py-0.5">
                    {binding.in}
                  </span>
                  <code className="text-text-primary truncate" title={binding.name}>
                    {binding.name}
                  </code>
                  <code className="text-text-primary truncate" title={binding.value}>
                    {binding.value}
                  </code>
                  <button
                    type="button"
                    title={localize('com_ui_tars_mcp_fixed_value_remove')}
                    aria-label={`${localize('com_ui_tars_mcp_fixed_value_remove')}: ${endpoint} ${binding.name}`}
                    onClick={() => onChange(setBoundValue(value, endpoint, binding, ''))}
                    className={mcpActionClass('danger')}
                  >
                    <Trash2 className="icon-sm" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-text-secondary text-xs">
          {localize('com_ui_tars_mcp_openapi_fixed_values_sync_hint')}
        </p>
      </div>
    </div>
  );
}
