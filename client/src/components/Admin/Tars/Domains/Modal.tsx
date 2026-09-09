import { useMemo, useState } from 'react';
import { Puzzle, RefreshCw } from 'lucide-react';
import { parseTarsPluginFunctions } from 'librechat-data-provider';
import {
  Input,
  Label,
  Button,
  Switch,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type {
  TTarsRole,
  TTarsDomain,
  TTarsPluginTool,
  TTarsDomainInput,
  TTarsKnowledgeBase,
  TTarsPluginFunctionState,
} from 'librechat-data-provider';
import {
  useTarsPluginToolsQuery,
  useCreateTarsDomainMutation,
  useUpdateTarsDomainMutation,
  useReloadTarsPluginToolsMutation,
} from '~/data-provider';
import {
  domainRoleIds,
  isValidHttpUrl,
  domainKnowledgeBaseIds,
  disabledDomainFunctions,
} from './helpers';
import { idsToCsv } from '../Users/helpers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;

type PluginStates = Record<string, TTarsPluginFunctionState>;

type FormState = {
  name: string;
  description: string;
  status: boolean;
  iframeEnabled: boolean;
  iframeUrl: string;
  kbIds: Set<string>;
  roleIds: Set<string>;
  promptInstruction: string;
  /** Per-plugin switches, keyed by plugin name (pwc_tars `plugin:<name>`). */
  pluginStates: PluginStates;
};

const toPluginStates = (domain: TTarsDomain | undefined): PluginStates =>
  Object.fromEntries(
    parseTarsPluginFunctions(domain?.domain_functions).map((entry) => [
      entry.name,
      { enabled: entry.enabled, default_value: entry.default_value },
    ]),
  );

const toFormState = (domain: TTarsDomain | undefined, roles: TTarsRole[]): FormState => ({
  name: domain?.name ?? '',
  description: domain?.description ?? '',
  status: domain?.status ?? true,
  iframeEnabled: !!domain?.iframe_url,
  iframeUrl: domain?.iframe_url ?? '',
  kbIds: new Set(domain ? domainKnowledgeBaseIds(domain) : []),
  roleIds: new Set(domain ? domainRoleIds(domain, roles) : []),
  promptInstruction: domain?.prompt_instruction ?? '',
  pluginStates: toPluginStates(domain),
});

const OFF: TTarsPluginFunctionState = { enabled: false, default_value: false };

/**
 * The plugin-tool switches of the brain editor: one row per scanned plugin with
 * the same two switches pwc_tars' editor shows (是否顯示 / 預設開啟). A plugin that
 * failed pwc_tars' conformance check is listed but cannot be switched on.
 */
function PluginToolRows({
  tools,
  states,
  isLoading,
  isReloading,
  pluginDirs,
  onReload,
  onChange,
}: {
  tools: TTarsPluginTool[];
  states: PluginStates;
  isLoading: boolean;
  isReloading: boolean;
  pluginDirs: string[];
  onReload: () => void;
  onChange: (name: string, patch: Partial<TTarsPluginFunctionState>) => void;
}) {
  const localize = useLocalize();

  const renderPluginRows = () => {
    if (tools.length === 0) {
      return (
        <p className="text-sm text-text-secondary">
          {localize('com_ui_tars_plugin_none')}
          {pluginDirs.length > 0 && (
            <span className="block text-xs">
              {localize('com_ui_tars_plugin_dirs')}: {pluginDirs.join(', ')}
            </span>
          )}
        </p>
      );
    }
    return (
      <div className="rounded-lg border border-border-light">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-border-light px-3 py-2 text-xs text-text-secondary">
          <span />
          <span>{localize('com_ui_tars_plugin_visible')}</span>
          <span>{localize('com_ui_tars_plugin_default_on')}</span>
        </div>
        {tools.map((tool) => {
          const state = states[tool.name] ?? OFF;
          const usable = tool.ok;
          return (
            <div
              key={tool.name}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2" title={tool.description}>
                <Puzzle className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="truncate text-text-primary">{tool.display_name}</span>
                {!usable && (
                  <span className="text-xs text-text-warning" title={tool.problems.join('\n')}>
                    {localize('com_ui_tars_plugin_invalid')}
                  </span>
                )}
              </div>
              <Switch
                aria-label={`${tool.display_name} ${localize('com_ui_tars_plugin_visible')}`}
                checked={usable && state.enabled}
                disabled={!usable}
                onCheckedChange={(checked) =>
                  onChange(tool.name, {
                    enabled: checked,
                    default_value: checked ? state.default_value : false,
                  })
                }
              />
              <Switch
                aria-label={`${tool.display_name} ${localize('com_ui_tars_plugin_default_on')}`}
                checked={usable && state.enabled && state.default_value}
                disabled={!usable || !state.enabled}
                onCheckedChange={(checked) => onChange(tool.name, { default_value: checked })}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{localize('com_ui_tars_plugin_tools')}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReload}
          disabled={isReloading}
          aria-label={localize('com_ui_tars_plugin_reload')}
        >
          <RefreshCw
            className={cn('mr-1 h-4 w-4', isReloading && 'animate-spin')}
            aria-hidden="true"
          />
          {localize('com_ui_tars_plugin_reload')}
        </Button>
      </div>
      <p className="mb-2 text-xs text-text-secondary">
        {localize('com_ui_tars_plugin_tools_hint')}
      </p>
      {isLoading ? <Spinner /> : renderPluginRows()}
    </div>
  );
}

function CheckboxList({
  items,
  selected,
  emptyLabel,
  onToggle,
}: {
  items: { id: string; label: string }[];
  selected: Set<string>;
  emptyLabel: string;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">{emptyLabel}</p>;
  }
  return (
    <div className="max-h-40 overflow-y-auto rounded-lg border border-border-light p-2">
      {items.map((item) => (
        <label key={item.id} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={selected.has(item.id)}
            onChange={() => onToggle(item.id)}
          />
          <span className="truncate text-text-primary">{item.label}</span>
        </label>
      ))}
    </div>
  );
}

export default function DomainModal({
  open,
  domain,
  roles,
  knowledgeBases,
  onOpenChange,
}: {
  open: boolean;
  domain?: TTarsDomain;
  roles: TTarsRole[];
  knowledgeBases: TTarsKnowledgeBase[];
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = domain != null;
  const [form, setForm] = useState<FormState>(() => toFormState(domain, roles));

  const kbItems = useMemo(
    () => knowledgeBases.map((kb) => ({ id: kb.id, label: kb.name })),
    [knowledgeBases],
  );
  const roleItems = useMemo(
    () => roles.map((role) => ({ id: String(role.id), label: role.name })),
    [roles],
  );
  const onError = (error: unknown) =>
    showToast({
      message:
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const createMutation = useCreateTarsDomainMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_domain_created'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const updateMutation = useUpdateTarsDomainMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_domain_updated'), status: 'success' });
      onOpenChange(false);
    },
    onError,
  });
  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  const pluginToolsQuery = useTarsPluginToolsQuery({ enabled: open });
  const pluginTools = pluginToolsQuery.data?.plugin_tools;
  const reloadPlugins = useReloadTarsPluginToolsMutation({
    onError: () =>
      showToast({ message: localize('com_ui_tars_plugin_reload_failed'), status: 'error' }),
  });
  const setPluginState = (name: string, patch: Partial<TTarsPluginFunctionState>) =>
    setForm((prev) => ({
      ...prev,
      pluginStates: {
        ...prev.pluginStates,
        [name]: { ...(prev.pluginStates[name] ?? OFF), ...patch },
      },
    }));

  const toggleIn = (key: 'kbIds' | 'roleIds') => (id: string) =>
    setForm((prev) => {
      const next = new Set(prev[key]);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { ...prev, [key]: next };
    });

  const handleSave = () => {
    const name = form.name.trim();
    if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
      showToast({ message: localize('com_ui_tars_domain_name_rule'), status: 'error' });
      return;
    }
    if (form.iframeEnabled && !isValidHttpUrl(form.iframeUrl)) {
      showToast({ message: localize('com_ui_tars_domain_iframe_invalid'), status: 'error' });
      return;
    }
    if (!form.iframeEnabled && form.kbIds.size === 0) {
      showToast({ message: localize('com_ui_tars_domain_kb_required'), status: 'error' });
      return;
    }

    /**
     * Capability toggles and model settings are not edited here. Omitting
     * `domain_functions` makes pwc_tars keep the stored block on update and
     * apply its own defaults on create; an embedded-site brain is the one case
     * that must write the block, because every capability has to be off.
     */
    const payload: TTarsDomainInput = {
      name,
      description: form.description.trim(),
      role_ids: form.iframeEnabled ? '' : (idsToCsv([...form.roleIds]) ?? ''),
      knowledge_base_ids: form.iframeEnabled ? '' : (idsToCsv([...form.kbIds]) ?? ''),
      prompt_instruction: form.iframeEnabled ? '' : form.promptInstruction,
      iframe_url: form.iframeEnabled ? form.iframeUrl.trim() : '',
      status: form.status ? 1 : 0,
    };
    if (form.iframeEnabled) {
      payload.domain_functions = disabledDomainFunctions(domain?.domain_functions);
    } else if (pluginTools != null) {
      /** Merged server-side into the stored block, so pwc_tars' own feature keys survive. */
      payload.plugin_functions = form.pluginStates;
    }

    if (isEdit) {
      updateMutation.mutate({ id: domain.id, data: payload });
      return;
    }
    createMutation.mutate(payload);
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={isEdit ? localize('com_ui_tars_domain_edit') : localize('com_ui_tars_domain_add')}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        main={
          <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="tars-domain-name">{localize('com_ui_tars_domain_name')}</Label>
                <Input
                  id="tars-domain-name"
                  className="mt-1"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="tars-domain-desc">{localize('com_ui_description')}</Label>
                <Input
                  id="tars-domain-desc"
                  className="mt-1"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Label htmlFor="tars-domain-status">{localize('com_ui_tars_users_enabled')}</Label>
                <Switch
                  id="tars-domain-status"
                  aria-label={localize('com_ui_tars_users_enabled')}
                  checked={form.status}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, status: checked }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="tars-domain-iframe">{localize('com_ui_tars_domain_iframe')}</Label>
                <Switch
                  id="tars-domain-iframe"
                  aria-label={localize('com_ui_tars_domain_iframe')}
                  checked={form.iframeEnabled}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, iframeEnabled: checked }))
                  }
                />
              </div>
            </div>

            {form.iframeEnabled ? (
              <div>
                <Label htmlFor="tars-domain-iframe-url">
                  {localize('com_ui_tars_domain_iframe_url')}
                </Label>
                <Input
                  id="tars-domain-iframe-url"
                  type="url"
                  className="mt-1"
                  placeholder="https://example.com"
                  value={form.iframeUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, iframeUrl: e.target.value }))}
                />
                <p className="mt-1 text-xs text-text-secondary">
                  {localize('com_ui_tars_domain_iframe_hint')}
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>{localize('com_ui_tars_knowledge_bases')}</Label>
                    <div className="mt-1">
                      <CheckboxList
                        items={kbItems}
                        selected={form.kbIds}
                        emptyLabel={localize('com_ui_none')}
                        onToggle={toggleIn('kbIds')}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>{localize('com_ui_tars_domain_roles')}</Label>
                    <div className="mt-1">
                      <CheckboxList
                        items={roleItems}
                        selected={form.roleIds}
                        emptyLabel={localize('com_ui_none')}
                        onToggle={toggleIn('roleIds')}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="tars-domain-prompt">
                    {localize('com_ui_tars_domain_prompt')}
                  </Label>
                  <textarea
                    id="tars-domain-prompt"
                    rows={4}
                    value={form.promptInstruction}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, promptInstruction: e.target.value }))
                    }
                    className="mt-1 w-full resize-y rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
                  />
                  <p className="mt-1 text-xs text-text-secondary">
                    {localize('com_ui_tars_domain_prompt_hint')}
                  </p>
                </div>

                <PluginToolRows
                  tools={pluginTools ?? []}
                  states={form.pluginStates}
                  isLoading={pluginToolsQuery.isLoading}
                  isReloading={reloadPlugins.isLoading}
                  pluginDirs={pluginToolsQuery.data?.plugin_dirs ?? []}
                  onReload={() => reloadPlugins.mutate()}
                  onChange={setPluginState}
                />
              </>
            )}
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
