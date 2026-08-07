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
  EndpointModelItem: ({ modelId, icon }: { modelId: string; icon?: React.ReactNode }) => (
    <div role="menuitem" data-testid={`agent-row-${modelId}`}>
      {modelId}
      {icon != null && <span data-testid={`agent-icon-${modelId}`} />}
    </div>
  ),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: true,
  icon: null,
  models: [{ name: 'agent_local_1' }, { name: 'agent_langflow_simple' }, { name: 'agent_local_2' }],
  agentNames: {
    agent_local_1: '簡報高手',
    agent_langflow_simple: 'Langflow · Simple Agent',
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

  it('lists every agent in one list sorted by name', async () => {
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    const rows = screen.getAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'agent_langflow_simple',
      'agent_local_2',
      'agent_local_1',
    ]);
  });

  it('marks only Langflow agents with their own icon', async () => {
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    expect(screen.getByTestId('agent-icon-agent_langflow_simple')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-icon-agent_local_1')).not.toBeInTheDocument();
  });

  it('has no marketplace shortcut', async () => {
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    expect(screen.queryByTestId('model-selector-marketplace-item')).not.toBeInTheDocument();
    expect(screen.queryByText('com_agents_marketplace')).not.toBeInTheDocument();
  });

  it('filters the list by the search term', async () => {
    mockSearchValue = 'langflow';
    render(<AgentItems endpoint={endpoint} />);
    await openMenu();

    expect(screen.getByTestId('agent-row-agent_langflow_simple')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-row-agent_local_1')).not.toBeInTheDocument();
  });
});
