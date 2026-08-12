import { useCallback, useMemo, useState } from 'react';
import { Bot, Brain } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import { useModelSelectorContext } from '../Endpoints/ModelSelectorContext';
import { CustomMenu as Menu } from '../Endpoints/CustomMenu';
import { DomainMenuItem } from './DomainItems';
import { useTarsDomain } from './domain';
import AgentItems from './AgentItems';
import { useLocalize } from '~/hooks';

/**
 * Primary chat-header picker. Three rows: the general brain, a submenu of the
 * specialized brains (專用腦), and the agents endpoint. The model picker
 * (`ModelSelector`) sits beside it and only surfaces on the general brain.
 * Renders nothing for non-tars users or when no domains are available.
 */
function DomainSelector() {
  const localize = useLocalize();
  const { domains, generalDomainId, selectedId, selectedName, selectedAgentId, selectDomain } =
    useTarsDomain();
  const { agentsEndpoint, agentsMap, mappedEndpoints } = useModelSelectorContext();
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

  /**
   * The selected agent stands in for the brain: it names the trigger and takes the
   * checkmark, since its own model — not the brain's — drives the conversation.
   */
  const agentName = selectedAgentId
    ? (agentsEndpoint?.agentNames?.[selectedAgentId] ??
      agentsMap?.[selectedAgentId]?.name ??
      selectedAgentId)
    : undefined;
  const agentAvatarUrl = selectedAgentId
    ? agentsEndpoint?.modelIcons?.[selectedAgentId]
    : undefined;

  /**
   * Leaving an agent hands the brain a model back — the first whitelisted one, which is
   * also what the model picker lists first once it reappears.
   */
  const defaultModelFields = useMemo((): Partial<TConversation> | undefined => {
    const fallback = mappedEndpoints?.find((endpoint) => endpoint.models?.length);
    const model = fallback?.models?.[0]?.name;
    if (!fallback || !model) {
      return undefined;
    }
    return {
      endpoint: fallback.value as TConversation['endpoint'],
      endpointType: undefined,
      model,
      spec: null,
      iconURL: null,
      agent_id: undefined,
      assistant_id: undefined,
    };
  }, [mappedEndpoints]);

  const handleSelectDomain = useCallback(
    (id: string) => selectDomain(id, selectedAgentId ? defaultModelFields : undefined),
    [defaultModelFields, selectDomain, selectedAgentId],
  );

  if (!domains.length || !selectedName) {
    return null;
  }

  const label = localize('com_ui_tars_domains');
  const displayName = agentName ?? selectedName;

  const renderTriggerIcon = () => {
    if (agentAvatarUrl) {
      return <img src={agentAvatarUrl} alt="" className="size-5 rounded-full object-cover" />;
    }
    if (selectedAgentId) {
      return (
        agentsEndpoint?.icon ?? <Bot className="size-5 text-text-primary" aria-hidden="true" />
      );
    }
    return <Brain className="size-5 text-text-primary" aria-hidden="true" />;
  };

  const trigger = (
    <TooltipAnchor
      aria-label={label}
      description={`${localize('com_ui_tars_domain_active')}: ${displayName}`}
      render={
        <button
          data-testid="domain-selector-button"
          aria-label={label}
          className="my-1 flex h-9 w-full max-w-[70vw] items-center justify-center gap-2 rounded-xl border border-border-light bg-presentation px-3 py-2 text-sm text-text-primary hover:bg-surface-active-alt"
        >
          <div
            className="flex size-5 flex-shrink-0 items-center justify-center overflow-hidden"
            aria-hidden="true"
          >
            {renderTriggerIcon()}
          </div>
          <span className="flex-grow truncate text-left">{displayName}</span>
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
            isSelected={!selectedAgentId && String(generalDomain.id) === selectedId}
            onSelect={handleSelectDomain}
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
                isSelected={!selectedAgentId && String(domain.id) === selectedId}
                onSelect={handleSelectDomain}
              />
            ))}
          </Menu>
        )}
        {agentsEndpoint && <AgentItems endpoint={agentsEndpoint} />}
      </Menu>
    </div>
  );
}

export default DomainSelector;
