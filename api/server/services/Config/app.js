const mongoose = require('mongoose');
const { CacheKeys } = require('librechat-data-provider');
const { AppService, logger } = require('@librechat/data-schemas');
const {
  isEnabled,
  expandCustomEndpoint,
  createAppConfigService,
  clearMcpConfigCache,
  createCodeEnvironmentRegistry,
  createConfigCacheInvalidation,
  createRedisConfigInvalidationPubSub,
  mergeAccessibleCodeEnvironments,
  ioredisClient,
  cacheConfig,
  standardCache,
  hostPortFromUrl,
  withTarsMcpConfig,
  tarsMcpInjectionFailed,
} = require('@librechat/api');
const { setCachedTools } = require('./getCachedTools');
const { loadAndFormatTools } = require('~/server/services/start/tools');
const loadCustomConfig = require('./loadCustomConfig');
const getLogStores = require('~/cache/getLogStores');
const paths = require('~/config/paths');
const db = require('~/models');

let codeEnvironmentRegistry;

function getCodeEnvironmentRegistry() {
  if (codeEnvironmentRegistry == null) {
    codeEnvironmentRegistry = createCodeEnvironmentRegistry(mongoose, {
      configurationCache: cacheConfig.USE_REDIS
        ? standardCache('CODE_ENVIRONMENT_CONFIG')
        : undefined,
    });
  }
  return codeEnvironmentRegistry;
}

async function invalidateCodeEnvironmentConfigCache(tenantId) {
  await getCodeEnvironmentRegistry().invalidateAccessibleConfigurations(tenantId);
}

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

const TARS_MCP_RETRY_MS = 60_000;
let tarsMcpRetryTimer = null;

/**
 * When the pwc_tars MCP server list could not be fetched at base-config load
 * (pwc_tars down at boot), schedule a one-shot config-cache invalidation so the
 * gateway entries appear without a restart once pwc_tars recovers. The module
 * guard keeps repeated failing loads from stacking timers.
 */
function scheduleTarsMcpRetry() {
  if (!tarsMcpInjectionFailed() || tarsMcpRetryTimer) {
    return;
  }
  tarsMcpRetryTimer = setTimeout(() => {
    tarsMcpRetryTimer = null;
    logger.info('[tars-mcp] Retrying config load after failed pwc_tars server-list fetch');
    invalidateConfigCaches().catch((error) =>
      logger.error('[tars-mcp] Config invalidation retry failed:', error),
    );
  }, TARS_MCP_RETRY_MS);
  tarsMcpRetryTimer.unref?.();
}

const loadBaseConfig = async (mode) => {
  /** @type {TCustomConfig} */
  const config = (await loadCustomConfig(true, { mode })) ?? {};
  /** @type {Record<string, FunctionTool>} */
  const systemTools = loadAndFormatTools({
    adminFilter: config.filteredTools,
    adminIncluded: config.includedTools,
    directory: paths.structuredTools,
  });
  const appConfig = await withTarsMcpConfig(
    withLangflowAllowedAddress(
      await AppService({ config, paths, systemTools, expandCustomEndpoint }),
    ),
  );
  scheduleTarsMcpRetry();
  return appConfig;
};

const appConfigService = createAppConfigService({
  loadBaseConfig,
  setCachedTools,
  getCache: getLogStores,
  cacheKeys: CacheKeys,
  getApplicableConfigs: db.getApplicableConfigs,
  getUserPrincipals: db.getUserPrincipals,
  overrideEnvAllowlist: process.env.CONFIG_OVERRIDE_ENV_ALLOWLIST,
  rederiveEndpoints: isEnabled(process.env.CONFIG_REDERIVE_ENDPOINTS),
  augmentConfig: ({ appConfig, baseConfig, principals, options }) => {
    if (!options.userId) return appConfig;
    return mergeAccessibleCodeEnvironments({
      appConfig,
      deploymentConfig: baseConfig,
      actor: {
        userId: options.userId,
        role: options.role ?? null,
        idOnTheSource: options.idOnTheSource ?? null,
        principals,
      },
      registry: getCodeEnvironmentRegistry(),
    });
  },
});
const {
  getAppConfig,
  resolveConfigLayers,
  clearAppConfigCache,
  clearOverrideCache,
  reloadBaseConfig,
  overrideCacheTtl,
  rederiveEndpoints,
} = appConfigService;

// Config owns the reader; models never import this module to obtain it.
db.initializeMessageBudget(getAppConfig);

/**
 * Admin config writes clear the per-principal override caches, the MCP config-source servers
 * and the YAML base config. Base-only sections such as `filters` and `messageFilter` exist only
 * in librechat.yaml, and an admin write is how a running server picks up an edit to them: the
 * next read reloads the YAML (keeping the last good config if it fails) and republishes the
 * tools derived from it. With Redis, the clear is broadcast so every instance reloads its YAML
 * and drops its in-process merged config.
 */
const configCacheInvalidation = createConfigCacheInvalidation({
  clears: [
    { label: 'clearAppConfigCache', clear: () => clearAppConfigCache() },
    { label: 'clearOverrideCache', clear: clearOverrideCache },
    { label: 'clearMcpConfigCache', clear: () => clearMcpConfigCache() },
  ],
  load: reloadBaseConfig,
  pubsub: createRedisConfigInvalidationPubSub({
    useRedis: cacheConfig.USE_REDIS,
    client: ioredisClient,
    namespace: cacheConfig.REDIS_KEY_PREFIX,
  }),
});

/**
 * Invalidate the config caches an admin config mutation affects, on every instance.
 * @param {string} [tenantId] - Optional tenant ID to scope override cache clearing.
 */
function invalidateConfigCaches(tenantId) {
  return configCacheInvalidation.invalidate(tenantId);
}

/**
 * The same clear for the admin reload route, then librechat.yaml loaded again here and, when it
 * loaded, the broadcast; resolves with what each step reached.
 * @param {string} [tenantId] - Optional tenant ID to scope override cache clearing.
 * @returns {Promise<import('@librechat/api').ConfigReloadReport>}
 */
function reloadConfigCaches(tenantId) {
  return configCacheInvalidation.reload(tenantId);
}

module.exports = {
  getAppConfig,
  resolveConfigLayers,
  overrideCacheTtl,
  rederiveEndpoints,
  invalidateConfigCaches,
  reloadConfigCaches,
  getCodeEnvironmentRegistry,
  invalidateCodeEnvironmentConfigCache,
};
