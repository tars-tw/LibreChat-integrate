import React from 'react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import DomainSelector from '../DomainSelector';

const mockSelectDomain = jest.fn();
let mockDomains: Array<{ id: number; name: string }> = [];
let mockSelectedId = '100';
let mockSelectedAgentId: string | null = null;
let mockAgentsEndpoint:
  | { value: string; label: string; agentNames?: Record<string, string> }
  | undefined;
let mockMappedEndpoints: Array<{ value: string; models?: Array<{ name: string }> }>;

jest.mock('../domain', () => ({
  useTarsDomain: () => ({
    domains: mockDomains,
    generalDomainId: '100',
    selectedId: mockSelectedId,
    selectedName: mockDomains.find((d) => String(d.id) === mockSelectedId)?.name,
    selectedAgentId: mockSelectedAgentId,
    selectDomain: mockSelectDomain,
    isGeneralDomain: mockSelectedId === '100',
  }),
}));

jest.mock('../../Endpoints/ModelSelectorContext', () => ({
  useModelSelectorContext: () => ({
    agentsEndpoint: mockAgentsEndpoint,
    agentsMap: { agent_1: { name: '簡報高手' } },
    mappedEndpoints: mockMappedEndpoints,
  }),
}));

jest.mock('../AgentItems', () => ({
  __esModule: true,
  default: ({ endpoint }: { endpoint: { label: string } }) => (
    <div data-testid="agents-endpoint">{endpoint.label}</div>
  ),
}));

jest.mock('@librechat/client', () => ({
  // Ariakit hands MenuButton's props to this element; forward them to the real button
  // so the trigger stays clickable.
  TooltipAnchor: ({
    render: node,
    description: _description,
    ...props
  }: {
    render: React.ReactElement;
    description?: string;
  }) => jest.requireActual('react').cloneElement(node, { ...props, children: node.props.children }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => ({ com_ui_select_agent: '選擇 Agent' })[key] ?? key,
}));

const openMenu = async () => {
  await userEvent.click(screen.getByTestId('domain-selector-button'));
};

describe('DomainSelector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedId = '100';
    mockSelectedAgentId = null;
    mockAgentsEndpoint = { value: 'agents', label: 'My Agents' };
    mockMappedEndpoints = [{ value: 'openAI', models: [{ name: 'gpt-4o' }] }];
    mockDomains = [
      { id: 100, name: '通用腦' },
      { id: 201, name: 'HR AI助手' },
      { id: 202, name: 'CRUD' },
    ];
  });

  it('renders nothing when no domains are available', () => {
    mockDomains = [];
    const { container } = render(<DomainSelector />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels the trigger with the bound brain', () => {
    render(<DomainSelector />);
    expect(screen.getByTestId('domain-selector-button')).toHaveTextContent('通用腦');
  });

  it('names the trigger as the agent picker', () => {
    render(<DomainSelector />);
    expect(screen.getByTestId('domain-selector-button')).toHaveAttribute(
      'aria-label',
      '選擇 Agent',
    );
  });

  it('lists only the general brain and agents', async () => {
    render(<DomainSelector />);
    await openMenu();

    const rows = screen.getAllByRole('menuitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('通用腦');
    expect(screen.getByTestId('agents-endpoint')).toHaveTextContent('My Agents');
    expect(screen.queryByText('HR AI助手')).not.toBeInTheDocument();
    expect(screen.queryByText('CRUD')).not.toBeInTheDocument();
  });

  it('renders nothing on an older specialized-brain conversation without an agent', () => {
    mockSelectedId = '201';
    const { container } = render(<DomainSelector />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on an older Workflow-agent conversation', () => {
    mockSelectedAgentId = 'agent_langflow_tars_flow';
    const { container } = render(<DomainSelector />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the picker for an agent bound to a specialized brain', () => {
    mockSelectedId = '201';
    mockSelectedAgentId = 'agent_1';
    render(<DomainSelector />);
    expect(screen.getByTestId('domain-selector-button')).toHaveTextContent('簡報高手');
  });

  it('labels the trigger with the selected agent instead of the brain', () => {
    mockSelectedAgentId = 'agent_1';
    render(<DomainSelector />);
    expect(screen.getByTestId('domain-selector-button')).toHaveTextContent('簡報高手');
    expect(screen.getByTestId('domain-selector-button')).not.toHaveTextContent('通用腦');
  });

  it('prefers the agents endpoint name over the agents map', () => {
    mockSelectedAgentId = 'agent_1';
    mockAgentsEndpoint = {
      value: 'agents',
      label: 'My Agents',
      agentNames: { agent_1: '簡報大師' },
    };
    render(<DomainSelector />);
    expect(screen.getByTestId('domain-selector-button')).toHaveTextContent('簡報大師');
  });

  it('drops the brain checkmark while an agent is selected', async () => {
    mockSelectedAgentId = 'agent_1';
    render(<DomainSelector />);
    await openMenu();

    expect(screen.getAllByRole('menuitem')[0]).not.toHaveAttribute('aria-selected');
  });

  it('hands the brain a default model when leaving an agent', async () => {
    mockSelectedAgentId = 'agent_1';
    render(<DomainSelector />);
    await openMenu();

    await userEvent.click(screen.getByText('通用腦'));
    expect(mockSelectDomain).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({ endpoint: 'openAI', model: 'gpt-4o', agent_id: undefined }),
    );
  });

  it('omits the agents row when no agents endpoint is available', async () => {
    mockAgentsEndpoint = undefined;
    render(<DomainSelector />);
    await openMenu();

    expect(screen.queryByTestId('agents-endpoint')).not.toBeInTheDocument();
  });
});
