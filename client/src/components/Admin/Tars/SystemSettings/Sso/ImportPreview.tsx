import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input, Button, Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type {
  TTarsSsoConfig,
  TTarsLdapTreeNode,
  TTarsLdapTreeSummary,
} from 'librechat-data-provider';
import useGroupSourceLabel from './source';
import { LdapTreeNode } from './Tree';
import { useLocalize } from '~/hooks';

function CountBadge({ label }: { label: string }) {
  return (
    <span className="bg-surface-tertiary text-text-secondary rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
      {label}
    </span>
  );
}

function WarningBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs whitespace-nowrap text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
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
  const groupSourceLabel = useGroupSourceLabel();
  const [search, setSearch] = useState('');
  const query = useMemo(() => search.trim().toLowerCase(), [search]);
  /** pwc_tars reports what it grouped by; an older build omits it, so fall back to the stored setting. */
  const groupAttribute = summary?.group_attribute ?? config.ldap_group_attribute ?? null;

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_sso_import_preview_title')}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="space-y-3">
            <p className="text-text-secondary text-sm">
              {localize('com_ui_tars_sso_import_preview_target', {
                name: config.ldap_name || config.ldap_server_address || config.id,
              })}
            </p>
            <p className="text-text-secondary text-sm">
              {localize('com_ui_tars_sso_import_preview_description')}
            </p>
            <p className="text-text-secondary text-sm">
              {localize('com_ui_tars_sso_import_group_source', {
                source: groupSourceLabel(groupAttribute),
              })}
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
                {groupAttribute ? (
                  summary.ungrouped_users > 0 && (
                    <CountBadge
                      label={localize('com_ui_tars_sso_import_preview_no_group', {
                        count: summary.ungrouped_users,
                      })}
                    />
                  )
                ) : (
                  <CountBadge
                    label={localize('com_ui_tars_sso_import_preview_ous', {
                      count: summary.total_ous,
                    })}
                  />
                )}
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
              <Search className="icon-sm text-text-secondary pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={localize('com_ui_tars_sso_tree_search')}
                className="pl-9"
              />
            </div>
            <div className="border-border-light max-h-[45vh] overflow-y-auto rounded-lg border p-2">
              {isLoading && (
                <div className="flex h-32 items-center justify-center">
                  <Spinner />
                </div>
              )}
              {!isLoading && nodes.length === 0 && (
                <p className="text-text-secondary py-8 text-center text-sm">
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
