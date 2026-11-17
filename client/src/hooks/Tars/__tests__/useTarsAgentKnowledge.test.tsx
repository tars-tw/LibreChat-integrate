import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { Constants, dataService } from 'librechat-data-provider';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent, TStartupConfig, TTarsChatKnowledgeBase } from 'librechat-data-provider';
import useTarsAgentKnowledge, {
  reachableTarsKnowledgeBases,
  toggleTarsKnowledgeSelection,
} from '../useTarsAgentKnowledge';
import { tarsKnowledgeSearchPicks } from '../useTarsChatPrompts';
import { ephemeralAgentByConvoId } from '~/store';

/**
 * A saved agent's 知識庫檢索 chip: the agent searches every pick until the user brings the
 * chip up, which starts all checked, narrows to what stays checked (never below one), and
 * goes back to every pick when removed. A new chat starts from every pick again.
 */

jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, values?: Record<string, number>) =>
    values ? `${key}:${values.selected}/${values.total}` : key,
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ user: { provider: 'tars' } }),
}));

const chatList: TTarsChatKnowledgeBase[] = [
  { id: 'kb-rules', name: '公司規範知識庫' },
  { id: 'kb-env', name: '097內規比對(環安)' },
  { id: 'kb-hr', name: '人資知識庫' },
];

describe('tarsKnowledgeSearchPicks', () => {
  it("reads 知識庫檢索's picks, and needs the search among tools only when tools are known", () => {
    const picks = { rag_agent: ['kb-rules'], sql_agent: ['kb-erp'] };

    expect(tarsKnowledgeSearchPicks({ tars_knowledge_bases: picks } as Agent)).toEqual([
      'kb-rules',
    ]);
    expect(
      tarsKnowledgeSearchPicks({
        tools: ['tars_knowledge_search'],
        tars_knowledge_bases: picks,
      } as Agent),
    ).toEqual(['kb-rules']);
    expect(
      tarsKnowledgeSearchPicks({ tools: ['tars_sql_query'], tars_knowledge_bases: picks } as Agent),
    ).toEqual([]);
    expect(
      tarsKnowledgeSearchPicks({ tars_knowledge_bases: { sql_agent: ['kb'] } } as Agent),
    ).toEqual([]);
    expect(tarsKnowledgeSearchPicks(undefined)).toEqual([]);
  });
});

describe('reachableTarsKnowledgeBases', () => {
  it("keeps the agent's order and drops picks off the user's chat list", () => {
    expect(
      reachableTarsKnowledgeBases(['kb-env', 'kb-gone', 'kb-rules', 'kb-env'], chatList).map(
        (kb) => kb.id,
      ),
    ).toEqual(['kb-env', 'kb-rules']);
    expect(reachableTarsKnowledgeBases(['kb-env'], undefined)).toEqual([]);
  });
});

describe('toggleTarsKnowledgeSelection', () => {
  const order = ['kb-rules', 'kb-env', 'kb-hr'];

  it("unchecks and rechecks in the agent's order", () => {
    expect(toggleTarsKnowledgeSelection(order, 'kb-env', order)).toEqual(['kb-rules', 'kb-hr']);
    expect(toggleTarsKnowledgeSelection(['kb-hr'], 'kb-rules', order)).toEqual([
      'kb-rules',
      'kb-hr',
    ]);
  });

  it('never unchecks the last one', () => {
    expect(toggleTarsKnowledgeSelection(['kb-env'], 'kb-env', order)).toBeNull();
  });
});

