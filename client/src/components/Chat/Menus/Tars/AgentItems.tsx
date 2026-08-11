import { useMemo, useCallback } from 'react';
import { VisuallyHidden } from '@ariakit/react';
import { CheckCircle2, Workflow } from 'lucide-react';
import type { Endpoint } from '~/common';
import { CustomMenu as Menu } from '../Endpoints/CustomMenu';
import { useModelSelectorContext } from '../Endpoints/ModelSelectorContext';
import { EndpointModelItem } from '../Endpoints/components/EndpointModelItem';
import { useFavorites, useLocalize } from '~/hooks';

/**
 * Langflow flows are mirrored into agents with a deterministic id
 * (`api/server/services/langflow/reconcile.js` → `agent_langflow_<action>`), which is the
 * only marker that survives to the client — the agent record itself looks local otherwise.
 */
const LANGFLOW_AGENT_ID_PREFIX = 'agent_langflow_';

const isLangflowAgent = (agentId: string) => agentId.startsWith(LANGFLOW_AGENT_ID_PREFIX);

/**
 * The agents submenu of the brain picker. Lists every agent the marketplace would list
 * (the endpoint is loaded with view permissions) in one name-sorted list, so the menu
 * replaces the marketplace shortcut it used to host; the icon marks each agent's kind.
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
              <CheckCircle2 className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
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
          icon={
            isLangflowAgent(agent.id) ? (
              <Workflow className="size-5 text-text-primary" aria-hidden="true" />
            ) : undefined
          }
        />
      ))}
    </Menu>
  );
}

export default AgentItems;
