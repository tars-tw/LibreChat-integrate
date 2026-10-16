import { useMemo, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { VisuallyHidden } from '@ariakit/react';
import { isTarsLangflowAgentId } from 'librechat-data-provider';
import type { Endpoint } from '~/common';
import { EndpointModelItem } from '../Endpoints/components/EndpointModelItem';
import { useModelSelectorContext } from '../Endpoints/ModelSelectorContext';
import { CustomMenu as Menu } from '../Endpoints/CustomMenu';
import { useFavorites, useLocalize } from '~/hooks';

/**
 * The agents submenu of the brain picker. Lists the Agent Builder agents the marketplace
 * would list (the endpoint is loaded with view permissions) in one name-sorted list, so the
 * menu replaces the marketplace shortcut it used to host. Workflow agents mirrored from
 * Langflow flows are left out: a flow is used as a tool inside an agent, not chatted with.
 */
function AgentItems({ endpoint }: { endpoint: Endpoint }) {
  const localize = useLocalize();
  const { selectedValues, endpointSearchValues, setEndpointSearchValue } =
    useModelSelectorContext();
  /** Owned here rather than per row: each `useFavorites` call opens its own jotai and
   *  React Query subscriptions, which at agent-list scale is thousands of live ones. */
  const { isFavoriteAgent, toggleFavoriteAgent } = useFavorites();
  const { endpoint: selectedEndpoint, modelSpec: selectedSpec } = selectedValues;

  const searchValue = endpointSearchValues[endpoint.value] || '';

  const agents = useMemo(() => {
    const term = searchValue.trim().toLowerCase();
    const matches: Array<{ id: string; name: string }> = [];
    for (const model of endpoint.models ?? []) {
      if (isTarsLangflowAgentId(model.name)) {
        continue;
      }
      const name = endpoint.agentNames?.[model.name] ?? model.name;
      if (term && !name.toLowerCase().includes(term)) {
        continue;
      }
      matches.push({ id: model.name, name });
    }
    return matches.sort((a, b) => a.name.localeCompare(b.name));
  }, [endpoint.models, endpoint.agentNames, searchValue]);

  const isEndpointSelected = !selectedSpec && selectedEndpoint === endpoint.value;

  const onToggleFavorite = useCallback(
    (modelId: string) => toggleFavoriteAgent(modelId),
    [toggleFavoriteAgent],
  );

  return (
    <Menu
      id={`endpoint-${endpoint.value}-menu`}
      searchValue={searchValue}
      onSearch={(value) => setEndpointSearchValue(endpoint.value, value)}
      combobox={<input placeholder=" " />}
      comboboxLabel={localize('com_endpoint_search_var', { 0: endpoint.label })}
      label={
        <div className="group flex w-full min-w-0 items-center justify-between gap-1.5 py-1 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            {endpoint.icon && (
              <div className="flex shrink-0 items-center justify-center" aria-hidden="true">
                {endpoint.icon}
              </div>
            )}
            <span className="truncate text-left">{endpoint.label}</span>
          </div>
          {isEndpointSelected && (
            <>
              <CheckCircle2 className="text-text-primary size-4 shrink-0" aria-hidden="true" />
              <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
            </>
          )}
        </div>
      }
    >
      {agents.map((agent) => (
        <EndpointModelItem
          key={`agent-${agent.id}`}
          modelId={agent.id}
          endpoint={endpoint}
          isFavorite={isFavoriteAgent(agent.id)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </Menu>
  );
}

export default AgentItems;
