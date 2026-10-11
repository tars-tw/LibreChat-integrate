import React from 'react';
import { User, Users, X, ExternalLink, Info } from 'lucide-react';
import { PrincipalType, ResourceType } from 'librechat-data-provider';
import { Button, Checkbox, TooltipAnchor, useMediaQuery } from '@librechat/client';
import type { TPrincipal, AccessRoleIds } from 'librechat-data-provider';
import AccessRolesPicker from '~/components/Sharing/AccessRolesPicker';
import PrincipalAvatar from '~/components/Sharing/PrincipalAvatar';
import { RESOURCE_CONFIGS } from '~/utils/resources';
import { principalKey } from '../shareChanges';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Each column scrolls on its own so a long share list never pushes the dialog's
 *  public-access controls out of reach. */
const LIST_HEIGHT = 'max-h-[min(22rem,40dvh)]';

interface SelectedPrincipalsListProps {
  principles: TPrincipal[];
  onRemoveHandler: (principalKey: string) => void;
  onRoleChange?: (principalKey: string, newRoleId: AccessRoleIds) => void;
  onInsightsAccessChange?: (principalKey: string, enabled: boolean) => void;
  showInsightsAccess?: boolean;
  resourceType?: ResourceType;
  className?: string;
}

export default function SelectedPrincipalsList({
  principles,
  onRemoveHandler,
  className = '',
  onRoleChange,
  onInsightsAccessChange,
  showInsightsAccess = false,
  resourceType = ResourceType.AGENT,
}: SelectedPrincipalsListProps) {
  const localize = useLocalize();
  const isMobile = useMediaQuery('(max-width: 768px)');

  /** A pwc_tars group has no email; its member count says more than its source does. */
  const describePrincipal = (principal: TPrincipal) => {
    if (principal.type === PrincipalType.GROUP && principal.source === 'tars') {
      return localize('com_ui_share_group_member_count', { 0: principal.memberCount ?? 0 });
    }
    if (principal.source === 'tars') {
      return localize(principal.type === PrincipalType.GROUP ? 'com_ui_group' : 'com_ui_user');
    }
    return `${principal.type} (${principal.source || 'local'})`;
  };

  const getPrincipalDisplayInfo = (principal: TPrincipal) => {
    const displayName = principal.name || localize('com_ui_unknown');
    const subtitle = isMobile
      ? describePrincipal(principal)
      : principal.email || describePrincipal(principal);

    return { displayName, subtitle };
  };

  if (principles.length === 0) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="border-border-medium text-text-secondary rounded-lg border border-dashed py-8 text-center">
          <Users className="mx-auto mb-2 h-8 w-8 opacity-50" aria-hidden="true" />
          <p className="mt-1 text-xs">{localize('com_ui_search_above_to_add_all')}</p>
        </div>
      </div>
    );
  }

  const ownerRoleId = RESOURCE_CONFIGS[resourceType]?.defaultOwnerRoleId;
  const isSharedLink = resourceType === ResourceType.SHARED_LINK;

  /** Users on one side, groups (and roles) on the other; owners lead their column. */
  const byOwnerFirst = (a: TPrincipal, b: TPrincipal) =>
    Number(b.accessRoleId === ownerRoleId) - Number(a.accessRoleId === ownerRoleId);
  const users = principles.filter((share) => share.type === PrincipalType.USER).sort(byOwnerFirst);
  const groups = principles.filter((share) => share.type !== PrincipalType.USER).sort(byOwnerFirst);

  const renderPrincipal = (share: TPrincipal) => {
    const { displayName, subtitle } = getPrincipalDisplayInfo(share);
    const isOwner = share.accessRoleId === ownerRoleId;
    const lockOwner = isSharedLink && isOwner;
    const shareKey = principalKey(share);
    const hasAutomaticInsightsAccess = share.isAdmin === true;
    const insightsDescription = localize(
      hasAutomaticInsightsAccess
        ? 'com_ui_view_agent_insights_admin_description'
        : 'com_ui_view_agent_insights_description',
    );
    return (
      <li
        key={`${shareKey}-principalList`}
        className="border-border-light flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-transparent p-3"
      >
        <div className="flex min-w-[10rem] flex-1 items-center gap-3">
          <PrincipalAvatar principal={share} size="md" />

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{displayName}</div>
            <div className="text-text-secondary flex min-w-0 items-center gap-1 text-xs">
              <span className="truncate">{subtitle}</span>
              {share.source === 'entra' && (
                <>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{localize('com_ui_azure_ad')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="ms-auto flex shrink-0 items-center justify-end gap-2">
          {showInsightsAccess && onInsightsAccessChange && (
            <div className="me-1 flex items-center gap-2">
              <Checkbox
                checked={hasAutomaticInsightsAccess || share.viewInsights === true}
                disabled={hasAutomaticInsightsAccess}
                onCheckedChange={(checked) => onInsightsAccessChange(shareKey, checked === true)}
                aria-label={localize('com_ui_view_agent_insights')}
              />
              <span className="text-text-secondary text-sm whitespace-nowrap">
                {localize('com_ui_view_agent_insights')}
              </span>
              <TooltipAnchor
                description={insightsDescription}
                render={
                  <button
                    type="button"
                    aria-label={insightsDescription}
                    className="text-text-secondary hover:text-text-primary"
                  >
                    <Info className="size-4" aria-hidden="true" />
                  </button>
                }
              />
            </div>
          )}
          {lockOwner ? (
            <span className="text-text-secondary px-3 py-2 text-sm font-medium">
              {localize('com_ui_role_owner')}
            </span>
          ) : (
            !!share.accessRoleId &&
            !!onRoleChange && (
              <AccessRolesPicker
                resourceType={resourceType}
                selectedRoleId={share.accessRoleId}
                onRoleChange={(newRole) => {
                  onRoleChange?.(shareKey, newRole);
                }}
                className="min-w-0"
              />
            )
          )}
          {!lockOwner && (
            <Button
              variant="outline"
              onClick={() => onRemoveHandler(shareKey)}
              className="hover:border-status-error-border hover:bg-status-error-subtle hover:text-text-destructive h-9 w-9 p-0"
              aria-label={localize('com_ui_remove_user', { 0: displayName })}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </li>
    );
  };

  const renderColumn = (
    testId: string,
    labelKey: 'com_ui_share_directory_users' | 'com_ui_share_directory_groups',
    emptyKey: 'com_ui_share_no_users_added' | 'com_ui_share_no_groups_added',
    Icon: typeof User,
    items: TPrincipal[],
  ) => (
    <section className="flex min-w-0 flex-col" aria-label={localize(labelKey)} data-testid={testId}>
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <span className="text-text-secondary flex items-center gap-1.5 text-xs font-semibold">
          <Icon className="size-3.5" aria-hidden="true" />
          {localize(labelKey)}
        </span>
        <span className="bg-surface-tertiary text-text-secondary rounded-full px-2 text-xs font-medium">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="border-border-medium text-text-secondary rounded-xl border border-dashed px-4 py-6 text-center text-xs">
          {localize(emptyKey)}
        </div>
      ) : (
        <ul
          className={cn(
            'm-0 list-none space-y-2 overflow-y-auto overscroll-contain p-0 pe-1',
            LIST_HEIGHT,
          )}
        >
          {items.map(renderPrincipal)}
        </ul>
      )}
    </section>
  );

  return (
    <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2', className)}>
      {renderColumn(
        'principals-users',
        'com_ui_share_directory_users',
        'com_ui_share_no_users_added',
        User,
        users,
      )}
      {renderColumn(
        'principals-groups',
        'com_ui_share_directory_groups',
        'com_ui_share_no_groups_added',
        Users,
        groups,
      )}
    </div>
  );
}
