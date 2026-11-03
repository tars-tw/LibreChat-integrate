import type {
  TTarsMcpShareGap,
  TTarsMcpShareBlock,
  TTarsDomainShareGap,
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

function domainLabel({ name, is_active }: TTarsDomainShareGap, localize: Localize): string {
  if (name == null) {
    return localize('com_ui_tars_mcp_share_gap_domain_deleted');
  }
  return localize(
    is_active ? 'com_ui_tars_mcp_share_gap_domain' : 'com_ui_tars_mcp_share_gap_domain_disabled',
    { domain: name },
  );
}

/** What one share target lacks: the 專用腦 first, then each MCP server. */
export function shareGapLabel({ domain, servers }: TTarsMcpShareBlock, localize: Localize): string {
  return [
    ...(domain ? [domainLabel(domain, localize)] : []),
    ...servers.map((gap) => serverLabel(gap, localize)),
  ].join(', ');
}
