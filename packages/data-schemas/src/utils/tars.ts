import { TARS_GENERAL_DOMAIN_ID, TARS_LANGFLOW_AGENT_ID_PREFIX } from 'librechat-data-provider';
import type { FilterQuery } from 'mongoose';
import type { IConversation } from '~/types';

/**
 * Conversations kept out of every conversation list: Workflow-agent chats (Langflow flows
 * mirrored into agents) and chats bound to a specialized brain (專用腦) without a saved
 * agent. The chat UI no longer starts either kind — a brain is reached through an agent
 * bound to it — so older ones are hidden rather than deleted and stay reachable by URL.
 * A missing `agent_id` or `domain_id` matches as "not hidden".
 */
export const buildTarsHiddenConversationFilter = (): FilterQuery<IConversation> =>
  ({
    agent_id: { $not: new RegExp(`^${TARS_LANGFLOW_AGENT_ID_PREFIX}`) },
    $nor: [
      {
        domain_id: { $exists: true, $nin: [null, '', String(TARS_GENERAL_DOMAIN_ID)] },
        agent_id: { $not: /^agent_/ },
      },
    ],
  }) as FilterQuery<IConversation>;
