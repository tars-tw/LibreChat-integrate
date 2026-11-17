import React, { useMemo, useEffect, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import { BookOpen } from 'lucide-react';
import { Constants, isEphemeralAgentId } from 'librechat-data-provider';
import type { TTarsChatKnowledgeBase } from 'librechat-data-provider';
import type { PaletteEntry, PaletteMode } from '~/hooks/Input/usePaletteEntries';
import { useGetAgentByIdQuery, useTarsChatKnowledgeBasesQuery } from '~/data-provider';
import { useIsTarsLinkedUser, tarsKnowledgeSearchPicks } from './useTarsChatPrompts';
import { ephemeralAgentByConvoId } from '~/store';
import useLocalize from '~/hooks/useLocalize';

const NONE: readonly string[] = [];
const ENTRY_ID = 'tars_agent_knowledge';
/** The chat list changes only when an admin edits it, so a chat does not re-ask on every mount. */
const CHAT_LIST_STALE_MS = 60_000;

/** The picks the user may search, in the agent's order: a pick off their chat list reaches nothing. */
export function reachableTarsKnowledgeBases(
  picks: readonly string[],
  chatList: readonly TTarsChatKnowledgeBase[] | undefined,
): TTarsChatKnowledgeBase[] {
  if (picks.length === 0 || chatList == null || chatList.length === 0) {
    return [];
  }
  const byId = new Map(chatList.map((kb) => [kb.id, kb]));
  const seen = new Set<string>();
  const reachable: TTarsChatKnowledgeBase[] = [];
  for (const id of picks) {
    const kb = byId.get(id);
    if (kb != null && !seen.has(id)) {
      seen.add(id);
      reachable.push(kb);
    }
  }
  return reachable;
}

/**
 * The selection after one knowledge base is clicked, in the agent's order; null when nothing
 * changes. The last one stays on: the chip narrows the search and never turns it off.
 */
export function toggleTarsKnowledgeSelection(
  selected: readonly string[],
  id: string,
  order: readonly string[],
): string[] | null {
  const kept = new Set(selected);
  if (kept.has(id)) {
    if (kept.size <= 1) {
      return null;
    }
    kept.delete(id);
  } else {
    kept.add(id);
  }
  return order.filter((pick) => kept.has(pick));
}

/**
 * The composer's 知識庫檢索 entry on a saved agent's chat. The agent searches every knowledge
 * base it picked unless the user brings up the chip, which starts with all of them checked and
 * narrows the search to the ones left checked (`ephemeralAgent.tars_rag_selection`, applied by
 * the server within the agent's picks). Removing the chip goes back to all of them, and a new
 * chat always starts there: nothing is remembered beyond the conversation.
 */
export default function useTarsAgentKnowledge({
  conversationId,
  agentId,
  enabled,
}: {
  conversationId: string;
  agentId?: string | null;
  enabled: boolean;
}): PaletteEntry | null {
  const localize = useLocalize();
  const isTarsUser = useIsTarsLinkedUser();
  const savedAgentId =
    agentId != null && agentId !== '' && !isEphemeralAgentId(agentId) ? agentId : null;
  const active = enabled && isTarsUser && savedAgentId != null;

  const { data: agent } = useGetAgentByIdQuery(savedAgentId, { enabled: active });
  const picks = useMemo(() => (active ? tarsKnowledgeSearchPicks(agent) : NONE), [active, agent]);
  const { data: chatList } = useTarsChatKnowledgeBasesQuery({
    enabled: picks.length > 0,
    staleTime: CHAT_LIST_STALE_MS,
  });
  const bases = useMemo(() => reachableTarsKnowledgeBases(picks, chatList), [picks, chatList]);

  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(
    ephemeralAgentByConvoId(conversationId),
  );
  const selection = ephemeralAgent?.tars_rag_selection;
  const selectedIds = useMemo(() => {
    if (selection == null || selection.agent_id !== savedAgentId) {
      return NONE;
    }
    const wanted = new Set(selection.knowledge_base_ids);
    return bases.filter((kb) => wanted.has(kb.id)).map((kb) => kb.id);
  }, [selection, savedAgentId, bases]);

  const setSelection = useCallback(
    (ids: string[] | null) =>
      setEphemeralAgent((prev) => {
        if (ids == null || savedAgentId == null) {
          return prev?.tars_rag_selection == null ? prev : { ...prev, tars_rag_selection: null };
        }
        return {
          ...(prev ?? {}),
          tars_rag_selection: { agent_id: savedAgentId, knowledge_base_ids: ids },
        };
      }),
    [savedAgentId, setEphemeralAgent],
  );

  /* The new-chat slot outlives the chat it started (its state is copied onto the saved
     conversation, not moved), so a new chat would otherwise open still narrowed. */
  useEffect(() => {
    if (conversationId !== Constants.NEW_CONVO) {
      return;
    }
    setEphemeralAgent((prev) =>
      prev?.tars_rag_selection == null ? prev : { ...prev, tars_rag_selection: null },
    );
  }, [conversationId, setEphemeralAgent]);

  return useMemo(() => {
    if (!active || bases.length === 0) {
      return null;
    }
    const order = bases.map((kb) => kb.id);
    const chipOn = selectedIds.length > 0;
    const selected = new Set(selectedIds);
    const toolModes = chipOn
      ? bases.map<PaletteMode>((kb) => ({
          id: `kb_${kb.id}`,
          label: kb.name,
          active: selected.has(kb.id),
          onSelect: () => {
            const next = toggleTarsKnowledgeSelection(selectedIds, kb.id, order);
            if (next != null) {
              setSelection(next);
            }
          },
        }))
      : undefined;
    return {
      key: `builtin:${ENTRY_ID}`,
      itemType: 'builtin',
      itemId: ENTRY_ID,
      label: localize('com_ui_tars_rag_agent'),
      description: localize('com_ui_tars_rag_agent_hint'),
      icon: <BookOpen className="icon-md" aria-hidden="true" />,
      section: 'tool',
      active: chipOn,
      pinned: false,
      favoritable: false,
      onSelect: () => setSelection(chipOn ? null : order),
      toolModes,
      toolModesSummary: chipOn
        ? localize('com_ui_tars_rag_agent_count', {
            selected: selectedIds.length,
            total: bases.length,
          })
        : undefined,
    };
  }, [active, bases, selectedIds, setSelection, localize]);
}