describe('useTarsAgentKnowledge', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    jest
      .spyOn(dataService, 'getStartupConfig')
      .mockResolvedValue({ tarsAuth: true } as TStartupConfig);
    jest
      .spyOn(dataService, 'getTarsChatKnowledgeBases')
      .mockResolvedValue({ knowledgeBases: chatList });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const agentPicking = (rag: string[]) =>
    jest.spyOn(dataService, 'getAgentById').mockResolvedValue({
      id: 'agent_rules',
      name: '規範助理',
      tars_knowledge_bases: { rag_agent: rag },
    } as Agent);

  const renderEntry = (props: {
    conversationId: string;
    agentId?: string | null;
    enabled?: boolean;
  }) => {
    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <RecoilRoot>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </RecoilRoot>
    );
    return renderHook(
      ({ conversationId, agentId, enabled = true }) => ({
        entry: useTarsAgentKnowledge({ conversationId, agentId, enabled }),
        ephemeralAgent: useRecoilValue(ephemeralAgentByConvoId(conversationId)),
      }),
      { wrapper, initialProps: props },
    );
  };

  it('offers the row off by default, then a chip with every pick checked', async () => {
    agentPicking(['kb-rules', 'kb-env']);
    const { result } = renderEntry({ conversationId: 'convo-1', agentId: 'agent_rules' });

    await waitFor(() => expect(result.current.entry).not.toBeNull());
    expect(result.current.entry).toMatchObject({
      label: 'com_ui_tars_rag_agent',
      section: 'tool',
      active: false,
      favoritable: false,
    });
    expect(result.current.entry?.toolModes).toBeUndefined();
    expect(result.current.ephemeralAgent).toBeNull();

    act(() => result.current.entry?.onSelect());

    expect(result.current.ephemeralAgent?.tars_rag_selection).toEqual({
      agent_id: 'agent_rules',
      knowledge_base_ids: ['kb-rules', 'kb-env'],
    });
    expect(result.current.entry?.active).toBe(true);
    expect(result.current.entry?.toolModesSummary).toBe('com_ui_tars_rag_agent_count:2/2');
    expect(
      result.current.entry?.toolModes?.map(({ label, active }) => ({ label, active })),
    ).toEqual([
      { label: '公司規範知識庫', active: true },
      { label: '097內規比對(環安)', active: true },
    ]);
  });

  it('narrows to what stays checked, keeps one, and goes back to every pick on removal', async () => {
    agentPicking(['kb-rules', 'kb-env']);
    const { result } = renderEntry({ conversationId: 'convo-1', agentId: 'agent_rules' });
    await waitFor(() => expect(result.current.entry).not.toBeNull());
    act(() => result.current.entry?.onSelect());

    act(() => result.current.entry?.toolModes?.[1].onSelect());
    expect(result.current.ephemeralAgent?.tars_rag_selection?.knowledge_base_ids).toEqual([
      'kb-rules',
    ]);
    expect(result.current.entry?.toolModesSummary).toBe('com_ui_tars_rag_agent_count:1/2');

    act(() => result.current.entry?.toolModes?.[0].onSelect());
    expect(result.current.ephemeralAgent?.tars_rag_selection?.knowledge_base_ids).toEqual([
      'kb-rules',
    ]);

    act(() => result.current.entry?.onSelect());
    expect(result.current.ephemeralAgent?.tars_rag_selection).toBeNull();
    expect(result.current.entry?.active).toBe(false);

    act(() => result.current.entry?.onSelect());
    expect(result.current.ephemeralAgent?.tars_rag_selection?.knowledge_base_ids).toEqual([
      'kb-rules',
      'kb-env',
    ]);
  });

  it('shows a single pick locked on', async () => {
    agentPicking(['kb-env']);
    const { result } = renderEntry({ conversationId: 'convo-1', agentId: 'agent_rules' });
    await waitFor(() => expect(result.current.entry).not.toBeNull());
    act(() => result.current.entry?.onSelect());

    act(() => result.current.entry?.toolModes?.[0].onSelect());

    expect(result.current.entry?.toolModes).toHaveLength(1);
    expect(result.current.entry?.toolModes?.[0].active).toBe(true);
    expect(result.current.ephemeralAgent?.tars_rag_selection?.knowledge_base_ids).toEqual([
      'kb-env',
    ]);
  });

  it("lists only the picks on the user's chat list, and nothing when none are", async () => {
    agentPicking(['kb-rules', 'kb-gone']);
    const { result } = renderEntry({ conversationId: 'convo-1', agentId: 'agent_rules' });
    await waitFor(() => expect(result.current.entry).not.toBeNull());
    act(() => result.current.entry?.onSelect());
    expect(result.current.entry?.toolModes?.map((mode) => mode.label)).toEqual(['公司規範知識庫']);

    agentPicking(['kb-gone']);
    queryClient.clear();
    const other = renderEntry({ conversationId: 'convo-2', agentId: 'agent_rules' });
    await waitFor(() => expect(dataService.getTarsChatKnowledgeBases).toHaveBeenCalled());
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(other.result.current.entry).toBeNull();
  });

  it('stays out of ephemeral chats and when disabled', async () => {
    const getAgent = agentPicking(['kb-rules']);

    const ephemeral = renderEntry({
      conversationId: 'convo-1',
      agentId: String(Constants.EPHEMERAL_AGENT_ID),
    });
    const disabled = renderEntry({
      conversationId: 'convo-2',
      agentId: 'agent_rules',
      enabled: false,
    });

    await waitFor(() => expect(dataService.getStartupConfig).toHaveBeenCalled());
    expect(getAgent).not.toHaveBeenCalled();
    expect(ephemeral.result.current.entry).toBeNull();
    expect(disabled.result.current.entry).toBeNull();
  });

  it('ignores a selection made for another agent', async () => {
    agentPicking(['kb-rules', 'kb-env']);
    const { result, rerender } = renderEntry({
      conversationId: 'convo-1',
      agentId: 'agent_rules',
    });
    await waitFor(() => expect(result.current.entry).not.toBeNull());
    act(() => result.current.entry?.onSelect());

    jest.spyOn(dataService, 'getAgentById').mockResolvedValue({
      id: 'agent_other',
      name: '其他',
      tars_knowledge_bases: { rag_agent: ['kb-rules', 'kb-hr'] },
    } as Agent);
    rerender({ conversationId: 'convo-1', agentId: 'agent_other' });

    await waitFor(() => expect(result.current.entry?.toolModes).toBeUndefined());
    expect(result.current.entry?.active).toBe(false);
  });

  it('starts a new chat from every pick', async () => {
    agentPicking(['kb-rules', 'kb-env']);
    const { result, rerender } = renderEntry({
      conversationId: String(Constants.NEW_CONVO),
      agentId: 'agent_rules',
    });
    await waitFor(() => expect(result.current.entry).not.toBeNull());
    act(() => result.current.entry?.onSelect());
    act(() => result.current.entry?.toolModes?.[1].onSelect());
    expect(result.current.entry?.active).toBe(true);

    rerender({ conversationId: 'convo-1', agentId: 'agent_rules' });
    rerender({ conversationId: String(Constants.NEW_CONVO), agentId: 'agent_rules' });

    await waitFor(() => expect(result.current.entry?.active).toBe(false));
    expect(result.current.ephemeralAgent?.tars_rag_selection).toBeNull();
  });
});
