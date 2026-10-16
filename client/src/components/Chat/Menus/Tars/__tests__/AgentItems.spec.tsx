import React from 'react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { Endpoint } from '~/common';
import AgentItems from '../AgentItems';

const mockSetEndpointSearchValue = jest.fn();
let mockSearchValue = '';

jest.mock('../../Endpoints/ModelSelectorContext', () => ({
  useModelSelectorContext: () => ({
    selectedValues: { endpoint: 'agents', model: 'agent_local_1', modelSpec: '' },
    endpointSearchValues: { agents: mockSearchValue },
    setEndpointSearchValue: mockSetEndpointSearchValue,
  }),
}));

jest.mock('../../Endpoints/components/EndpointModelItem', () => ({
  EndpointModelItem: ({ modelId }: { modelId: string }) => (
    <div role="menuitem" data-testid={`agent-row-${modelId}`}>
      {modelId}
    </div>
  ),
}));

const mockToggleFavoriteAgent = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useFavorites: () => ({
    isFavoriteAgent: () => false,
    toggleFavoriteAgent: mockToggleFavoriteAgent,
  }),
}));

const endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: true,
  icon: null,
  models: [{ name: 'agent_local_1' }, { name: 'agent_langflow_simple' }, { name: 'agent_local_2' }],
  agentNames: {
    agent_local_1: '簡報高手',
    agent_langflow_simple: 'Workflow · Simple Agent',
    agent_local_2: 'RAG 助手',
  },
} as Endpoint;

const openMenu = async () => {
  await userEvent.click(screen.getByText('My Agents'));
};

describe('AgentItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchValue = '';
  });

  it('lists the Agent Builder agents in one list sorted by name', async () => {
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    const rows = screen.getAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual(['agent_local_2', 'agent_local_1']);
  });

  it('leaves out Workflow agents mirrored from Langflow', async () => {
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    expect(screen.queryByTestId('agent-row-agent_langflow_simple')).not.toBeInTheDocument();
  });

  it('has no marketplace shortcut', async () => {
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    expect(screen.queryByTestId('model-selector-marketplace-item')).not.toBeInTheDocument();
    expect(screen.queryByText('com_agents_marketplace')).not.toBeInTheDocument();
  });

  it('filters the list by the search term', async () => {
    mockSearchValue = 'rag';
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    expect(screen.getByTestId('agent-row-agent_local_2')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-agent_local_1')).not.toBeInTheDocument();
  });

  it('keeps Workflow agents out of search results', async () => {
    mockSearchValue = 'workflow';
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    expect(screen.queryByTestId('agent-row-agent_langflow_simple')).not.toBeInTheDocument();
  });
});
