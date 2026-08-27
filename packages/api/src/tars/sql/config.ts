import { sanitizeMCPTitle, TARS_SQL_MCP_SERVER_NAME } from 'librechat-data-provider';
import type { MCPOptions } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { deriveTarsMcpGatewayKey, tarsLoopbackUrl } from '~/tars/mcp/config';
import { hostPortFromUrl } from '~/auth/allowedAddresses';
import { isTarsConfigured } from '~/tars/client';

export const TARS_SQL_PATH = '/api/tars/sql-agent';

const DEFAULT_TITLE = '資料庫查詢';
const DEFAULT_DESCRIPTION = '以自然語言查詢知識庫綁定的資料庫（TARS SQL Agent）';
/**
 * One SQL-agent turn is a whole nested agent loop inside pwc_tars (schema
 * inspection, SQL generation, execution, summarisation), so the ceiling is far
 * above a normal tool call and sits just above `TARS_SQL_AGENT_TIMEOUT_MS`.
 */
const DEFAULT_TOOL_TIMEOUT_MS = 250_000;

/** The SQL agent is on whenever pwc_tars is configured, unless explicitly disabled. */
export function isTarsSqlAgentEnabled(): boolean {
  if (!isTarsConfigured()) {
    return false;
  }
  return process.env.TARS_SQL_AGENT_ENABLED?.trim().toLowerCase() !== 'false';
}

/** The URL LibreChat's MCP client uses to reach its own SQL-agent route. */
export function tarsSqlSelfUrl(): string {
  return tarsLoopbackUrl(TARS_SQL_PATH, process.env.TARS_SQL_AGENT_SELF_URL);
}

function buildServerEntry(url: string, gatewayKey: string): MCPOptions {
  return {
    type: 'streamable-http',
    url,
    headers: {
      'X-Tars-Gateway-Key': gatewayKey,
      'X-Tars-User-Id': '{{LIBRECHAT_USER_ID}}',
    },
    startup: false,
    chatMenu: true,
    title: sanitizeMCPTitle(process.env.TARS_SQL_AGENT_TITLE, DEFAULT_TITLE),
    description: process.env.TARS_SQL_AGENT_DESCRIPTION?.trim() || DEFAULT_DESCRIPTION,
    timeout: DEFAULT_TOOL_TIMEOUT_MS,
  };
}

/**
 * Injects the loopback SQL-agent entry into the app config so the pwc_tars SQL
 * agent shows up as an ordinary MCP server in the chat tools menu and in agent
 * tool bindings. Unlike {@link withTarsMcpConfig} this needs no pwc_tars call
 * at boot — the two tools are static and their reachable databases are resolved
 * per user at call time. A pre-existing entry of the same name (admin-managed
 * YAML) always wins. No-op when disabled.
 */
export function withTarsSqlAgentConfig(appConfig: AppConfig): AppConfig {
  if (!appConfig || !isTarsSqlAgentEnabled()) {
    return appConfig;
  }
  const gatewayKey = deriveTarsMcpGatewayKey();
  if (!gatewayKey) {
    return appConfig;
  }
  const mcpConfig = { ...(appConfig.mcpConfig ?? {}) };
  if (mcpConfig[TARS_SQL_MCP_SERVER_NAME]) {
    return appConfig;
  }

  const url = tarsSqlSelfUrl();
  mcpConfig[TARS_SQL_MCP_SERVER_NAME] = buildServerEntry(url, gatewayKey);
  appConfig.mcpConfig = mcpConfig;

  const loopback = hostPortFromUrl(url);
  if (!loopback) {
    return appConfig;
  }
  const mcpSettings = appConfig.mcpSettings || {};
  const addresses = Array.isArray(mcpSettings.allowedAddresses) ? mcpSettings.allowedAddresses : [];
  if (!addresses.includes(loopback)) {
    appConfig.mcpSettings = { ...mcpSettings, allowedAddresses: [...addresses, loopback] };
  }
  return appConfig;
}
