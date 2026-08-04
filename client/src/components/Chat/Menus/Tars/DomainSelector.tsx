import { useMemo, useState } from 'react';
import { Brain } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { CustomMenu as Menu } from '../Endpoints/CustomMenu';
import { EndpointItem } from '../Endpoints/components/EndpointItem';
import { useModelSelectorContext } from '../Endpoints/ModelSelectorContext';
import { DomainMenuItem } from './DomainItems';
import { useTarsDomain } from './domain';
import { useLocalize } from '~/hooks';

/**
 * Primary chat-header picker. Three rows: the general brain, a submenu of the
 * specialized brains (專用腦), and the agents endpoint. The model picker
 * (`ModelSelector`) sits beside it and only surfaces on the general brain.
 * Renders nothing for non-tars users or when no domains are available.
 */
function DomainSelector() {
  const localize = useLocalize();
  const { domains, generalDomainId, selectedId, selectedName, selectDomain } = useTarsDomain();
  const { agentsEndpoint } = useModelSelectorContext();
  const [searchValue, setSearchValue] = useState('');

  const generalDomain = useMemo(
    () => domains.find((domain) => String(domain.id) === generalDomainId),
    [domains, generalDomainId],
  );

  const specializedDomains = useMemo(() => {
    const rest = domains.filter((domain) => String(domain.id) !== generalDomainId);
    const term = searchValue.trim().toLowerCase();
    return term ? rest.filter((domain) => domain.name.toLowerCase().includes(term)) : rest;
  }, [domains, generalDomainId, searchValue]);

  if (!domains.length || !selectedName) {
    return null;
  }

  const label = localize('com_ui_tars_domains');

  const trigger = (
    <TooltipAnchor
      aria-label={label}
      description={`${localize('com_ui_tars_domain_active')}: ${selectedName}`}
      render={
        <button
          data-testid="domain-selector-button"
          aria-label={label}
          className="my-1 flex h-9 w-full max-w-[70vw] items-center justify-center gap-2 rounded-xl border border-border-light bg-presentation px-3 py-2 text-sm text-text-primary hover:bg-surface-active-alt"
        >
          <div className="flex flex-shrink-0 items-center justify-center overflow-hidden">
            <Brain className="size-5 text-text-primary" aria-hidden="true" />
          </div>
          <span className="flex-grow truncate text-left">{selectedName}</span>
        </button>
      }
    />
  );

  return (
    <div className="relative flex flex-col items-center gap-2">
      <Menu trigger={trigger} placement="bottom-start" overlap={false}>
        {generalDomain && (
          <DomainMenuItem
            domain={generalDomain}
            isSelected={String(generalDomain.id) === selectedId}
            onSelect={selectDomain}
          />
        )}
        {specializedDomains.length > 0 && (
          <Menu
            id="tars-specialized-domains-menu"
            searchValue={searchValue}
            onSearch={setSearchValue}
            combobox={<input placeholder=" " />}
            comboboxLabel={localize('com_ui_tars_domain_search')}
            label={
              <div className="flex w-full min-w-0 items-center gap-2 py-1 text-sm">
                <Brain className="size-5 shrink-0 text-text-primary" aria-hidden="true" />
                <span className="truncate text-left">{label}</span>
              </div>
            }
          >
            {specializedDomains.map((domain) => (
              <DomainMenuItem
                key={`tars-domain-${domain.id}`}
                domain={domain}
                isSelected={String(domain.id) === selectedId}
                onSelect={selectDomain}
              />
            ))}
          </Menu>
        )}
        {agentsEndpoint && <EndpointItem endpoint={agentsEndpoint} endpointIndex={0} />}
      </Menu>
    </div>
  );
}

export default DomainSelector;
