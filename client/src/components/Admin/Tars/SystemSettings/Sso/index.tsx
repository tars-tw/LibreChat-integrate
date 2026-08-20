import { useState } from 'react';
import {
  Button,
  Switch,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import {
  Plus,
  Pencil,
  Trash2,
  Unlink,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  DownloadCloud,
} from 'lucide-react';
import type { TTarsSsoConfig } from 'librechat-data-provider';
import {
  useTarsSsoConfigsQuery,
  useImportTarsAdDataMutation,
  useDeleteTarsAdDataMutation,
  useDeleteTarsSsoConfigMutation,
} from '~/data-provider';
import { isSsoConfigEnabled, whitelistToUsernames } from '../helpers';
import SyncScheduleModal from './Schedule';
import WhitelistPanel from './Whitelist';
import { useLocalize } from '~/hooks';
import SsoConfigModal from './Modal';
import Card from '../Card';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <p className="mt-0.5 break-all text-sm text-text-primary">{value || '—'}</p>
    </div>
  );
}

/**
 * LDAP administration. pwc_tars supports several configurations, so all of them
 * are listed as expandable panels rather than hidden behind a picker.
 */
export default function SsoCard() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: configs = [], isLoading } = useTarsSsoConfigsQuery();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TTarsSsoConfig | null>(null);
  const [deleting, setDeleting] = useState<TTarsSsoConfig | null>(null);
  const [unlinking, setUnlinking] = useState<TTarsSsoConfig | null>(null);
  const [scheduling, setScheduling] = useState<TTarsSsoConfig | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importEnableUsers, setImportEnableUsers] = useState(true);
  const [importing, setImporting] = useState<TTarsSsoConfig | null>(null);

  const onError = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const deleteMutation = useDeleteTarsSsoConfigMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_sso_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError,
  });

  const importMutation = useImportTarsAdDataMutation({
    onSuccess: (result) => {
      showToast({
        message: result.message || localize('com_ui_tars_sso_import_done'),
        status: 'success',
      });
      setImporting(null);
    },
    onError,
  });

  const unlinkMutation = useDeleteTarsAdDataMutation({
    onSuccess: (result) => {
      showToast({
        message: result.message || localize('com_ui_tars_sso_unlink_done'),
        status: 'success',
      });
      setUnlinking(null);
    },
    onError,
  });

  return (
    <Card
      title={localize('com_ui_tars_sso')}
      description={localize('com_ui_tars_sso_hint')}
      actions={
        <Button variant="submit" onClick={() => setCreating(true)}>
          <Plus className="icon-sm mr-1" />
          {localize('com_ui_tars_sso_add')}
        </Button>
      }
    >
      {isLoading && (
        <div className="flex h-32 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && configs.length === 0 && (
        <p className="py-10 text-center text-sm text-text-secondary">
          {localize('com_ui_tars_sso_empty')}
        </p>
      )}

      {!isLoading &&
        configs.map((config) => {
          const expanded = expandedId === config.id;
          const enabled = isSsoConfigEnabled(config);
          return (
            <div key={config.id} className="rounded-lg border border-border-light">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : config.id)}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  {expanded ? (
                    <ChevronDown className="icon-sm text-text-secondary" />
                  ) : (
                    <ChevronRight className="icon-sm text-text-secondary" />
                  )}
                  <span className="truncate font-medium text-text-primary">
                    {config.ldap_name || config.ldap_server_address || config.id}
                  </span>
                  <span className="truncate font-mono text-xs text-text-secondary">
                    {config.ldap_server_address}:{config.ldap_server_port}
                  </span>
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
                      enabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                        : 'bg-surface-tertiary text-text-secondary'
                    }`}
                  >
                    {enabled
                      ? localize('com_ui_tars_users_enabled')
                      : localize('com_ui_tars_users_disabled')}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={localize('com_ui_tars_sso_schedule')}
                    title={localize('com_ui_tars_sso_schedule')}
                    onClick={() => setScheduling(config)}
                    className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                  >
                    <CalendarClock className="icon-sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={localize('com_ui_tars_sso_import')}
                    title={localize('com_ui_tars_sso_import')}
                    onClick={() => {
                      setImportEnableUsers(true);
                      setImporting(config);
                    }}
                    className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                  >
                    <DownloadCloud className="icon-sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={localize('com_ui_tars_sso_unlink')}
                    title={localize('com_ui_tars_sso_unlink')}
                    onClick={() => setUnlinking(config)}
                    className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                  >
                    <Unlink className="icon-sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={localize('com_ui_edit')}
                    title={localize('com_ui_edit')}
                    onClick={() => setEditing(config)}
                    className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                  >
                    <Pencil className="icon-sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={localize('com_ui_delete')}
                    title={localize('com_ui_delete')}
                    onClick={() => setDeleting(config)}
                    className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                  >
                    <Trash2 className="icon-sm" />
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="space-y-4 border-t border-border-light p-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Detail
                      label={localize('com_ui_tars_sso_base_dn')}
                      value={config.ldap_base_dn ?? ''}
                    />
                    <Detail
                      label={localize('com_ui_tars_sso_search_attribute')}
                      value={config.ldap_search_attribute ?? ''}
                    />
                    <Detail
                      label={localize('com_ui_tars_sso_admin_dn')}
                      value={config.ldap_admin_dn ?? ''}
                    />
                    <Detail
                      label={localize('com_ui_tars_sso_whitelist_enable')}
                      value={
                        config.ldap_enable_whitelist
                          ? localize('com_ui_yes')
                          : localize('com_ui_no')
                      }
                    />
                    <Detail
                      label={localize('com_ui_tars_sso_whitelist_count_label')}
                      value={String(whitelistToUsernames(config.ldap_whitelist_users).length)}
                    />
                    <Detail
                      label={localize('com_ui_tars_sso_last_sync')}
                      value={config.last_execute_at ?? ''}
                    />
                  </div>
                  <WhitelistPanel config={config} />
                </div>
              )}
            </div>
          );
        })}

      {(creating || editing != null) && (
        <SsoConfigModal
          key={editing?.id ?? 'create'}
          config={editing ?? undefined}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
        />
      )}

      {scheduling != null && (
        <SyncScheduleModal
          config={scheduling}
          onOpenChange={(open) => !open && setScheduling(null)}
        />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_sso_delete')}
            showCloseButton={true}
            className="w-11/12 max-w-md"
            main={
              <p className="text-sm text-text-secondary">
                {localize('com_ui_tars_sso_delete_confirm', {
                  name: deleting.ldap_name || deleting.ldap_server_address || deleting.id,
                })}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleting.id)}
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}

      {importing != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setImporting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_sso_import')}
            showCloseButton={true}
            className="w-11/12 max-w-md"
            main={
              <div className="space-y-3">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_sso_import_confirm')}
                </p>
                <div className="flex items-center gap-2">
                  <Switch
                    id="tars-sso-import-enable"
                    aria-label={localize('com_ui_tars_sso_import_enable')}
                    checked={importEnableUsers}
                    onCheckedChange={setImportEnableUsers}
                  />
                  <label htmlFor="tars-sso-import-enable" className="text-sm text-text-primary">
                    {localize('com_ui_tars_sso_import_enable')}
                  </label>
                </div>
              </div>
            }
            buttons={
              <Button
                variant="submit"
                onClick={() =>
                  importMutation.mutate({
                    id: importing.id,
                    enableUsers: importEnableUsers,
                  })
                }
                disabled={importMutation.isLoading}
              >
                {importMutation.isLoading ? <Spinner /> : localize('com_ui_tars_sso_import_run')}
              </Button>
            }
          />
        </OGDialog>
      )}

      {unlinking != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setUnlinking(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_sso_unlink')}
            showCloseButton={true}
            className="w-11/12 max-w-md"
            main={
              <p className="text-sm text-text-secondary">
                {localize('com_ui_tars_sso_unlink_confirm')}
              </p>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() => unlinkMutation.mutate(unlinking.id)}
                disabled={unlinkMutation.isLoading}
              >
                {unlinkMutation.isLoading ? <Spinner /> : localize('com_ui_tars_sso_unlink_run')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </Card>
  );
}
