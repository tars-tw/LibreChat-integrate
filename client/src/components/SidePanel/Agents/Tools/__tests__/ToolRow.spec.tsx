import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, screen } from '@testing-library/react';
import type { McpItem, ToolItem } from '../items/types';
import ToolRow from '../ToolRow';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string>) =>
    options ? `${key}[${Object.values(options).join(',')}]` : key,
}));

jest.mock('@librechat/client', () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: React.ComponentProps<'button'> & { variant?: string }) => (
    <button {...props}>{children}</button>
  ),
}));

const item: McpItem = {
  kind: 'mcp',
  id: 'mcp-server',
  name: 'MCP server',
  description: '',
  iconKey: 'mcp',
  server: {
    serverName: 'mcp-server',
    tools: [],
    isConfigured: true,
    isConnected: true,
    metadata: {},
  } as never,
  toolCount: 0,
};

describe('ToolRow', () => {
  test('MCP action icons keep their color while hovered', () => {
    render(<ToolRow item={item} onInfo={jest.fn()} onRemove={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'com_ui_tools_configure' })).toHaveClass(
      'hover:text-text-secondary',
    );
    expect(screen.getByRole('button', { name: 'com_ui_tools_remove' })).toHaveClass(
      'hover:text-text-secondary',
    );
  });

  test('a tool missing its 模型金鑰管理 key shows the notice under its name', () => {
    const imageTool: ToolItem = {
      kind: 'tool',
      id: 'image_gen_oai',
      name: 'OpenAI Image Tools',
      description: '',
      iconKey: 'tool',
      plugin: {
        name: 'OpenAI Image Tools',
        pluginKey: 'image_gen_oai',
        missingKeyProvider: 'OpenAI',
      },
    };
    render(<ToolRow item={imageTool} onInfo={jest.fn()} onRemove={jest.fn()} />);

    expect(screen.getByText('com_ui_tools_missing_api_key[OpenAI]')).toHaveClass(
      'text-status-error',
    );
  });

  test('other rows show no missing-key notice', () => {
    render(<ToolRow item={item} onInfo={jest.fn()} onRemove={jest.fn()} />);
    expect(screen.queryByText(/com_ui_tools_missing_api_key/)).not.toBeInTheDocument();
  });
});
