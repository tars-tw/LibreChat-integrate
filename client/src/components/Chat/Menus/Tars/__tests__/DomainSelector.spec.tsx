import React from 'react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import DomainSelector from '../DomainSelector';

const mockSelectDomain = jest.fn();
let mockDomains: Array<{ id: number; name: string }> = [];
let mockSelectedId = '100';
let mockAgentsEndpoint: { value: string; label: string } | undefined;

jest.mock('../domain', () => ({
  useTarsDomain: () => ({
    domains: mockDomains,
    generalDomainId: '100',
    selectedId: mockSelectedId,
    selectedName: mockDomains.find((d) => String(d.id) === mockSelectedId)?.name,
    selectDomain: mockSelectDomain,
    isGeneralDomain: mockSelectedId === '100',
  }),
}));

jest.mock('../../Endpoints/ModelSelectorContext', () => ({
  useModelSelectorContext: () => ({ agentsEndpoint: mockAgentsEndpoint }),
}));

jest.mock('../../Endpoints/components/EndpointItem', () => ({
  EndpointItem: ({ endpoint }: { endpoint: { label: string } }) => (
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
  useLocalize: () => (key: string) =>
    ({ com_ui_tars_domains: '專用腦', com_ui_tars_domain_active: '使用中的專用腦' })[key] ?? key,
}));

const openMenu = async () => {
  await userEvent.click(screen.getByTestId('domain-selector-button'));
};

describe('DomainSelector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedId = '100';
    mockAgentsEndpoint = { value: 'agents', label: 'My Agents' };
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

  it('lists the general brain, the specialized submenu, then agents', async () => {
    render(<DomainSelector />);
    await openMenu();

    const rows = screen.getAllByRole('menuitem');
    expect(rows[0]).toHaveTextContent('通用腦');
    expect(rows[1]).toHaveTextContent('專用腦');
    expect(screen.getByTestId('agents-endpoint')).toHaveTextContent('My Agents');
  });

  it('keeps specialized brains out of the top level', async () => {
    render(<DomainSelector />);
    await openMenu();

    expect(screen.queryByText('HR AI助手')).not.toBeInTheDocument();
    expect(screen.queryByText('CRUD')).not.toBeInTheDocument();
  });

  it('selects the general brain from the top level', async () => {
    mockSelectedId = '201';
    render(<DomainSelector />);
    await openMenu();

    await userEvent.click(screen.getByText('通用腦'));
    expect(mockSelectDomain).toHaveBeenCalledWith('100');
  });

  it('omits the agents row when no agents endpoint is available', async () => {
    mockAgentsEndpoint = undefined;
    render(<DomainSelector />);
    await openMenu();

    expect(screen.queryByTestId('agents-endpoint')).not.toBeInTheDocument();
  });
});
