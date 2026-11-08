import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TTarsKnowledgeBaseShareGap } from 'librechat-data-provider';
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

const renderBlocks = (
  servers: ReturnType<typeof gap>[],
  knowledgeBases?: TTarsKnowledgeBaseShareGap[],
) =>
  render(
    <McpShareBlocks
      blocks={[
        {
          principal_type: 'group',
          idOnTheSource: 'g1',
          name: 'UAT',
          servers,
          knowledge_bases: knowledgeBases,
        },
      ]}
    />,
  );

const kb = (id: string, name: string): TTarsKnowledgeBaseShareGap => ({ id, name });

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

  it('names the knowledge bases the target may not use in chat', () => {
    renderBlocks([], [kb('kb1', 'HR'), kb('kb2', '規章')]);

    expect(screen.getByRole('listitem')).toHaveTextContent(
      'UAT: com_ui_tars_mcp_share_gap_knowledge_bases(HR、規章)',
    );
  });

  it('caps a long knowledge-base list at three and states the total', () => {
    renderBlocks(
      [],
      ['a', 'b', 'c', 'd'].map((name) => kb(name, name)),
    );

    expect(screen.getByRole('listitem')).toHaveTextContent(
      'com_ui_tars_mcp_share_gap_knowledge_bases(com_ui_tars_mcp_share_gap_more(a、b、c|4))',
    );
  });

  it('lists the knowledge bases ahead of the MCP gaps', () => {
    renderBlocks([gap(true, [])], [kb('kb1', 'HR')]);

    expect(screen.getByRole('listitem')).toHaveTextContent(
      'UAT: com_ui_tars_mcp_share_gap_knowledge_bases(HR), com_ui_tars_mcp_share_gap_server(Maps)',
    );
  });
});
