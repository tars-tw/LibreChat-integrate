const { CacheKeys } = require('librechat-data-provider');
const { AppService, logger } = require('@librechat/data-schemas');
const {
  createAppConfigService,
  clearMcpConfigCache,
  withTarsMcpConfig,
  hostPortFromUrl,
} = require('@librechat/api');
const { setCachedTools, invalidateCachedTools } = require('./getCachedTools');
const { loadAndFormatTools } = require('~/server/services/start/tools');
const loadCustomConfig = require('./loadCustomConfig');
const getLogStores = require('~/cache/getLogStores');
const paths = require('~/config/paths');
const db = require('~/models');

/**
 * Exempts the local Langflow service from the MCP SSRF block by deriving its `host:port` from
 * `VITE_LANGFLOW_URL` (the single Langflow URL source of truth) and adding it to
 * `mcpSettings.allowedAddresses`. Injected here at base-config load so every `getAppConfig` consumer
 * — the MCP connection registry AND the per-tool domain check in MCP.js — sees it from one place,
 * keeping the host out of `librechat.yaml` (whose `allowedAddresses` entries aren't env-interpolated).
 * No-op when the env var is unset or the host is already listed.
 * @param {Awaited<ReturnType<typeof AppService>>} appConfig
 */
function withLangflowAllowedAddress(appConfig) {
  const entry = hostPortFromUrl(process.env.VITE_LANGFLOW_URL || process.env.LANGFLOW_BASE_URL);
  if (!entry || !appConfig) {
    return appConfig;
  }
  const mcpSettings = appConfig.mcpSettings || {};
  const existing = Array.isArray(mcpSettings.allowedAddresses) ? mcpSettings.allowedAddresses : [];
  if (existing.includes(entry)) {
    return appConfig;
  }
  appConfig.mcpSettings = { ...mcpSettings, allowedAddresses: [...existing, entry] };
  return appConfig;
}

const loadBaseConfig = async () => {
  /** @type {TCustomConfig} */
  const config = (await loadCustomConfig()) ?? {};
  /** @type {Record<string, FunctionTool>} */
  const systemTools = loadAndFormatTools({
    adminFilter: config.filteredTools,
    adminIncluded: config.includedTools,
    directory: paths.structuredTools,
  });
  return withTarsMcpConfig(
    withLangflowAllowedAddress(await AppService({ config, paths, systemTools })),
  );
};

const { getAppConfig, clearAppConfigCache, clearOverrideCache } = createAppConfigService({
  loadBaseConfig,
  setCachedTools,
  getCache: getLogStores,
  cacheKeys: CacheKeys,
  getApplicableConfigs: db.getApplicableConfigs,
  getUserPrincipals: db.getUserPrincipals,
});

/**
 * Invalidate all config-related caches after an admin config mutation.
 * Clears the base config, per-principal override caches, tool caches,
 * and the MCP config-source server cache.
 * @param {string} [tenantId] - Optional tenant ID to scope override cache clearing.
 */
async function invalidateConfigCaches(tenantId) {
  const results = await Promise.allSettled([
    clearAppConfigCache(),
    clearOverrideCache(tenantId),
    invalidateCachedTools({ invalidateGlobal: true }),
    clearMcpConfigCache(),
  ]);
  const labels = [
    'clearAppConfigCache',
    'clearOverrideCache',
    'invalidateCachedTools',
    'clearMcpConfigCache',
  ];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      logger.error(`[invalidateConfigCaches] ${labels[i]} failed:`, results[i].reason);
    }
  }
}

module.exports = {
  getAppConfig,
  clearAppConfigCache,
  invalidateConfigCaches,
};
