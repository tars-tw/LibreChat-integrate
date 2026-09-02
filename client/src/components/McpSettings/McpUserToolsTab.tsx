import { useState } from 'react';
import { ChevronDown, ChevronRight, KeyRound } from 'lucide-react';
import { Switch, Spinner, Checkbox, chipVariants, useToastContext } from '@librechat/client';
import type { TTarsMcpUserServer, TTarsMcpUserTool } from 'librechat-data-provider';
import { useTarsMcpUserSettingsQuery, useUpdateTarsMcpUserServerMutation } from '~/data-provider';
import McpCredentialsForm from '~/components/Tars/McpCredentialsForm';
import { useLocalize } from '~/hooks';

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

function describeParams(tool: TTarsMcpUserTool): ToolParam[] {
  const schema = tool.input_schema;
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  const properties = (schema.properties ?? {}) as Record<
    string,
    { type?: string; description?: string }
  >;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: prop?.type ?? 'string',
    required: required.has(name),
    description: prop?.description,
  }));
}

const EXPANDABLE_THRESHOLD = 120;

/** Long pwc_tars descriptions collapse to two lines with a show-more toggle. */
function ExpandableText({ text }: { text: string }) {
  const localize = useLocalize();
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > EXPANDABLE_THRESHOLD;

  return (
    <div>
      <p
        className={`whitespace-pre-line text-xs text-text-secondary ${
          isLong && !expanded ? 'line-clamp-2' : ''
        }`}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          className="mt-0.5 text-xs font-medium text-text-secondary underline hover:text-text-primary"
        >
          {expanded ? localize('com_ui_show_less') : localize('com_ui_show_more')}
        </button>
      )}
    </div>
  );
}

function ServerCard({ server }: { server: TTarsMcpUserServer }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [expanded, setExpanded] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);

  const updateMutation = useUpdateTarsMcpUserServerMutation({
    onError: (error) =>
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' }),
  });

  const toggleServer = (enabled: boolean) =>
    updateMutation.mutate({ id: server.id, data: { is_enabled: enabled } });

  const toggleTool = (toolName: string, enabled: boolean) => {
    const toolConfig: Record<string, boolean> = {};
    for (const tool of server.tools) {
      toolConfig[tool.name] = tool.name === toolName ? enabled : tool.user_enabled;
    }
    updateMutation.mutate({ id: server.id, data: { tool_config: toolConfig } });
  };

  const needsCredentials = server.requires_user_credentials && !server.has_credentials;

  return (
    <div className="rounded-lg border border-border-light">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={server.name}
          className="text-text-secondary hover:text-text-primary"
        >
          {expanded ? <ChevronDown className="icon-sm" /> : <ChevronRight className="icon-sm" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-text-primary">{server.name}</span>
            <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
              {server.type}
            </span>
            <span className="text-xs text-text-secondary">
              {localize('com_ui_tars_mcp_tools_count')}: {server.tools.length}
            </span>
          </div>
        </div>
        {server.requires_user_credentials && (
          <button
            type="button"
            onClick={() => setShowCredentials((prev) => !prev)}
            className={chipVariants({ tone: needsCredentials ? 'warning' : 'success' })}
          >
            <KeyRound className="h-3 w-3" aria-hidden="true" />
            {needsCredentials
              ? localize('com_ui_tars_mcp_creds_needed')
              : localize('com_ui_tars_mcp_creds_set')}
          </button>
        )}
        <Switch
          checked={server.user_enabled}
          onCheckedChange={toggleServer}
          aria-label={`${server.name} ${localize('com_ui_active')}`}
          disabled={updateMutation.isLoading}
        />
      </div>

      {server.description != null && server.description !== '' && (
        <div className="px-3 pb-2 pl-10">
          <ExpandableText text={server.description} />
        </div>
      )}

      {showCredentials && server.requires_user_credentials && (
        <div className="px-3 pb-3">
          <McpCredentialsForm server={server} />
        </div>
      )}

      {expanded && (
        <ul className="space-y-1 border-t border-border-light p-3">
          {server.tools.map((tool) => {
            const params = describeParams(tool);
            return (
              <li
                key={tool.id}
                className="flex items-start gap-2 rounded p-1.5 hover:bg-surface-hover"
              >
                <Checkbox
                  checked={tool.user_enabled}
                  onCheckedChange={(checked) => toggleTool(tool.name, checked === true)}
                  aria-label={tool.name}
                  disabled={updateMutation.isLoading}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-sm text-text-primary">{tool.name}</span>
                  {tool.description != null && tool.description !== '' && (
                    <ExpandableText text={tool.description} />
                  )}
                  {params.length > 0 && (
                    <p className="truncate text-xs text-text-secondary">
                      {localize('com_ui_tars_mcp_params')}:{' '}
                      {params
                        .map((param) => `${param.name}${param.required ? '*' : ''} (${param.type})`)
                        .join(', ')}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
          {server.tools.length === 0 && (
            <li className="text-xs text-text-secondary">{localize('com_ui_tars_mcp_no_tools')}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The signed-in user's own pwc_tars tool catalog: per-server and per-tool
 * toggles plus credential entry. Every pwc_tars account sees this tab; the
 * management tabs beside it are admin-only.
 */
export default function McpUserToolsTab() {
  const localize = useLocalize();
  const { data: servers = [], isLoading } = useTarsMcpUserSettingsQuery({ refetchOnMount: true });

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}
      {!isLoading && servers.length === 0 && (
        <p className="py-12 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_mcp_no_servers')}
        </p>
      )}
      {servers.map((server) => (
        <ServerCard key={server.id} server={server} />
      ))}
    </div>
  );
}
