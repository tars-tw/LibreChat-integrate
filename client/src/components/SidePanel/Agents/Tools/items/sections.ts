import { isWorkflowMcpServerName } from 'librechat-data-provider';
import type { AgentItem, MarketplaceSection } from './types';
import type { TranslationKeys } from '~/hooks/useLocalize';

/**
 * The library section an item is listed under. A Workflow project server is an MCP
 * server underneath, and stays `kind: 'mcp'` for selection and the detail dialog,
 * but readers know it as a TARS Workflow, so it is filed apart from the MCP servers.
 */
export function itemSection(item: AgentItem): MarketplaceSection {
  if (item.kind === 'mcp' && isWorkflowMcpServerName(item.id)) {
    return 'workflow';
  }
  return item.kind;
}

export const SECTION_LABEL_KEYS: Record<MarketplaceSection, TranslationKeys> = {
  builtin: 'com_ui_tools_kind_official',
  tool: 'com_ui_tools_kind_tools',
  skill: 'com_ui_tools_kind_skills',
  mcp: 'com_ui_tools_kind_mcp',
  workflow: 'com_ui_tools_kind_workflow',
  action: 'com_ui_tools_kind_actions',
};

export function countBySection(items: AgentItem[]): Record<MarketplaceSection, number> {
  const counts: Record<MarketplaceSection, number> = {
    builtin: 0,
    tool: 0,
    skill: 0,
    mcp: 0,
    workflow: 0,
    action: 0,
  };
  for (const item of items) {
    counts[itemSection(item)] += 1;
  }
  return counts;
}
