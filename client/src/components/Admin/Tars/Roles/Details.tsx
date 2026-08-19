import { useMemo } from 'react';
import { Star } from 'lucide-react';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsDomain, TTarsRoleDetail } from 'librechat-data-provider';
import type { AdminMenuNode } from '~/components/Nav/Tars/AdminMenu';
import type { RoleUsage } from './helpers';
import {
  ADMIN_MENU_TREE,
  adminMenuLeafKeys,
  adminMenuNodeKeys,
} from '~/components/Nav/Tars/AdminMenu';
import { isRoleEnabled, roleDomainIds, roleMenuKeys } from './helpers';
import { formatDateTime, toNameMap } from '../Users/helpers';
import { StatusBadge, NameList } from '../Users/Fields';
import { useLocalize } from '~/hooks';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <div className="mt-0.5 text-sm text-text-primary">{children}</div>
    </div>
  );
}

/** The permitted leaves of one branch, rendered only when the branch has any. */
function GrantedBranch({ node, granted }: { node: AdminMenuNode; granted: Set<string> }) {
  const localize = useLocalize();
  const permitted = adminMenuNodeKeys(node).filter((key) => granted.has(key));
  if (permitted.length === 0) {
    return null;
  }

  return (
    <div className="py-0.5">
      <p className="text-sm font-medium text-text-primary">{localize(node.labelKey)}</p>
      {node.children?.length != null && node.children.length > 0 && (
        <div className="pl-4">
          {node.children.map((child) => (
            <GrantedBranch key={child.labelKey} node={child} granted={granted} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RoleDetailsModal({
  role,
  domains,
  usage,
  locale,
  onOpenChange,
}: {
  role: TTarsRoleDetail;
  domains: TTarsDomain[];
  usage: RoleUsage;
  locale: string;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const domainNames = useMemo(() => toNameMap(domains), [domains]);
  const storedKeys = roleMenuKeys(role);
  const granted = useMemo(() => new Set(storedKeys ?? adminMenuLeafKeys()), [storedKeys]);

  return (
    <OGDialog open={true} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={role.name}
        showCloseButton={true}
        className="w-11/12 md:max-w-2xl"
        main={
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={localize('com_ui_description')}>{role.description || '—'}</Field>
              <Field label={localize('com_ui_tars_users_status')}>
                <StatusBadge active={isRoleEnabled(role)} />
              </Field>
              <Field label={localize('com_ui_tars_roles_domains')}>
                <NameList
                  names={roleDomainIds(role)
                    .map((id) => domainNames.get(id))
                    .filter((name): name is string => !!name)}
                  empty={localize('com_ui_tars_roles_domains_none')}
                />
              </Field>
              <Field label={localize('com_ui_tars_roles_is_default')}>
                {role.is_default_role ? (
                  <Star className="icon-sm text-yellow-500" aria-hidden="true" />
                ) : (
                  localize('com_ui_no')
                )}
              </Field>
              <Field label={localize('com_ui_tars_roles_usage_users')}>{usage.users}</Field>
              <Field label={localize('com_ui_tars_roles_usage_groups')}>{usage.groups}</Field>
              <Field label={localize('com_ui_tars_users_created_at')}>
                {formatDateTime(role.created_at, locale) || '—'}
              </Field>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-text-secondary">
                {localize('com_ui_tars_roles_menus')}
              </p>
              {storedKeys == null && (
                <p className="mb-2 text-xs text-text-secondary">
                  {localize('com_ui_tars_roles_menus_unset')}
                </p>
              )}
              <div className="rounded-lg border border-border-light p-3">
                {ADMIN_MENU_TREE.map((node) => (
                  <GrantedBranch key={node.labelKey} node={node} granted={granted} />
                ))}
                {granted.size === 0 && (
                  <p className="text-sm text-text-secondary">
                    {localize('com_ui_tars_roles_menus_none')}
                  </p>
                )}
              </div>
            </div>
          </div>
        }
      />
    </OGDialog>
  );
}
