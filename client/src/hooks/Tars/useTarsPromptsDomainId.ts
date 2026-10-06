import { useSelectedTarsDomain } from '~/components/Chat/Menus/Tars/domain';
import { useGetAgentByIdQuery } from '~/data-provider';

/**
 * The 專用腦 whose prompts the chat lists. A saved agent picked from the brain
 * menu runs every turn against the brain its TARS tools are bound to
 * (`createBindTarsAgentDomain`), so its prompts follow that binding; an unbound
 * agent or a plain chat keeps the conversation's own brain.
 */
export default function useTarsPromptsDomainId(): string | null {
  const { domainId, selectedAgentId } = useSelectedTarsDomain();
  const { data: agent } = useGetAgentByIdQuery(selectedAgentId);
  return agent?.tars_domain_id || domainId;
}
