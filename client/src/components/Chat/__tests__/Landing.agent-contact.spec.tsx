import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Landing from '../Landing';

let mockConversation: Record<string, unknown> | null = null;
let mockAgentsMap: Record<string, any> | undefined;
let mockAssistantMap: Record<string, any> | undefined;
let mockDomains: Array<{ id: number; name: string; description?: string | null }> = [];

jest.mock('@react-spring/web', () => ({
  easings: {
    easeOutCubic: jest.fn(),
  },
}));

jest.mock('librechat-data-provider', () => ({
  EModelEndpoint: {
    azureOpenAI: 'azureOpenAI',
    openAI: 'openAI',
  },
  isAgentsEndpoint: (endpoint?: string | null) => endpoint === 'agents',
  isEphemeralAgentId: (agentId?: string | null) => agentId === 'ephemeral',
}));

jest.mock('@librechat/client', () => ({
  BirthdayIcon: () => <span data-testid="birthday-icon" />,
  TooltipAnchor: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SplitText: ({ text }: { text: string }) => <span>{text}</span>,
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: mockConversation }),
  useAgentsMapContext: () => mockAgentsMap,
  useAssistantsMapContext: () => mockAssistantMap,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: {} } }),
  useGetEndpointsQuery: () => ({ data: {} }),
  useTarsDomainsQuery: () => ({ data: mockDomains }),
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: undefined }),
  useGreeting: () => 'Welcome',
  useLocalize: () => (key: string) => {
    const translations: Record<string, string> = {
      com_agents_contact: 'Contact',
      com_agents_no_contact_available: 'No contact available',
    };
    return translations[key] || key;
  },
}));

jest.mock('~/utils', () => ({
  CONFIG_HTML_MEDIA_ATTR: {},
  CONFIG_HTML_MEDIA_TAGS: [],
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
  createConfigHtmlSanitizer: () => (html: string) => html,
  getIconEndpoint: ({ endpoint }: { endpoint: string }) => endpoint,
  getModelSpec: () => undefined,
  getEntity: ({
    endpoint,
    agentsMap,
    assistantMap,
    agent_id,
    assistant_id,
  }: {
    endpoint: string;
    agentsMap?: Record<string, any>;
    assistantMap?: Record<string, any>;
    agent_id?: string;
    assistant_id?: string;
  }) => {
    if (endpoint === 'agents' && agent_id != null) {
      return { entity: agentsMap?.[agent_id], isAgent: true, isAssistant: false };
    }
    if (assistant_id != null) {
      return { entity: assistantMap?.[assistant_id], isAgent: false, isAssistant: true };
    }
    return { entity: undefined, isAgent: false, isAssistant: false };
  },
}));

jest.mock('~/components/Endpoints/ConvoIcon', () => () => <span data-testid="convo-icon" />);

describe('Landing agent contact', () => {
  beforeEach(() => {
    mockConversation = null;
    mockAgentsMap = undefined;
    mockAssistantMap = undefined;
    mockDomains = [];
  });

  it('shows contact for the selected agent from agentsMap', () => {
    mockConversation = {
      endpoint: 'agents',
      agent_id: 'agent-1',
    };
    mockAgentsMap = {
      'agent-1': {
        id: 'agent-1',
        name: 'Portal Remote Agent',
        description: 'Remote Agent Showcase',
        owner_contact: { name: 'Owner User' },
      },
    };

    render(<Landing centerFormOnLanding={false} />);

    expect(screen.getByText('Portal Remote Agent')).toBeInTheDocument();
    expect(screen.getByText('Remote Agent Showcase')).toBeInTheDocument();
    expect(screen.getByText('Contact:')).toBeInTheDocument();
    expect(screen.getByText('Owner User')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Owner User' })).not.toBeInTheDocument();
  });

  it('does not show contact when the selected agent is missing from agentsMap', () => {
    mockConversation = {
      endpoint: 'agents',
      agent_id: 'missing-agent',
      greeting: 'Start chatting',
    };
    mockAgentsMap = {};

    render(<Landing centerFormOnLanding={false} />);

    expect(screen.queryByText('Contact:')).not.toBeInTheDocument();
    expect(screen.queryByText('No contact available')).not.toBeInTheDocument();
  });

  it('titles the landing with the agent, not the bound brain', () => {
    mockDomains = [{ id: 100, name: '通用腦' }];
    mockConversation = {
      endpoint: 'agents',
      agent_id: 'agent-1',
    };
    mockAgentsMap = {
      'agent-1': { id: 'agent-1', name: '簡報高手', description: '我超級會做簡報的唷!' },
    };

    render(<Landing centerFormOnLanding={false} />);

    expect(screen.getByText('簡報高手')).toBeInTheDocument();
    expect(screen.queryByText('通用腦')).not.toBeInTheDocument();
  });

  it('titles the landing with the bound brain when no agent is selected', () => {
    mockDomains = [{ id: 100, name: '通用腦' }];
    mockConversation = { endpoint: 'openAI', model: 'gpt-4o' };

    render(<Landing centerFormOnLanding={false} />);

    expect(screen.getByText('通用腦')).toBeInTheDocument();
  });

  it("describes the landing with the bound brain's description", () => {
    mockDomains = [{ id: 100, name: '通用腦', description: '什麼都問得到' }];
    mockConversation = { endpoint: 'openAI', model: 'gpt-4o', greeting: 'Start chatting' };

    render(<Landing centerFormOnLanding={false} />);

    expect(screen.getByText('什麼都問得到')).toBeInTheDocument();
    expect(screen.queryByText('Start chatting')).not.toBeInTheDocument();
  });

  it('falls back to the greeting when the brain has no description', () => {
    mockDomains = [{ id: 100, name: '通用腦', description: null }];
    mockConversation = { endpoint: 'openAI', model: 'gpt-4o', greeting: 'Start chatting' };

    render(<Landing centerFormOnLanding={false} />);

    expect(screen.getByText('Start chatting')).toBeInTheDocument();
  });

  it("keeps the agent's description ahead of the brain's", () => {
    mockDomains = [{ id: 100, name: '通用腦', description: '什麼都問得到' }];
    mockConversation = { endpoint: 'agents', agent_id: 'agent-1' };
    mockAgentsMap = {
      'agent-1': { id: 'agent-1', name: '簡報高手', description: '我超級會做簡報的唷!' },
    };

    render(<Landing centerFormOnLanding={false} />);

    expect(screen.getByText('我超級會做簡報的唷!')).toBeInTheDocument();
    expect(screen.queryByText('什麼都問得到')).not.toBeInTheDocument();
  });

  it('does not show contact for assistants', () => {
    mockConversation = {
      endpoint: 'assistants',
      assistant_id: 'assistant-1',
    };
    mockAssistantMap = {
      'assistant-1': {
        id: 'assistant-1',
        name: 'Assistant',
        description: 'Assistant description',
      },
    };

    render(<Landing centerFormOnLanding={false} />);

    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.queryByText('Contact:')).not.toBeInTheDocument();
  });
});
