import { useMemo, useState } from 'react';
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
  TTarsDomainInput,
  TTarsKnowledgeBase,
} from 'librechat-data-provider';
import {
  domainRoleIds,
  isValidHttpUrl,
  domainKnowledgeBaseIds,
  disabledDomainFunctions,
} from './helpers';
import { useCreateTarsDomainMutation, useUpdateTarsDomainMutation } from '~/data-provider';
import { idsToCsv } from '../Users/helpers';
import { useLocalize } from '~/hooks';

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20;

type FormState = {
  name: string;
  description: string;
  status: boolean;
  iframeEnabled: boolean;
  iframeUrl: string;
  kbIds: Set<string>;
  roleIds: Set<string>;
  promptInstruction: string;
};

const toFormState = (domain: TTarsDomain | undefined, roles: TTarsRole[]): FormState => ({
  name: domain?.name ?? '',
  description: domain?.description ?? '',
  status: domain?.status ?? true,
  iframeEnabled: !!domain?.iframe_url,
  iframeUrl: domain?.iframe_url ?? '',
  kbIds: new Set(domain ? domainKnowledgeBaseIds(domain) : []),
  roleIds: new Set(domain ? domainRoleIds(domain, roles) : []),
  promptInstruction: domain?.prompt_instruction ?? '',
});

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
