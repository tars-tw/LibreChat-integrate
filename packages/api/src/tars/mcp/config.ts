import { createHmac } from 'crypto';
import { logger } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { MCPOptions } from 'librechat-data-provider';
import { hostPortFromUrl } from '~/auth/allowedAddresses';
import { isTarsConfigured } from '~/tars/client';

export const TARS_MCP_SERVER_NAME = 'tars';
export const TARS_MCP_PATH = '/api/tars/mcp';

const GATEWAY_KEY_CONTEXT = 'tars-mcp-gateway';
const DEFAULT_TOOL_TIMEOUT_MS = 90_000;

/** The gateway is on whenever pwc_tars is configured, unless explicitly disabled. */
export function isTarsMcpEnabled(): boolean {
  if (!isTarsConfigured()) {
    return false;
  }
  return process.env.TARS_MCP_ENABLED?.trim().toLowerCase() !== 'false';
}

/**
 * Shared secret protecting the loopback gateway route (`POST /api/tars/mcp`),
 * which is deliberately outside JWT auth because its caller is LibreChat's own
 * MCP connection manager. `TARS_MCP_GATEWAY_KEY` overrides; otherwise the key is
 * derived from `JWT_SECRET` so every instance sharing the env derives the same
 * value without extra configuration.
 */
export function deriveTarsMcpGatewayKey(): string | null {
  const override = process.env.TARS_MCP_GATEWAY_KEY?.trim();
  if (override) {
    return override;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }
  return createHmac('sha256', secret).update(GATEWAY_KEY_CONTEXT).digest('hex');
}

/**
 * The URL LibreChat's MCP client uses to reach its own gateway route.
 * `localhost` (not `127.0.0.1`) so the connection works whichever family the
 * `HOST` binding chose; Node's happy-eyeballs tries both. Override with
 * `TARS_MCP_SELF_URL` (full endpoint URL) behind proxies or multi-instance
 * setups.
 */
export function tarsMcpSelfUrl(): string {
  const override = process.env.TARS_MCP_SELF_URL?.trim();
  if (override) {
    return override.replace(/\/+$/, '');
  }
  const port = process.env.PORT?.trim() || '3080';
  return `http://localhost:${port}${TARS_MCP_PATH}`;
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
    title: 'TARS',
    description: 'pwc_tars OpenAPI / custom API tools',
    timeout: DEFAULT_TOOL_TIMEOUT_MS,
  };
}

/**
 * Injects the loopback TARS MCP gateway server into the app config so admins
 * get it without touching `librechat.yaml`. Mirrors `withLangflowAllowedAddress`:
 * applied once at base-config load so every `getAppConfig` consumer (MCP
 * registry, per-tool domain checks, agent init) sees the same entry. The
 * `{{LIBRECHAT_USER_ID}}` header makes connections user-scoped, so each user's
 * tool list reflects their own pwc_tars domain permissions. A pre-existing
 * `tars` entry (admin-managed YAML) always wins. No-op when disabled.
 */
export function withTarsMcpConfig(appConfig: AppConfig): AppConfig {
  if (!appConfig || !isTarsMcpEnabled()) {
    return appConfig;
  }
  if (appConfig.mcpConfig?.[TARS_MCP_SERVER_NAME]) {
    return appConfig;
  }
  const gatewayKey = deriveTarsMcpGatewayKey();
  if (!gatewayKey) {
    logger.warn('[tars-mcp] JWT_SECRET is not set; skipping TARS MCP gateway registration');
    return appConfig;
  }

  const url = tarsMcpSelfUrl();
  appConfig.mcpConfig = {
    ...(appConfig.mcpConfig ?? {}),
    [TARS_MCP_SERVER_NAME]: buildServerEntry(url, gatewayKey),
  };

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
