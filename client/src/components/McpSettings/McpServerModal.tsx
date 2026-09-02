import { useState, useEffect } from 'react';
import {
  Tabs,
  Label,
  Input,
  Button,
  Switch,
  Spinner,
  Dropdown,
  TabsList,
  OGDialog,
  TabsTrigger,
  TabsContent,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type {
  TTarsMcpServer,
  TTarsMcpServerInput,
  TTarsMcpParsedSpec,
} from 'librechat-data-provider';
import {
  useSyncTarsMcpServerMutation,
  useCreateTarsMcpServerMutation,
  useUpdateTarsMcpServerMutation,
  useParseTarsMcpOpenapiMutation,
} from '~/data-provider';
import McpCustomApiTools from './McpCustomApiTools';
import { useLocalize } from '~/hooks';

type AuthType = 'none' | 'bearer' | 'api_key' | 'basic' | 'login';

interface AuthForm {
  type: AuthType;
  value: string;
  name: string;
  location: 'header' | 'query';
  username: string;
  password: string;
  tokenUrl: string;
  tokenField: string;
  credentialsJson: string;
}

type ServerType = 'openapi' | 'custom_api' | 'external';
type ExternalTransport = 'streamable_http' | 'stdio';
type FormTab = 'basic' | 'connection' | 'tools' | 'env';

interface ServerForm {
  name: string;
  code: string;
  description: string;
  type: ServerType;
  enabled: boolean;
  priority: string;
  tags: string;
  openapiUrl: string;
  baseUrl: string;
  timeout: string;
  tools: Record<string, unknown>[];
  transport: ExternalTransport;
  externalUrl: string;
  headersJson: string;
  command: string;
  argsText: string;
  envVarsJson: string;
  auth: AuthForm;
}

const DEFAULT_AUTH: AuthForm = {
  type: 'none',
  value: '',
  name: '',
  location: 'header',
  username: '',
  password: '',
  tokenUrl: '',
  tokenField: 'access_token',
  credentialsJson: '{\n  "email": "",\n  "password": ""\n}',
};

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const TAB_PANEL = 'mt-4 p-0';
/** The shared trigger only shifts the background when active, which reads as barely selected. */
const TAB_TRIGGER = 'data-[state=active]:text-brand-primary';

const textareaClass =
  'w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 font-mono text-xs text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy';

function parseAuthForm(config: Record<string, unknown> | null | undefined): AuthForm {
  const auth = (config?.auth ?? {}) as Record<string, unknown>;
  const type = (auth.type as AuthType) || 'none';
  return {
    ...DEFAULT_AUTH,
    type,
    value: String(auth.value ?? ''),
    name: String(auth.name ?? ''),
    location: auth.in === 'query' ? 'query' : 'header',
    username: String(auth.username ?? ''),
    password: String(auth.password ?? ''),
    tokenUrl: String(auth.token_url ?? ''),
    tokenField: String(auth.token_field ?? 'access_token'),
    credentialsJson: auth.credentials
      ? JSON.stringify(auth.credentials, null, 2)
      : DEFAULT_AUTH.credentialsJson,
  };
}

function buildAuth(form: AuthForm): Record<string, unknown> | undefined {
  if (form.type === 'none') {
    return undefined;
  }
  if (form.type === 'bearer') {
    return { type: 'bearer', value: form.value };
  }
  if (form.type === 'api_key') {
    return { type: 'api_key', name: form.name, value: form.value, in: form.location };
  }
  if (form.type === 'basic') {
    return { type: 'basic', username: form.username, password: form.password };
  }
  return {
    type: 'login',
    token_url: form.tokenUrl,
    token_field: form.tokenField || 'access_token',
    credentials: JSON.parse(form.credentialsJson || '{}') as Record<string, unknown>,
  };
}

function toServerType(type?: string): ServerType {
  if (type === 'custom_api' || type === 'external') {
    return type;
  }
  return 'openapi';
}

function toForm(server?: TTarsMcpServer): ServerForm {
  const config = server?.connection_config ?? {};
  return {
    name: server?.name ?? '',
    code: server?.code ?? '',
    description: server?.description ?? '',
    type: toServerType(server?.type),
    enabled: server?.is_enabled ?? true,
    priority: server?.priority != null ? String(server.priority) : '',
    tags: (server?.tags ?? []).join(', '),
    openapiUrl: String(config.openapi_url ?? ''),
    baseUrl: String(config.base_url ?? ''),
    timeout: String(config.timeout ?? 30),
    tools: Array.isArray(config.tools) ? (config.tools as Record<string, unknown>[]) : [],
    transport: config.transport === 'streamable_http' ? 'streamable_http' : 'stdio',
    externalUrl: String(config.url ?? ''),
    headersJson: config.headers ? JSON.stringify(config.headers, null, 2) : '{}',
    command: String(config.command ?? ''),
    argsText: Array.isArray(config.args) ? (config.args as string[]).join('\n') : '',
    /** pwc_tars never returns stored `env_vars` (secret hygiene); an empty object means "keep unchanged". */
    envVarsJson: '{}',
    auth: parseAuthForm(config as Record<string, unknown>),
  };
}

export default function McpServerModal({
  server,
  open,
  onOpenChange,
}: {
  server?: TTarsMcpServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = server != null;
  const [form, setForm] = useState<ServerForm>(() => toForm(server));
  const [parsed, setParsed] = useState<TTarsMcpParsedSpec | null>(null);
  const [formTab, setFormTab] = useState<FormTab>('basic');

  const syncMutation = useSyncTarsMcpServerMutation();
  const parseMutation = useParseTarsMcpOpenapiMutation();
  const createMutation = useCreateTarsMcpServerMutation();
  const updateMutation = useUpdateTarsMcpServerMutation();
  const isSaving = createMutation.isLoading || updateMutation.isLoading || syncMutation.isLoading;

  const showToolsTab = form.type === 'custom_api';
  const showEnvTab = form.type === 'external' && form.transport === 'stdio';

  /** Keeps the active tab valid as the type/transport choice removes tabs from the list. */
  useEffect(() => {
    if (formTab === 'tools' && !showToolsTab) {
      setFormTab('basic');
    }
    if (formTab === 'env' && !showEnvTab) {
      setFormTab('basic');
    }
  }, [formTab, showToolsTab, showEnvTab]);

  const set = <K extends keyof ServerForm>(key: K, value: ServerForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const setAuth = <K extends keyof AuthForm>(key: K, value: AuthForm[K]) =>
    setForm((prev) => ({ ...prev, auth: { ...prev.auth, [key]: value } }));

  const handleParse = async () => {
    if (!form.openapiUrl.trim()) {
      showToast({ message: localize('com_ui_tars_mcp_openapi_url_required'), status: 'error' });
      return;
    }
    try {
      const { parsed: result } = await parseMutation.mutateAsync({
        openapi_url: form.openapiUrl.trim(),
        base_url: form.baseUrl.trim() || undefined,
      });
      setParsed(result);
      if (result.base_url && !form.baseUrl.trim()) {
        set('baseUrl', result.base_url);
      }
    } catch (error) {
      showToast({
        message: `${localize('com_ui_tars_mcp_parse_failed')}: ${(error as Error)?.message ?? ''}`,
        status: 'error',
      });
    }
  };

  const buildInput = (): TTarsMcpServerInput | null => {
    if (!form.name.trim()) {
      showToast({ message: localize('com_ui_tars_mcp_name_required'), status: 'error' });
      return null;
    }
    let auth: Record<string, unknown> | undefined;
    try {
      auth = buildAuth(form.auth);
    } catch {
      showToast({ message: localize('com_ui_tars_mcp_invalid_json'), status: 'error' });
      return null;
    }

    const connection: Record<string, unknown> = { ...(auth ? { auth } : {}) };
    let envVars: Record<string, string> | undefined;
    if (form.type === 'openapi') {
      if (!form.openapiUrl.trim()) {
        showToast({ message: localize('com_ui_tars_mcp_openapi_url_required'), status: 'error' });
        return null;
      }
      connection.openapi_url = form.openapiUrl.trim();
      if (form.baseUrl.trim()) {
        connection.base_url = form.baseUrl.trim();
      }
      const timeout = Number(form.timeout);
      connection.timeout = Number.isFinite(timeout) && timeout > 0 ? timeout : 30;
    } else if (form.type === 'custom_api') {
      if (!form.baseUrl.trim()) {
        showToast({ message: localize('com_ui_tars_mcp_base_url_required'), status: 'error' });
        return null;
      }
      if (form.tools.length === 0) {
        showToast({ message: localize('com_ui_tars_mcp_tools_required'), status: 'error' });
        return null;
      }
      connection.base_url = form.baseUrl.trim();
      connection.tools = form.tools;
    } else {
      connection.transport = form.transport;
      if (form.transport === 'streamable_http') {
        if (!form.externalUrl.trim()) {
          showToast({ message: localize('com_ui_tars_mcp_url_required'), status: 'error' });
          return null;
        }
        connection.url = form.externalUrl.trim();
        try {
          const headers = JSON.parse(form.headersJson || '{}') as Record<string, unknown>;
          if (Object.keys(headers).length > 0) {
            connection.headers = headers;
          }
        } catch {
          showToast({ message: localize('com_ui_tars_mcp_invalid_json'), status: 'error' });
          return null;
        }
      } else {
        if (!form.command.trim()) {
          showToast({ message: localize('com_ui_tars_mcp_command_required'), status: 'error' });
          return null;
        }
        delete connection.auth;
        connection.command = form.command.trim();
        const args = form.argsText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (args.length > 0) {
          connection.args = args;
        }
        try {
          const parsedEnv = JSON.parse(form.envVarsJson || '{}') as Record<string, string>;
          if (Object.keys(parsedEnv).length > 0) {
            envVars = parsedEnv;
          }
        } catch {
          showToast({ message: localize('com_ui_tars_mcp_invalid_json'), status: 'error' });
          return null;
        }
      }
    }

    const priority = Number(form.priority);
    const tags = form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    return {
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      description: form.description.trim() || undefined,
      type: form.type,
      is_enabled: form.enabled,
      ...(form.priority.trim() !== '' && Number.isFinite(priority) ? { priority } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(envVars ? { env_vars: envVars } : {}),
      connection_config: connection,
    };
  };

  const handleSave = async () => {
    const input = buildInput();
    if (!input) {
      return;
    }
    try {
      const { server: saved } = isEdit
        ? await updateMutation.mutateAsync({ id: server.id, data: input })
        : await createMutation.mutateAsync(input);
      if (saved?.id) {
        try {
          const { result } = await syncMutation.mutateAsync(saved.id);
          showToast({
            message: localize('com_ui_tars_mcp_saved_synced', {
              created: result?.created ?? 0,
              updated: result?.updated ?? 0,
              deleted: result?.deleted ?? 0,
            }),
            status: 'success',
          });
        } catch {
          showToast({ message: localize('com_ui_tars_mcp_saved_sync_failed'), status: 'warning' });
        }
      }
      onOpenChange(false);
    } catch (error) {
      showToast({ message: (error as Error)?.message ?? 'Error', status: 'error' });
    }
  };

  /** pwc_tars only injects bearer / api_key headers for external servers; stdio has no auth at all. */
  const isExternal = form.type === 'external';
  const authFields = (
    <div className="space-y-3 rounded-lg border border-border-light p-3">
      <div className="flex items-center justify-between">
        <Label>{localize('com_ui_tars_mcp_auth')}</Label>
        <Dropdown
          value={form.auth.type}
          onChange={(value) => setAuth('type', value as AuthType)}
          ariaLabel={localize('com_ui_tars_mcp_auth')}
          options={[
            { value: 'none', label: localize('com_ui_tars_mcp_auth_none') },
            { value: 'bearer', label: localize('com_ui_tars_mcp_auth_bearer') },
            { value: 'api_key', label: localize('com_ui_tars_mcp_auth_api_key') },
            ...(isExternal
              ? []
              : [
                  { value: 'basic', label: localize('com_ui_tars_mcp_auth_basic') },
                  { value: 'login', label: localize('com_ui_tars_mcp_auth_login') },
                ]),
          ]}
        />
      </div>
      {(form.auth.type === 'bearer' || form.auth.type === 'api_key') && (
        <div className="grid grid-cols-2 gap-3">
          {form.auth.type === 'api_key' && (
            <>
              <div>
                <Label>{localize('com_ui_tars_mcp_auth_key_name')}</Label>
                <Input
                  value={form.auth.name}
                  onChange={(e) => setAuth('name', e.target.value)}
                  placeholder="X-API-Key"
                />
              </div>
              <div>
                <Label>{localize('com_ui_tars_mcp_auth_location')}</Label>
                <Dropdown
                  value={form.auth.location}
                  onChange={(value) => setAuth('location', value as 'header' | 'query')}
                  ariaLabel={localize('com_ui_tars_mcp_auth_location')}
                  options={[
                    { value: 'header', label: localize('com_ui_tars_mcp_auth_in_header') },
                    ...(isExternal
                      ? []
                      : [{ value: 'query', label: localize('com_ui_tars_mcp_auth_in_query') }]),
                  ]}
                  sizeClasses="w-full"
                  className="w-full"
                />
              </div>
            </>
          )}
          <div className={form.auth.type === 'bearer' ? 'col-span-2' : 'col-span-2'}>
            <Label>{localize('com_ui_tars_mcp_auth_value')}</Label>
            <Input
              type="password"
              value={form.auth.value}
              onChange={(e) => setAuth('value', e.target.value)}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {localize('com_ui_tars_mcp_auth_shared_hint')}
            </p>
          </div>
        </div>
      )}
      {form.auth.type === 'basic' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{localize('com_ui_tars_mcp_auth_username')}</Label>
            <Input
              value={form.auth.username}
              onChange={(e) => setAuth('username', e.target.value)}
            />
          </div>
          <div>
            <Label>{localize('com_ui_tars_mcp_auth_password')}</Label>
            <Input
              type="password"
              value={form.auth.password}
              onChange={(e) => setAuth('password', e.target.value)}
            />
          </div>
          <p className="col-span-2 text-xs text-text-secondary">
            {localize('com_ui_tars_mcp_auth_shared_hint')}
          </p>
        </div>
      )}
      {form.auth.type === 'login' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{localize('com_ui_tars_mcp_auth_token_url')}</Label>
              <Input
                value={form.auth.tokenUrl}
                onChange={(e) => setAuth('tokenUrl', e.target.value)}
                placeholder="/api/auth/login"
              />
            </div>
            <div>
              <Label>{localize('com_ui_tars_mcp_auth_token_field')}</Label>
              <Input
                value={form.auth.tokenField}
                onChange={(e) => setAuth('tokenField', e.target.value)}
                placeholder="access_token"
              />
            </div>
          </div>
          <div>
            <Label>{localize('com_ui_tars_mcp_auth_credentials')}</Label>
            <textarea
              rows={4}
              value={form.auth.credentialsJson}
              onChange={(e) => setAuth('credentialsJson', e.target.value)}
              aria-label={localize('com_ui_tars_mcp_auth_credentials')}
              className={textareaClass}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {localize('com_ui_tars_mcp_auth_login_hint')}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const basicTab = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="tars-mcp-name">{localize('com_ui_name')}</Label>
          <Input
            id="tars-mcp-name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="tars-mcp-code">{localize('com_ui_tars_mcp_code')}</Label>
          <Input
            id="tars-mcp-code"
            value={form.code}
            onChange={(e) => set('code', e.target.value)}
            placeholder="issues"
          />
          <p className="mt-1 text-xs text-text-secondary">
            {localize('com_ui_tars_mcp_code_hint')}
          </p>
        </div>
      </div>
      <div>
        <Label htmlFor="tars-mcp-desc">{localize('com_ui_description')}</Label>
        <Input
          id="tars-mcp-desc"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="tars-mcp-priority">{localize('com_ui_tars_mcp_priority')}</Label>
          <Input
            id="tars-mcp-priority"
            type="number"
            value={form.priority}
            onChange={(e) => set('priority', e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <Label htmlFor="tars-mcp-tags">{localize('com_ui_tars_mcp_tags')}</Label>
          <Input
            id="tars-mcp-tags"
            value={form.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder={localize('com_ui_tars_mcp_tags_hint')}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Label>{localize('com_ui_tars_mcp_type')}</Label>
          <Dropdown
            value={form.type}
            onChange={(value) => set('type', value as ServerForm['type'])}
            disabled={isEdit}
            ariaLabel={localize('com_ui_tars_mcp_type')}
            options={[
              { value: 'openapi', label: localize('com_ui_tars_mcp_type_openapi') },
              { value: 'custom_api', label: localize('com_ui_tars_mcp_type_custom') },
              { value: 'external', label: localize('com_ui_tars_mcp_type_external') },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="tars-mcp-enabled">{localize('com_ui_active')}</Label>
          <Switch
            id="tars-mcp-enabled"
            aria-label={localize('com_ui_active')}
            checked={form.enabled}
            onCheckedChange={(checked) => set('enabled', checked)}
          />
        </div>
      </div>
    </div>
  );

  const connectionTab = (
    <div className="space-y-4">
      {form.type === 'openapi' && (
        <div className="space-y-3 rounded-lg border border-border-light p-3">
          <div>
            <Label htmlFor="tars-mcp-openapi-url">{localize('com_ui_tars_mcp_openapi_url')}</Label>
            <div className="flex gap-2">
              <Input
                id="tars-mcp-openapi-url"
                value={form.openapiUrl}
                onChange={(e) => set('openapiUrl', e.target.value)}
                placeholder="https://api.example.com/openapi.json"
              />
              <Button variant="outline" onClick={handleParse} disabled={parseMutation.isLoading}>
                {parseMutation.isLoading ? <Spinner /> : localize('com_ui_tars_mcp_parse')}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tars-mcp-base-url">{localize('com_ui_tars_mcp_base_url')}</Label>
              <Input
                id="tars-mcp-base-url"
                value={form.baseUrl}
                onChange={(e) => set('baseUrl', e.target.value)}
                placeholder={localize('com_ui_tars_mcp_base_url_optional')}
              />
            </div>
            <div>
              <Label htmlFor="tars-mcp-timeout">{localize('com_ui_tars_mcp_timeout')}</Label>
              <Input
                id="tars-mcp-timeout"
                value={form.timeout}
                onChange={(e) => set('timeout', e.target.value)}
              />
            </div>
          </div>
          {parsed != null && (
            <div className="rounded-lg bg-surface-secondary p-3 text-sm">
              <p className="mb-2 font-medium text-text-primary">
                {localize('com_ui_tars_mcp_parse_result', {
                  count: parsed.tool_count ?? parsed.tools?.length ?? 0,
                })}
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {(parsed.tools ?? []).map((tool) => (
                  <li key={tool.name} className="truncate text-xs text-text-secondary">
                    <span className="font-mono text-text-primary">{tool.name}</span>
                    {tool.description ? ` — ${tool.description}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {form.type === 'custom_api' && (
        <div className="rounded-lg border border-border-light p-3">
          <Label htmlFor="tars-mcp-custom-base">{localize('com_ui_tars_mcp_base_url')}</Label>
          <Input
            id="tars-mcp-custom-base"
            value={form.baseUrl}
            onChange={(e) => set('baseUrl', e.target.value)}
            placeholder="https://api.example.com"
          />
        </div>
      )}

      {form.type === 'external' && (
        <div className="space-y-3 rounded-lg border border-border-light p-3">
          <div className="flex items-center gap-4">
            <Label>{localize('com_ui_tars_mcp_transport')}</Label>
            <Dropdown
              value={form.transport}
              onChange={(value) => set('transport', value as ExternalTransport)}
              ariaLabel={localize('com_ui_tars_mcp_transport')}
              options={[
                { value: 'streamable_http', label: localize('com_ui_tars_mcp_transport_http') },
                { value: 'stdio', label: localize('com_ui_tars_mcp_transport_stdio') },
              ]}
            />
          </div>
          {form.transport === 'streamable_http' && (
            <>
              <div>
                <Label htmlFor="tars-mcp-external-url">{localize('com_ui_tars_mcp_url')}</Label>
                <Input
                  id="tars-mcp-external-url"
                  value={form.externalUrl}
                  onChange={(e) => set('externalUrl', e.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                />
              </div>
              <div>
                <Label htmlFor="tars-mcp-headers">{localize('com_ui_tars_mcp_headers_json')}</Label>
                <textarea
                  id="tars-mcp-headers"
                  rows={4}
                  value={form.headersJson}
                  onChange={(e) => set('headersJson', e.target.value)}
                  className={textareaClass}
                  placeholder={'{\n  "X-Custom-Header": "value"\n}'}
                />
              </div>
            </>
          )}
          {form.transport === 'stdio' && (
            <>
              <p className="rounded-lg bg-surface-secondary p-2 text-xs text-text-secondary">
                {localize('com_ui_tars_mcp_stdio_warning')}
              </p>
              <div>
                <Label htmlFor="tars-mcp-command">{localize('com_ui_tars_mcp_command')}</Label>
                <Input
                  id="tars-mcp-command"
                  value={form.command}
                  onChange={(e) => set('command', e.target.value)}
                  placeholder="uvx"
                />
              </div>
              <div>
                <Label htmlFor="tars-mcp-args">{localize('com_ui_tars_mcp_args')}</Label>
                <textarea
                  id="tars-mcp-args"
                  rows={4}
                  value={form.argsText}
                  onChange={(e) => set('argsText', e.target.value)}
                  className={textareaClass}
                  placeholder={'mcp-server-fetch\n--option value'}
                />
                <p className="mt-1 text-xs text-text-secondary">
                  {localize('com_ui_tars_mcp_args_hint')}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {!(form.type === 'external' && form.transport === 'stdio') && authFields}
    </div>
  );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={
          isEdit ? localize('com_ui_tars_mcp_edit_server') : localize('com_ui_tars_mcp_add_server')
        }
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        main={
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <Tabs value={formTab} onValueChange={(value) => setFormTab(value as FormTab)}>
              <TabsList className="-ml-3 w-fit">
                <TabsTrigger value="basic" className={TAB_TRIGGER}>
                  {localize('com_ui_tars_mcp_tab_basic')}
                </TabsTrigger>
                <TabsTrigger value="connection" className={TAB_TRIGGER}>
                  {localize('com_ui_tars_mcp_tab_connection')}
                </TabsTrigger>
                {showToolsTab && (
                  <TabsTrigger value="tools" className={TAB_TRIGGER}>
                    {localize('com_ui_tars_mcp_tab_tools_def')}
                  </TabsTrigger>
                )}
                {showEnvTab && (
                  <TabsTrigger value="env" className={TAB_TRIGGER}>
                    {localize('com_ui_tars_mcp_tab_env')}
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="basic" className={TAB_PANEL}>
                {basicTab}
              </TabsContent>

              <TabsContent value="connection" className={TAB_PANEL}>
                {connectionTab}
              </TabsContent>

              {showToolsTab && (
                <TabsContent value="tools" className={TAB_PANEL}>
                  <McpCustomApiTools value={form.tools} onChange={(tools) => set('tools', tools)} />
                </TabsContent>
              )}

              {showEnvTab && (
                <TabsContent value="env" className={TAB_PANEL}>
                  <div>
                    <Label htmlFor="tars-mcp-env-vars">
                      {localize('com_ui_tars_mcp_env_vars_json')}
                    </Label>
                    <textarea
                      id="tars-mcp-env-vars"
                      rows={6}
                      value={form.envVarsJson}
                      onChange={(e) => set('envVarsJson', e.target.value)}
                      className={textareaClass}
                      placeholder={'{\n  "API_TOKEN": "${MY_TOKEN}"\n}'}
                    />
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
