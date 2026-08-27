import { createHmac } from 'crypto';
import { logger } from '@librechat/data-schemas';
import { sanitizeMCPTitle } from 'librechat-data-provider';
import type { MCPOptions } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { TarsMcpServerDetail } from './admin';
import { clearTarsMcpEntryNames, recordTarsMcpEntryName, derivedTarsMcpEntryName } from './names';
import { PROXIED_SERVER_TYPES, tarsMcpFetch } from './client';
import { hostPortFromUrl } from '~/auth/allowedAddresses';
import { isTarsConfigured } from '~/tars/client';

export const TARS_MCP_SERVER_NAME = 'tars';
export const TARS_MCP_PATH = '/api/tars/mcp';

const GATEWAY_KEY_CONTEXT = 'tars-mcp-gateway';
const DEFAULT_TOOL_TIMEOUT_MS = 90_000;
/**
 * The server-list fetch is generous because pwc_tars's first `/api/mcp/servers`
 * after a restart pays for its database connection pool warming up (measured
 * ~23s against a remote DB; ~2s once warm). Too tight a bound turns every cold
 * start into a failed injection + retry cycle. Override with
 * `TARS_MCP_SERVER_LIST_TIMEOUT_MS`.
 */
const DEFAULT_SERVER_LIST_TIMEOUT_MS = 45_000;

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

/** The URL LibreChat's MCP client uses to reach its own gateway route. */
export function tarsMcpSelfUrl(): string {
  return tarsLoopbackUrl(TARS_MCP_PATH, process.env.TARS_MCP_SELF_URL);
}

/**
 * Loopback endpoint URL for a route LibreChat's own MCP client calls back into.
 * `localhost` (not `127.0.0.1`) so the connection works whichever family the
 * `HOST` binding chose; Node's happy-eyeballs tries both. `override` is a full
 * endpoint URL, for proxies or multi-instance setups.
 */
export function tarsLoopbackUrl(path: string, override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, '');
  }
  const port = process.env.PORT?.trim() || '3080';
  return `http://localhost:${port}${path}`;
}

function buildServerEntry(
  url: string,
  gatewayKey: string,
  server: TarsMcpServerDetail,
): MCPOptions {
  return {
    type: 'streamable-http',
    url,
    headers: {
      'X-Tars-Gateway-Key': gatewayKey,
      'X-Tars-User-Id': '{{LIBRECHAT_USER_ID}}',
    },
    startup: false,
    chatMenu: true,
    /** Every config consumer re-parses this entry through `MCPOptionsSchema` — the
     * tool-cache generation hash does so on each `getMCPServerTools` call — so a
     * pwc_tars name carrying characters the title alphabet rejects would throw on
     * every read and silently drop the server's tools. */
    title: sanitizeMCPTitle(server.name, server.code),
    description: server.description || '',
    timeout: DEFAULT_TOOL_TIMEOUT_MS,
  };
}

function serverListTimeoutMs(): number {
  const raw = Number(process.env.TARS_MCP_SERVER_LIST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SERVER_LIST_TIMEOUT_MS;
}

let injectionFailed = false;

/**
 * Whether the last {@link withTarsMcpConfig} run failed to reach pwc_tars.
 * The caller (`loadBaseConfig`) uses this to schedule a config-cache
 * invalidation retry so a pwc_tars outage at boot heals without a restart.
 */
export function tarsMcpInjectionFailed(): boolean {
  return injectionFailed;
}

/**
 * The unique injected entry name for a pwc_tars server: `tars_<sanitized code>`,
 * falling back to a short server-id suffix when sanitization collides or the
 * code is missing.
 */
function entryNameFor(server: TarsMcpServerDetail, taken: Set<string>): string {
  const base = derivedTarsMcpEntryName(server.id, server.code);
  if (!taken.has(base)) {
    return base;
  }
  return `${base}_${server.id.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 8)}`;
}

/**
 * Injects one loopback gateway entry per pwc_tars MCP server into the app
 * config so admins get them without touching `librechat.yaml`. Applied once at
 * base-config load so every `getAppConfig` consumer (MCP registry, per-tool
 * domain checks, agent init) sees the same entries. The `{{LIBRECHAT_USER_ID}}`
 * header makes connections user-scoped, so each user's tool list reflects their
 * own pwc_tars domain permissions. Pre-existing entries of the same name
 * (admin-managed YAML) always win. When pwc_tars is unreachable nothing is
 * injected and {@link tarsMcpInjectionFailed} flips true so the caller can
 * schedule a retry. No-op when disabled.
 */
export async function withTarsMcpConfig(appConfig: AppConfig): Promise<AppConfig> {
  injectionFailed = false;
  clearTarsMcpEntryNames();
  if (!appConfig || !isTarsMcpEnabled()) {
    return appConfig;
  }
  const gatewayKey = deriveTarsMcpGatewayKey();
  if (!gatewayKey) {
    logger.warn('[tars-mcp] JWT_SECRET is not set; skipping TARS MCP gateway registration');
    return appConfig;
  }

  let servers: TarsMcpServerDetail[];
  try {
    servers =
      (await tarsMcpFetch<TarsMcpServerDetail[]>('/api/mcp/servers', {
        timeoutMs: serverListTimeoutMs(),
      })) ?? [];
  } catch (error) {
    injectionFailed = true;
    logger.warn(
      '[tars-mcp] Failed to fetch the pwc_tars MCP server list; no gateway entries injected',
      error,
    );
    return appConfig;
  }

  const baseUrl = tarsMcpSelfUrl();
  const mcpConfig = { ...(appConfig.mcpConfig ?? {}) };
  const taken = new Set(Object.keys(mcpConfig));
  let injected = 0;
  for (const server of servers) {
    if (!server.is_enabled || !PROXIED_SERVER_TYPES.has(server.type)) {
      continue;
    }
    const name = entryNameFor(server, taken);
    if (mcpConfig[name]) {
      logger.warn(`[tars-mcp] mcpConfig already defines "${name}"; skipping injection (YAML wins)`);
      continue;
    }
    taken.add(name);
    mcpConfig[name] = buildServerEntry(
      `${baseUrl}/${encodeURIComponent(server.id)}`,
      gatewayKey,
      server,
    );
    recordTarsMcpEntryName(server.id, name);
    injected += 1;
  }

  if (injected === 0) {
    return appConfig;
  }
  appConfig.mcpConfig = mcpConfig;

  const loopback = hostPortFromUrl(baseUrl);
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
