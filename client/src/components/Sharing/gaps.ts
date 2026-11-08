import type {
  TTarsMcpShareGap,
  TTarsMcpShareBlock,
  TTarsKnowledgeBaseShareGap,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

type Localize = (key: TranslationKeys, values?: Record<string, string | number>) => string;

/** A long tool list would push the dialog's own controls off screen. */
const MAX_LISTED_TOOLS = 3;

function serverLabel(
  { server_name: server, no_access, tool_names }: TTarsMcpShareGap,
  localize: Localize,
): string {
  if (no_access) {
    return localize('com_ui_tars_mcp_share_gap_server', { server });
  }
  const listed = tool_names.slice(0, MAX_LISTED_TOOLS).join(', ');
  return localize('com_ui_tars_mcp_share_gap_tools', {
    server,
    tools:
      tool_names.length > MAX_LISTED_TOOLS
        ? localize('com_ui_tars_mcp_share_gap_more', { tools: listed, count: tool_names.length })
        : listed,
  });
}

function knowledgeLabel(gaps: TTarsKnowledgeBaseShareGap[], localize: Localize): string {
  const names = gaps.map(({ name }) => name);
  const listed = names.slice(0, MAX_LISTED_TOOLS).join('、');
  return localize('com_ui_tars_mcp_share_gap_knowledge_bases', {
    names:
      names.length > MAX_LISTED_TOOLS
        ? localize('com_ui_tars_mcp_share_gap_more', { tools: listed, count: names.length })
        : listed,
  });
}

/** What one share target lacks: the knowledge bases it may not use in chat, then each MCP server. */
export function shareGapLabel(
  { knowledge_bases: knowledgeBases = [], servers }: TTarsMcpShareBlock,
  localize: Localize,
): string {
  return [
    ...(knowledgeBases.length > 0 ? [knowledgeLabel(knowledgeBases, localize)] : []),
    ...servers.map((gap) => serverLabel(gap, localize)),
  ].join(', ');
}
