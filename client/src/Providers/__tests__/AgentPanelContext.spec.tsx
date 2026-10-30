import React from 'react';
import { RecoilRoot } from 'recoil';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentPanelProvider, useAgentPanelContext } from '../AgentPanelContext';

const mockServerManager = jest.fn();
const mockToolsQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  useAvailableToolsQuery: () => ({ data: [] }),
  useGetActionsQuery: () => ({ data: [] }),
  useGetStartupConfig: () => ({ data: {} }),
  useMCPToolsQuery: () => mockToolsQuery(),
}));

jest.mock('~/hooks', () => ({
  useMCPServerManager: () => mockServerManager(),
  useGetAgentsConfig: () => ({ agentsConfig: {}, endpointsConfig: {} }),
  activateCatalog: jest.fn(),
  useCatalogReady: () => true,
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/hooks/MCP/useMCPRefresh', () => ({ useMCPRefresh: jest.fn() }));

const server = (name: string) => ({ name, icon: '', tools: [], authConfig: [] });

function ServerNames() {
  const { mcpServersMap } = useAgentPanelContext();
  return <div data-testid="servers">{Array.from(mcpServersMap.keys()).sort().join(',')}</div>;
}

const renderServers = () =>
  render(
    <RecoilRoot>
      <MemoryRouter>
        <AgentPanelProvider>
          <ServerNames />
        </AgentPanelProvider>
      </MemoryRouter>
    </RecoilRoot>,
  ).getByTestId('servers').textContent;

describe('AgentPanelProvider mcpServersMap', () => {
  beforeEach(() => {
    mockServerManager.mockReturnValue({
      availableMCPServers: [{ serverName: 'tars_assigned' }, { serverName: 'workflow' }],
      availableMCPServersMap: {},
      connectionStatus: {},
      isLoading: false,
    });
    mockToolsQuery.mockReturnValue({
      data: {
        servers: {
          tars_assigned: server('tars_assigned'),
          tars_unassigned: server('tars_unassigned'),
          removed: server('removed'),
        },
      },
      isFetching: false,
    });
  });

  it('drops a tars entry the server manager hid, but no other unconfigured server', () => {
    expect(renderServers()).toBe('removed,tars_assigned,workflow');
  });
});
