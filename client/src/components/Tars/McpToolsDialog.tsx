import { useState } from 'react';
import { ChevronDown, ChevronRight, KeyRound } from 'lucide-react';
import {
  Label,
  Input,
  Button,
  Switch,
  Spinner,
  Checkbox,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsMcpUserServer, TTarsMcpUserTool } from 'librechat-data-provider';
import {
  useTarsMcpUserSettingsQuery,
  useUpdateTarsMcpUserServerMutation,
  useSaveTarsMcpUserCredentialsMutation,
  useClearTarsMcpUserCredentialsMutation,
} from '~/data-provider';
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

function CredentialsForm({ server }: { server: TTarsMcpUserServer }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isToken = server.auth_type === 'bearer' || server.auth_type === 'api_key';
  const fieldNames = (() => {
    if (isToken) {
      return ['value'];
    }
    if (server.auth_type === 'basic') {
      return ['username', 'password'];
    }
    return server.login_fields.length > 0 ? server.login_fields : ['username', 'password'];
  })();
  const [values, setValues] = useState<Record<string, string>>({});

  const saveMutation = useSaveTarsMcpUserCredentialsMutation({
    onSuccess: () => {
      setValues({});
      showToast({ message: localize('com_ui_tars_mcp_creds_saved'), status: 'success' });
    },
    onError: (error) =>
      showToast({
        message: (error as Error)?.message || localize('com_ui_tars_mcp_creds_failed'),
        status: 'error',
      }),
  });
  const clearMutation = useClearTarsMcpUserCredentialsMutation({
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_mcp_creds_cleared'), status: 'success' }),
    onError: (error) =>
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' }),
  });

  const handleSave = () => {
    const missing = fieldNames.some((name) => !values[name]?.trim());
    if (missing) {
      showToast({ message: localize('com_ui_tars_mcp_creds_required'), status: 'error' });
      return;
    }
    saveMutation.mutate({ id: server.id, credentials: values });
  };

  const isSecretField = (name: string) => name === 'value' || /password|secret|token/i.test(name);

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-surface-secondary p-3">
      <div className="grid grid-cols-2 gap-2">
        {fieldNames.map((name) => (
          <div key={name} className={fieldNames.length === 1 ? 'col-span-2' : ''}>
            <Label className="text-xs">
              {name === 'value' ? localize('com_ui_tars_mcp_creds_token') : name}
            </Label>
            <Input
              type={isSecretField(name) ? 'password' : 'text'}
              value={values[name] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        {server.has_credentials && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => clearMutation.mutate(server.id)}
            disabled={clearMutation.isLoading}
          >
            {clearMutation.isLoading ? <Spinner /> : localize('com_ui_tars_mcp_creds_clear')}
          </Button>
        )}
        <Button size="sm" onClick={handleSave} disabled={saveMutation.isLoading}>
          {saveMutation.isLoading
            ? localize('com_ui_tars_mcp_creds_verifying')
            : localize('com_ui_tars_mcp_creds_save')}
        </Button>
      </div>
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
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              needsCredentials
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'
                : 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
            }`}
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
          <CredentialsForm server={server} />
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

export default function McpToolsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { data: servers = [], isLoading } = useTarsMcpUserSettingsQuery({ enabled: open });

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_mcp_my_tools')}
        showCloseButton={true}
        showCancelButton={false}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_mcp_my_tools_hint')}
            </p>
            {isLoading && (
              <div className="flex h-32 items-center justify-center">
                <Spinner />
              </div>
            )}
            {!isLoading && servers.length === 0 && (
              <p className="py-8 text-center text-sm text-text-secondary">
                {localize('com_ui_tars_mcp_no_servers')}
              </p>
            )}
            {servers.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
        }
      />
    </OGDialog>
  );
}
