import { useState } from 'react';
import {
  Label,
  Button,
  Switch,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsSysConfig } from 'librechat-data-provider';
import { useUpdateTarsSysConfigMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function EditSysConfigModal({
  config,
  open,
  onOpenChange,
}: {
  config: TTarsSysConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [form, setForm] = useState({
    value: config.value ?? '',
    description: config.description ?? '',
    active: config.status === 'active',
  });

  const updateMutation = useUpdateTarsSysConfigMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_sys_config_updated'), status: 'success' });
      onOpenChange(false);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const handleSave = () => {
    updateMutation.mutate({
      key: config.key,
      value: form.value,
      description: form.description,
      status: form.active ? 'active' : 'inactive',
    });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_sys_config_edit')}
        showCloseButton={true}
        className="w-11/12 md:max-w-lg"
        main={
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label>{localize('com_ui_tars_sys_config_key')}</Label>
                <p className="break-all font-mono text-xs text-text-secondary">{config.key}</p>
              </div>
              <div>
                <Label>{localize('com_ui_tars_sys_config_category')}</Label>
                <p className="text-text-secondary">{config.category ?? '—'}</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="sys-config-status">{localize('com_ui_tars_sys_config_active')}</Label>
              <Switch
                id="sys-config-status"
                aria-label={localize('com_ui_tars_sys_config_status')}
                checked={form.active}
                onCheckedChange={(checked) => setForm((p) => ({ ...p, active: checked }))}
              />
            </div>
            <div>
              <Label htmlFor="sys-config-value">{localize('com_ui_tars_sys_config_value')}</Label>
              <textarea
                id="sys-config-value"
                rows={4}
                value={form.value}
                onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))}
                className="min-h-[96px] w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 font-mono text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
              />
            </div>
            <div>
              <Label htmlFor="sys-config-desc">
                {localize('com_ui_tars_sys_config_description')}
              </Label>
              <textarea
                id="sys-config-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="min-h-[72px] w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
              />
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSave} disabled={updateMutation.isLoading}>
            {updateMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
