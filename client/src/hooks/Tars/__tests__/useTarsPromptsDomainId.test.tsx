import React from 'react';
import { dataService } from 'librechat-data-provider';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent } from 'librechat-data-provider';
import useTarsPromptsDomainId from '../useTarsPromptsDomainId';

/**
 * The chat's prompts follow the 專用腦 a turn actually runs against: a selected
 * saved agent's bound brain, else the conversation's own.
 */

jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

let mockSelected: { domainId: string | null; selectedAgentId: string | null };

jest.mock('~/components/Chat/Menus/Tars/domain', () => ({
  useSelectedTarsDomain: () => mockSelected,
}));

const renderDomainId = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTarsPromptsDomainId(), { wrapper });
};

const agentWith = (tars_domain_id?: string | null) =>
  ({ id: 'agent_bound', name: 'Bound', tars_domain_id }) as Agent;

describe('useTarsPromptsDomainId', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the conversation's brain when no agent is selected", () => {
    const getAgent = jest.spyOn(dataService, 'getAgentById');
    mockSelected = { domainId: '100', selectedAgentId: null };

    const { result } = renderDomainId();

    expect(result.current).toBe('100');
    expect(getAgent).not.toHaveBeenCalled();
  });

  it("switches to the selected agent's bound brain", async () => {
    const getAgent = jest.spyOn(dataService, 'getAgentById').mockResolvedValue(agentWith('154'));
    mockSelected = { domainId: '100', selectedAgentId: 'agent_bound' };

    const { result } = renderDomainId();

    await waitFor(() => expect(result.current).toBe('154'));
    expect(getAgent).toHaveBeenCalledWith({ agent_id: 'agent_bound' });
  });

  it("keeps the conversation's brain for an agent that follows the chat", async () => {
    const getAgent = jest.spyOn(dataService, 'getAgentById').mockResolvedValue(agentWith(null));
    mockSelected = { domainId: '100', selectedAgentId: 'agent_bound' };

    const { result } = renderDomainId();

    await waitFor(() => expect(getAgent).toHaveBeenCalled());
    expect(result.current).toBe('100');
  });
});
