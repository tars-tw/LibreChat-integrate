import { useEffect, useMemo, useState } from 'react';
import { Input, Button, Spinner, useToastContext } from '@librechat/client';
import { Download, ListTree, RefreshCw, Search, Trash2, UserX } from 'lucide-react';
import type { TTarsSsoConfig, TTarsWhitelistUser } from 'librechat-data-provider';
import {
  useTarsLdapTreeMutation,
  useTarsSsoWhitelistMutation,
  useUpdateTarsSsoConfigMutation,
} from '~/data-provider';
import { connectionPayload, usernamesToWhitelist, whitelistToUsernames } from '../helpers';
import { downloadBlob, toCsvBlob } from '../../Users/helpers';
import { useLocalize } from '~/hooks';
import LdapTreeModal from './Tree';

const errorMessage = (error: unknown): string | undefined =>
  (error as { response?: { data?: { error?: string } } })?.response?.data?.error;

/**
 * Whitelist members of one LDAP configuration. pwc_tars stores the list as a
 * `;`-separated string of usernames on the configuration row, so every edit
 * rewrites that string; the directory lookup only enriches it for display.
 */
export default function WhitelistPanel({ config }: { config: TTarsSsoConfig }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const usernames = useMemo(
    () => whitelistToUsernames(config.ldap_whitelist_users),
    [config.ldap_whitelist_users],
  );
  const [search, setSearch] = useState('');
  const [details, setDetails] = useState<TTarsWhitelistUser[]>([]);
  const [treeOpen, setTreeOpen] = useState(false);

  const onError = (error: unknown) =>
    showToast({
      message: errorMessage(error) ?? localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const detailMutation = useTarsSsoWhitelistMutation({
    onSuccess: (result) => setDetails(result.users ?? []),
    onError,
  });
  const treeMutation = useTarsLdapTreeMutation({ onError });
  const updateMutation = useUpdateTarsSsoConfigMutation({
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_sso_whitelist_saved'), status: 'success' }),
    onError,
  });

  /** Resolving needs a live LDAP bind, so it only runs when there is a list to resolve. */
  const loadDetails = detailMutation.mutate;
  useEffect(() => {
    setDetails([]);
    if (usernames.length === 0) {
      return;
    }
    loadDetails({
      whitelist_users: usernamesToWhitelist(usernames),
      ...connectionPayload(config),
    });
  }, [config, usernames, loadDetails]);

  const rows = useMemo(() => {
    const byUsername = new Map(details.map((user) => [user.username.toLowerCase(), user]));
    const merged = usernames.map(
      (username) => byUsername.get(username.toLowerCase()) ?? { username },
    );
    const query = search.trim().toLowerCase();
    if (!query) {
      return merged;
    }
    return merged.filter(
      (user) =>
        user.username.toLowerCase().includes(query) ||
        (user.ou ?? '').toLowerCase().includes(query),
    );
  }, [details, usernames, search]);

  const saveList = (next: string[]) =>
    updateMutation.mutate({
      id: config.id,
      data: { ldap_whitelist_users: usernamesToWhitelist(next) },
    });

  const handleExport = () => {
    const headers = [
      localize('com_ui_tars_users_username'),
      localize('com_ui_tars_sso_whitelist_ou'),
      localize('com_auth_email'),
    ];
    const csvRows = rows.map((user) => [user.username, user.ou ?? '', user.email ?? '']);
    downloadBlob(
      toCsvBlob(headers, csvRows),
      `TARS_whitelist_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const handleBrowse = () => {
    setTreeOpen(true);
    treeMutation.mutate({ config_id: config.id });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-56 max-w-full">
          <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={localize('com_ui_tars_sso_whitelist_search')}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
            {localize('com_ui_tars_sso_whitelist_count', { count: usernames.length })}
          </span>
          <Button variant="outline" onClick={handleBrowse} disabled={treeMutation.isLoading}>
            {treeMutation.isLoading ? (
              <Spinner className="icon-sm mr-1" />
            ) : (
              <ListTree className="icon-sm mr-1" />
            )}
            {localize('com_ui_tars_sso_tree')}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              loadDetails({
                whitelist_users: usernamesToWhitelist(usernames),
                ...connectionPayload(config),
              })
            }
            disabled={usernames.length === 0 || detailMutation.isLoading}
          >
            {detailMutation.isLoading ? (
              <Spinner className="icon-sm mr-1" />
            ) : (
              <RefreshCw className="icon-sm mr-1" />
            )}
            {localize('com_ui_tars_sso_whitelist_resolve')}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
            <Download className="icon-sm mr-1" />
            {localize('com_ui_tars_users_export_csv')}
          </Button>
        </div>
      </div>

      {usernames.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-text-secondary">
          <UserX className="h-6 w-6" aria-hidden="true" />
          <p className="text-sm">{localize('com_ui_tars_sso_whitelist_empty')}</p>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border-light">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-secondary text-left text-text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">{localize('com_ui_tars_users_username')}</th>
                <th className="px-3 py-2 font-medium">
                  {localize('com_ui_tars_sso_whitelist_ou')}
                </th>
                <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr key={user.username} className="border-t border-border-light">
                  <td className="px-3 py-2 text-text-primary">{user.username}</td>
                  <td className="px-3 py-2 text-text-secondary">{user.ou || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        aria-label={localize('com_ui_tars_sso_whitelist_remove')}
                        title={localize('com_ui_tars_sso_whitelist_remove')}
                        disabled={updateMutation.isLoading}
                        onClick={() => saveList(usernames.filter((name) => name !== user.username))}
                        className="rounded p-1.5 text-text-secondary hover:bg-surface-tertiary hover:text-red-500"
                      >
                        <Trash2 className="icon-sm" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {treeOpen && (
        <LdapTreeModal
          config={config}
          nodes={treeMutation.data?.nodes ?? []}
          isLoading={treeMutation.isLoading}
          initialSelection={usernames}
          onConfirm={(next) => {
            saveList(next);
            setTreeOpen(false);
          }}
          onOpenChange={(open) => !open && setTreeOpen(false)}
        />
      )}
    </div>
  );
}
