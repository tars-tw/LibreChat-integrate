import { useState } from 'react';
import {
  Label,
  Input,
  Button,
  Switch,
  Spinner,
  OGDialog,
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

interface ServerForm {
  name: string;
  code: string;
  description: string;
  type: 'openapi' | 'custom_api';
  enabled: boolean;
  openapiUrl: string;
  baseUrl: string;
  timeout: string;
  toolsJson: string;
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

function toForm(server?: TTarsMcpServer): ServerForm {
  const config = server?.connection_config ?? {};
  return {
    name: server?.name ?? '',
    code: server?.code ?? '',
    description: server?.description ?? '',
    type: server?.type === 'custom_api' ? 'custom_api' : 'openapi',
    enabled: server?.is_enabled ?? true,
    openapiUrl: String(config.openapi_url ?? ''),
    baseUrl: String(config.base_url ?? ''),
    timeout: String(config.timeout ?? 30),
    toolsJson: config.tools ? JSON.stringify(config.tools, null, 2) : '[]',
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

  const syncMutation = useSyncTarsMcpServerMutation();
  const parseMutation = useParseTarsMcpOpenapiMutation();
  const createMutation = useCreateTarsMcpServerMutation();
  const updateMutation = useUpdateTarsMcpServerMutation();
  const isSaving = createMutation.isLoading || updateMutation.isLoading || syncMutation.isLoading;

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
    } else {
      if (!form.baseUrl.trim()) {
        showToast({ message: localize('com_ui_tars_mcp_base_url_required'), status: 'error' });
        return null;
      }
      let tools: unknown;
      try {
        tools = JSON.parse(form.toolsJson || '[]');
      } catch {
        showToast({ message: localize('com_ui_tars_mcp_invalid_json'), status: 'error' });
        return null;
      }
      if (!Array.isArray(tools) || tools.length === 0) {
        showToast({ message: localize('com_ui_tars_mcp_tools_required'), status: 'error' });
        return null;
      }
      connection.base_url = form.baseUrl.trim();
      connection.tools = tools;
    }

    return {
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      description: form.description.trim() || undefined,
      type: form.type,
      is_enabled: form.enabled,
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

  const authFields = (
    <div className="space-y-3 rounded-lg border border-border-light p-3">
      <div className="flex items-center justify-between">
        <Label>{localize('com_ui_tars_mcp_auth')}</Label>
        <select
          value={form.auth.type}
          onChange={(e) => setAuth('type', e.target.value as AuthType)}
          aria-label={localize('com_ui_tars_mcp_auth')}
          className="rounded-lg border border-border-light bg-transparent px-2 py-1 text-sm text-text-primary"
        >
          <option value="none">{localize('com_ui_tars_mcp_auth_none')}</option>
          <option value="bearer">{localize('com_ui_tars_mcp_auth_bearer')}</option>
          <option value="api_key">{localize('com_ui_tars_mcp_auth_api_key')}</option>
          <option value="basic">{localize('com_ui_tars_mcp_auth_basic')}</option>
          <option value="login">{localize('com_ui_tars_mcp_auth_login')}</option>
        </select>
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
                <select
                  value={form.auth.location}
                  onChange={(e) => setAuth('location', e.target.value as 'header' | 'query')}
                  aria-label={localize('com_ui_tars_mcp_auth_location')}
                  className="w-full rounded-lg border border-border-light bg-transparent px-2 py-1.5 text-sm text-text-primary"
                >
                  <option value="header">{localize('com_ui_tars_mcp_auth_in_header')}</option>
                  <option value="query">{localize('com_ui_tars_mcp_auth_in_query')}</option>
                </select>
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

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={
          isEdit ? localize('com_ui_tars_mcp_edit_server') : localize('com_ui_tars_mcp_add_server')
        }
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Label>{localize('com_ui_tars_mcp_type')}</Label>
                <select
                  value={form.type}
                  onChange={(e) => set('type', e.target.value as ServerForm['type'])}
                  disabled={isEdit}
                  aria-label={localize('com_ui_tars_mcp_type')}
                  className="rounded-lg border border-border-light bg-transparent px-2 py-1 text-sm text-text-primary disabled:opacity-60"
                >
                  <option value="openapi">{localize('com_ui_tars_mcp_type_openapi')}</option>
                  <option value="custom_api">{localize('com_ui_tars_mcp_type_custom')}</option>
                </select>
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

            {form.type === 'openapi' && (
              <div className="space-y-3 rounded-lg border border-border-light p-3">
                <div>
                  <Label htmlFor="tars-mcp-openapi-url">
                    {localize('com_ui_tars_mcp_openapi_url')}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="tars-mcp-openapi-url"
                      value={form.openapiUrl}
                      onChange={(e) => set('openapiUrl', e.target.value)}
                      placeholder="https://api.example.com/openapi.json"
                    />
                    <Button
                      variant="outline"
                      onClick={handleParse}
                      disabled={parseMutation.isLoading}
                    >
                      {parseMutation.isLoading ? <Spinner /> : localize('com_ui_tars_mcp_parse')}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="tars-mcp-base-url">
                      {localize('com_ui_tars_mcp_base_url')}
                    </Label>
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
              <div className="space-y-3 rounded-lg border border-border-light p-3">
                <div>
                  <Label htmlFor="tars-mcp-custom-base">
                    {localize('com_ui_tars_mcp_base_url')}
                  </Label>
                  <Input
                    id="tars-mcp-custom-base"
                    value={form.baseUrl}
                    onChange={(e) => set('baseUrl', e.target.value)}
                    placeholder="https://api.example.com"
                  />
                </div>
                <div>
                  <Label htmlFor="tars-mcp-tools-json">
                    {localize('com_ui_tars_mcp_tools_json')}
                  </Label>
                  <textarea
                    id="tars-mcp-tools-json"
                    rows={10}
                    value={form.toolsJson}
                    onChange={(e) => set('toolsJson', e.target.value)}
                    className={textareaClass}
                    placeholder={
                      '[\n  {\n    "name": "create_issue",\n    "description": "...",\n    "method": "POST",\n    "path": "/issues",\n    "parameters": [],\n    "request_body": { "content_type": "application/json", "properties": [] }\n  }\n]'
                    }
                  />
                  <p className="mt-1 text-xs text-text-secondary">
                    {localize('com_ui_tars_mcp_tools_json_hint')}
                  </p>
                </div>
              </div>
            )}

            {authFields}
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
