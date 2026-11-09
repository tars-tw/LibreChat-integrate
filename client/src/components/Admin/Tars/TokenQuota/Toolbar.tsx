import { Button, Dropdown, Input } from '@librechat/client';
import { HelpCircle, Plus, Search } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { TOKEN_PROVIDERS, QUOTA_STATUS_ON, QUOTA_STATUS_OFF } from './helpers';
import type { ReactNode } from 'react';

interface ToolbarProps {
  userSearch: string;
  groupFilter: string;
  groupOptions: { value: string; label: string }[];
  provider: string;
  status: string;
  onUserSearchChange: (value: string) => void;
  onGroupFilterChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onShowInfo: () => void;
  onAdd: () => void;
  extraActions?: ReactNode;
}

export default function Toolbar({
  userSearch,
  groupFilter,
  groupOptions,
  provider,
  status,
  onUserSearchChange,
  onGroupFilterChange,
  onProviderChange,
  onStatusChange,
  onShowInfo,
  onAdd,
  extraActions,
}: ToolbarProps) {
  const localize = useLocalize();

  const allGroupsLabel = '全部群組';
  const allProvidersLabel = localize('com_ui_tars_quota_all_providers');
  const allStatusesLabel = localize('com_ui_tars_quota_all_statuses');
  const activeLabel = localize('com_ui_tars_quota_active');
  const suspendedLabel = localize('com_ui_tars_quota_suspended');

  const providerOptions = [allProvidersLabel, ...TOKEN_PROVIDERS];
  const statusOptions = [allStatusesLabel, activeLabel, suspendedLabel];

  const groupLabels = [allGroupsLabel, ...groupOptions.map((group) => group.label)];

  const selectedGroup =
    groupOptions.find((group) => group.value === groupFilter)?.label ??
    allGroupsLabel;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[14rem] flex-1 sm:max-w-xs">
        <label className="text-text-secondary mb-1 block text-xs font-medium">
          {localize('com_ui_tars_quota_col_user')}
        </label>
        <div className="relative">
          <Search className="text-text-secondary pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={userSearch}
            onChange={(event) => onUserSearchChange(event.target.value)}
            placeholder={localize('com_ui_tars_quota_user_search')}
            aria-label={localize('com_ui_tars_quota_user_search')}
            className="pl-9"
          />
        </div>
      </div>

      <div>
        <label className="text-text-secondary mb-1 block text-xs font-medium">
          {localize('com_ui_tars_quota_col_group')}
        </label>
        <Dropdown
          value={selectedGroup}
          onChange={(value) => {
            if (value === allGroupsLabel) {
              onGroupFilterChange('');
              return;
            }

            const selected = groupOptions.find(
              (group) => group.label === value,
            );
            onGroupFilterChange(selected?.value ?? '');
          }}
          options={groupLabels}
          aria-label={localize('com_ui_tars_quota_col_group')}
        />
      </div>

      <div>
        <label className="text-text-secondary mb-1 block text-xs font-medium">
          {localize('com_ui_tars_quota_col_provider')}
        </label>
        <Dropdown
          value={provider || allProvidersLabel}
          onChange={(value) =>
            onProviderChange(value === allProvidersLabel ? '' : value)
          }
          options={providerOptions}
          aria-label={localize('com_ui_tars_quota_col_provider')}
        />
      </div>

      <div>
        <label className="text-text-secondary mb-1 block text-xs font-medium">
          {localize('com_ui_tars_quota_col_status')}
        </label>
        <Dropdown
          value={
            status === QUOTA_STATUS_ON
              ? activeLabel
              : status === QUOTA_STATUS_OFF
                ? suspendedLabel
                : allStatusesLabel
          }
          onChange={(value) => {
            if (value === activeLabel) {
              onStatusChange(QUOTA_STATUS_ON);
            } else if (value === suspendedLabel) {
              onStatusChange(QUOTA_STATUS_OFF);
            } else {
              onStatusChange('');
            }
          }}
          options={statusOptions}
          aria-label={localize('com_ui_tars_quota_col_status')}
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button variant="submit" onClick={onAdd}>
          <Plus className="mr-2 size-4" />
          {localize('com_ui_tars_quota_user_add')}
        </Button>
        {extraActions}
        <button
          type="button"
          aria-label={localize('com_ui_tars_quota_info_title')}
          title={localize('com_ui_tars_quota_info_title')}
          onClick={onShowInfo}
          className="border-border-light bg-surface-primary text-text-secondary flex size-10 items-center justify-center rounded-lg border transition-colors hover:bg-surface-hover"
        >
          <HelpCircle className="size-5" />
        </button>
      </div>
    </div>
  );
}
