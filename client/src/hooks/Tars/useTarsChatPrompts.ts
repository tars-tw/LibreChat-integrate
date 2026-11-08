import { useMemo } from 'react';
import { hasTarsKnowledgeSearch } from 'librechat-data-provider';
import type { TTarsPromptsResponse } from 'librechat-data-provider';
import type { QueryObserverResult } from '@tanstack/react-query';
import {
  useGetAgentByIdQuery,
  useGetStartupConfig,
  useTarsChatPromptsQuery,
} from '~/data-provider';
import { useSelectedTarsDomain } from '~/components/Chat/Menus/Tars/domain';
import { useAuthContext } from '~/hooks/AuthContext';

const NONE: readonly string[] = [];

/** Whether the signed-in account is linked to pwc_tars, which is who 我的提示 is for. */
export function useIsTarsLinkedUser(): boolean {
  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  return startupConfig?.tarsAuth === true && user?.provider === 'tars';
}

/**
 * The chat's 我的提示 (composer panel, `/` commands, side panel): personal prompts plus
 * those of the knowledge bases the selected agent's 知識庫檢索 picked, while that tool is
 * on. An agent binds no 專用腦, so there is no brain tier, and a chat without an agent
 * lists personal prompts only. Waits for the agent before asking, so the list is fetched
 * once rather than once without its knowledge bases and again with them.
 */
export default function useTarsChatPrompts(
  enabled = true,
): QueryObserverResult<TTarsPromptsResponse> & { isTarsUser: boolean } {
  const isTarsUser = useIsTarsLinkedUser();
  const { selectedAgentId } = useSelectedTarsDomain();
  const agentQuery = useGetAgentByIdQuery(selectedAgentId);
  const agent = agentQuery.data;
  const knowledgeBaseIds = useMemo(
    () =>
      agent && hasTarsKnowledgeSearch(agent.tools)
        ? (agent.tars_knowledge_bases?.rag_agent ?? NONE)
        : NONE,
    [agent],
  );
  const agentSettled = selectedAgentId == null || agentQuery.isFetched;
  const query = useTarsChatPromptsQuery(knowledgeBaseIds, {
    enabled: enabled && isTarsUser && agentSettled,
  });
  return { ...query, isTarsUser };
}
