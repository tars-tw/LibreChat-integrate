import { workflowMcpServerName } from 'librechat-data-provider';
import type { AgentItem } from '../types';
import { SECTION_LABEL_KEYS, countBySection, itemSection } from '../sections';
import { makeMcpServer, makePlugin } from 'test/itemFactories';
import { applyFilter } from '../filtering';
import { getIconForItem } from '../icons';

const mcpItem = (id: string, name = id): AgentItem => ({
  kind: 'mcp',
  id,
  name,
  description: '',
  iconKey: 'mcp',
  server: makeMcpServer({ serverName: id }),
  toolCount: 1,
});

const workflowId = workflowMcpServerName('0a1b2c3d-0000-4000-8000-000000000000');
const items: AgentItem[] = [
  mcpItem('github'),
  mcpItem(workflowId, 'Expense_Claim_Test'),
  mcpItem('workflow', 'Workflow'),
  {
    kind: 'tool',
    id: 'workflow_like_plugin',
    name: 'Plugin',
    description: '',
    iconKey: 'tool',
    plugin: makePlugin({ pluginKey: 'workflow_like_plugin' }),
  },
];

describe('itemSection', () => {
  test('files Workflow project servers and the legacy workflow entry under workflow', () => {
    expect(items.map(itemSection)).toEqual(['mcp', 'workflow', 'workflow', 'tool']);
  });

  test('leaves an MCP server whose name only resembles a workflow key under mcp', () => {
    expect(itemSection(mcpItem('workflow_tools'))).toBe('mcp');
  });
});

describe('countBySection', () => {
  test('counts Workflow servers apart from the MCP servers', () => {
    expect(countBySection(items)).toEqual({
      builtin: 0,
      tool: 1,
      skill: 0,
      mcp: 1,
      workflow: 2,
      action: 0,
    });
  });
});

describe('section filtering', () => {
  test('the MCP section no longer lists Workflow servers', () => {
    expect(applyFilter(items, { kind: 'mcp' }).map((i) => i.id)).toEqual(['github']);
  });

  test('the workflow section lists only Workflow servers', () => {
    expect(applyFilter(items, { kind: 'workflow' }).map((i) => i.id)).toEqual([
      workflowId,
      'workflow',
    ]);
  });
});

describe('workflow presentation', () => {
  test('labels and draws a Workflow server as its own section', () => {
    const workflow = items[1];
    expect(SECTION_LABEL_KEYS[itemSection(workflow)]).toBe('com_ui_tools_kind_workflow');
    expect(getIconForItem(workflow).Icon).not.toBe(getIconForItem(items[0]).Icon);
  });
});
