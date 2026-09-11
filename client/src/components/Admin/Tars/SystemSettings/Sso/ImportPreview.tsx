import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input, Button, Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type {
  TTarsSsoConfig,
  TTarsLdapTreeNode,
  TTarsLdapTreeSummary,
} from 'librechat-data-provider';
import { LdapTreeNode } from './Tree';
import { useLocalize } from '~/hooks';

function CountBadge({ label }: { label: string }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-surface-tertiary px-2 py-0.5 text-xs text-text-secondary">
      {label}
    </span>
  );
}

function WarningBadge({ label }: { label: string }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
      {label}
    </span>
  );
}

/**
 * Read-only preview of what an AD import will write, shown before the admin
 * reaches the enable-users confirm step. Mirrors pwc_tars's own two-step
 * import wizard: browse/search the same tree the sync will read, see the
 * counts and warnings pwc_tars computed alongside it, then proceed.
 */
export default function ImportPreviewModal({
  config,
  nodes,
  summary,
  isLoading,
  onNext,
  onOpenChange,
}: {
  config: TTarsSsoConfig;
  nodes: TTarsLdapTreeNode[];
  summary?: TTarsLdapTreeSummary;
  isLoading: boolean;
  onNext: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const query = useMemo(() => search.trim().toLowerCase(), [search]);

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_sso_import_preview_title')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_sso_import_preview_target', {
                name: config.ldap_name || config.ldap_server_address || config.id,
              })}
            </p>
            <p className="text-sm text-text-secondary">
              {localize('com_ui_tars_sso_import_preview_description')}
            </p>
            {summary && (
              <div className="flex flex-wrap gap-2">
                <CountBadge
                  label={localize('com_ui_tars_sso_import_preview_users', {
                    count: summary.total_users,
                  })}
                />
                <CountBadge
                  label={localize('com_ui_tars_sso_import_preview_groups', {
                    count: summary.total_groups,
                  })}
                />
                <CountBadge
                  label={localize('com_ui_tars_sso_import_preview_ous', {
                    count: summary.total_ous,
                  })}
                />
                {summary.primary_group_augmented_count > 0 && (
                  <CountBadge
                    label={localize('com_ui_tars_sso_import_preview_primary_group_note', {
                      count: summary.primary_group_augmented_count,
                    })}
                  />
                )}
                {summary.group_member_error_count > 0 && (
                  <WarningBadge
                    label={localize('com_ui_tars_sso_import_preview_group_error', {
                      count: summary.group_member_error_count,
                    })}
                  />
                )}
              </div>
            )}
            <div className="relative">
              <Search className="icon-sm pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={localize('com_ui_tars_sso_tree_search')}
                className="pl-9"
              />
            </div>
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border-light p-2">
              {isLoading && (
                <div className="flex h-32 items-center justify-center">
                  <Spinner />
                </div>
              )}
              {!isLoading && nodes.length === 0 && (
                <p className="py-8 text-center text-sm text-text-secondary">
                  {localize('com_ui_tars_sso_tree_empty')}
                </p>
              )}
              {!isLoading &&
                nodes.map((node) => (
                  <LdapTreeNode
                    key={node.key}
                    node={node}
                    depth={0}
                    query={query}
                    selectable={false}
                  />
                ))}
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={onNext} disabled={isLoading || nodes.length === 0}>
            {localize('com_ui_tars_sso_import_preview_next')}
          </Button>
        }
      />
    </OGDialog>
  );
}
