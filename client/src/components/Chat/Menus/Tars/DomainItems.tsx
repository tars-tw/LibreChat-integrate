import { useMemo } from 'react';
import { VisuallyHidden } from '@ariakit/react';
import { Brain, CheckCircle2 } from 'lucide-react';
import {
  CustomMenuGroup as MenuGroup,
  CustomMenuItem as MenuItem,
  CustomMenuSeparator,
} from '../Endpoints/CustomMenu';
import { useTarsDomain } from './domain';
import { useLocalize } from '~/hooks';

interface DomainItemsProps {
  searchValue: string;
  /** Whether selectable rows follow this group, so the separator is only drawn when needed. */
  showSeparator: boolean;
}

/**
 * Specialized brain (專用腦) picker rendered inside the model selector's
 * "My Agents" submenu. Selecting one rebinds the conversation's `domain_id`
 * without touching the selected model.
 */
export function DomainItems({ searchValue, showSeparator }: DomainItemsProps) {
  const localize = useLocalize();
  const { domains, selectedId, selectDomain } = useTarsDomain();

  const filteredDomains = useMemo(() => {
    const searchTerm = searchValue.trim().toLowerCase();
    if (!searchTerm) {
      return domains;
    }
    return domains.filter((domain) => domain.name.toLowerCase().includes(searchTerm));
  }, [domains, searchValue]);

  if (!filteredDomains.length) {
    return null;
  }

  return (
    <>
      <MenuGroup label={localize('com_ui_tars_domains')}>
        {filteredDomains.map((domain) => {
          const value = String(domain.id);
          const isSelected = value === selectedId;
          return (
            <MenuItem
              key={`tars-domain-${value}`}
              onClick={() => selectDomain(value)}
              aria-selected={isSelected || undefined}
              className="group flex w-full cursor-pointer items-center justify-between rounded-lg px-2 text-sm"
            >
              <div className="flex w-full min-w-0 items-center gap-2 px-1 py-1">
                <Brain className="size-5 shrink-0 text-text-primary" aria-hidden="true" />
                <span className="truncate text-left">{domain.name}</span>
              </div>
              {isSelected && (
                <>
                  <CheckCircle2 className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
                  <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
                </>
              )}
            </MenuItem>
          );
        })}
      </MenuGroup>
      {showSeparator && <CustomMenuSeparator />}
    </>
  );
}

export default DomainItems;
