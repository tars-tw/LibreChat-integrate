import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import McpShareBlocks from '../McpShareBlocks';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}(${Object.values(values).join('|')})` : key,
}));

const gap = (no_access: boolean, tool_names: string[]) => ({
  mcp_server_id: 's1',
  server_name: 'Maps',
  no_access,
  tool_names,
});

const renderBlocks = (servers: ReturnType<typeof gap>[]) =>
  render(
    <McpShareBlocks
      blocks={[{ principal_type: 'group', idOnTheSource: 'g1', name: 'UAT', servers }]}
    />,
  );

describe('McpShareBlocks', () => {
  it('names a server that was never assigned, without listing its tools', () => {
    renderBlocks([gap(true, ['a', 'b'])]);

    expect(screen.getByText('UAT')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent(
      'UAT: com_ui_tars_mcp_share_gap_server(Maps)',
    );
  });

  it('lists the missing tools of a partly assigned server', () => {
    renderBlocks([gap(false, ['a', 'b'])]);

    expect(screen.getByRole('listitem')).toHaveTextContent(
      'com_ui_tars_mcp_share_gap_tools(Maps|a, b)',
    );
  });

  it('caps a long tool list at three and states the total', () => {
    renderBlocks([gap(false, ['a', 'b', 'c', 'd', 'e'])]);

    expect(screen.getByRole('listitem')).toHaveTextContent(
      'com_ui_tars_mcp_share_gap_tools(Maps|com_ui_tars_mcp_share_gap_more(a, b, c|5))',
    );
  });
});
