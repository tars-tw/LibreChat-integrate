import { useCallback, useMemo } from 'react';
import { Bot, Brain } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { isTarsLangflowAgentId } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { useModelSelectorContext } from '../Endpoints/ModelSelectorContext';
import { CustomMenu as Menu } from '../Endpoints/CustomMenu';
import { DomainMenuItem } from './DomainItems';
import { useTarsDomain } from './domain';
import AgentItems from './AgentItems';
import { useLocalize } from '~/hooks';

/**
 * Primary chat-header picker. Two rows: the general brain and the agents endpoint —
 * specialized brains (專用腦) are reached through an agent bound to one, not picked here.
 * The model picker (`ModelSelector`) sits beside it and only surfaces on the general brain.
 * Renders nothing for non-tars users, when no domains are available, or on an older
 * conversation the list hides (`buildTarsHiddenConversationFilter`) but a URL still opens:
 * one bound to a specialized brain without an agent, or one with a Workflow agent.
 */
function DomainSelector() {
  const localize = useLocalize();
  const {
    domains,
    generalDomainId,
    selectedId,
    selectedName,
    selectedAgentId,
    selectDomain,
    isGeneralDomain,
  } = useTarsDomain();
  const { agentsEndpoint, agentsMap, mappedEndpoints } = useModelSelectorContext();

  const generalDomain = useMemo(
    () => domains.find((domain) => String(domain.id) === generalDomainId),
    [domains, generalDomainId],
  );

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

  const isHiddenConversation = selectedAgentId
    ? isTarsLangflowAgentId(selectedAgentId)
    : !isGeneralDomain;
  if (!domains.length || !selectedName || isHiddenConversation) {
    return null;
  }

  const label = localize('com_ui_select_agent');
  const displayName = agentName ?? selectedName;

  const renderTriggerIcon = () => {
    if (agentAvatarUrl) {
      return <img src={agentAvatarUrl} alt="" className="size-5 rounded-full object-cover" />;
    }
    if (selectedAgentId) {
      return (
        agentsEndpoint?.icon ?? <Bot className="text-text-primary size-5" aria-hidden="true" />
      );
    }
    return <Brain className="text-text-primary size-5" aria-hidden="true" />;
  };

  const trigger = (
    <TooltipAnchor
      aria-label={label}
      description={label}
      render={
        <button
          data-testid="domain-selector-button"
          aria-label={label}
          className="border-border-light bg-presentation text-text-primary hover:bg-surface-active-alt my-1 flex h-9 w-full max-w-[70vw] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm"
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
        {agentsEndpoint && <AgentItems endpoint={agentsEndpoint} />}
      </Menu>
    </div>
  );
}

export default DomainSelector;
