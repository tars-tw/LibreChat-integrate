const express = require('express');
const { timingSafeEqual } = require('crypto');
const { logger } = require('@librechat/data-schemas');
const {
  isTarsConfigured,
  isTarsMcpEnabled,
  handleTarsMcpRequest,
  deriveTarsMcpGatewayKey,
  adminListTarsMcpServers,
  adminGetTarsMcpServer,
  adminCreateTarsMcpServer,
  adminUpdateTarsMcpServer,
  adminDeleteTarsMcpServer,
  adminTestTarsMcpServer,
  adminSyncTarsMcpServer,
  adminParseTarsOpenapi,
  getUserTarsMcpSettings,
  updateUserTarsMcpServer,
  saveUserTarsMcpCredentials,
  clearUserTarsMcpCredentials,
  invalidateTarsMcpToolsCache,
  adminUpdateTarsMcpTool,
  adminDeleteTarsMcpTool,
  adminListTarsDomainMcpServers,
  adminListTarsDomainAvailableServers,
  adminSaveTarsDomainMcp,
  adminGetTarsMcpLogs,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');
const { invalidateConfigCaches } = require('~/server/services/Config');
const { getUserById } = require('~/models');

const router = express.Router();

function jsonRpcError(res, status, code, message) {
  return res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

function gatewayKeyMatches(provided) {
  const expected = deriveTarsMcpGatewayKey();
  if (!expected || typeof provided !== 'string' || provided.length === 0) {
    return false;
  }
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

/**
 * Maps the `X-Tars-User-Id` header (the LibreChat Mongo user id, expanded from
 * the `{{LIBRECHAT_USER_ID}}` placeholder) to the linked pwc_tars user id.
 * Unlinked or unknown users resolve to null and the gateway fails closed to an
 * empty tool list.
 */
async function resolveTarsUserId(headerValue) {
  if (typeof headerValue !== 'string' || headerValue.length === 0) {
    return null;
  }
  try {
    const user = await getUserById(headerValue, 'tarsId');
    return user?.tarsId || null;
  } catch (error) {
    logger.warn('[POST /api/tars/mcp] Failed to resolve user from X-Tars-User-Id header', error);
    return null;
  }
}

const gatewayHandler = (serverIdFrom) => async (req, res) => {
  if (!isTarsMcpEnabled()) {
    return jsonRpcError(res, 404, -32001, 'TARS MCP gateway is disabled');
  }
  if (!gatewayKeyMatches(req.headers['x-tars-gateway-key'])) {
    return jsonRpcError(res, 403, -32002, 'Forbidden');
  }
  const serverId = serverIdFrom?.(req);
  try {
    const tarsUserId = await resolveTarsUserId(req.headers['x-tars-user-id']);
    await handleTarsMcpRequest({ req, res, body: req.body, tarsUserId, serverId });
  } catch (error) {
    logger.error('[POST /api/tars/mcp] MCP gateway request failed', error);
    if (!res.headersSent) {
      return jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
};

/**
 * @route POST /api/tars/mcp
 * @deprecated Aggregate gateway (single `tars` entry exposing every server's
 * tools). Kept for admin-managed YAML entries pinned to the old URL; the
 * injected per-server entries use `POST /api/tars/mcp/:serverId`.
 * @access Internal — LibreChat's own MCP client, authenticated by gateway key (not JWT).
 */
router.post('/mcp', gatewayHandler());

/** Stateless gateway: no SSE stream to open (GET) and no session to delete (DELETE). */
const methodNotAllowed = (req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed');
router.get('/mcp', methodNotAllowed);
router.delete('/mcp', methodNotAllowed);

/**
 * Invalidates every cache a pwc_tars MCP mutation can affect: the gateway's
 * per-user tool cache and LibreChat's config caches (so the injected per-server
 * entries reflect the change on the next request). Best-effort — a failed
 * invalidation only delays freshness until the TTL/restart.
 */
async function invalidateMcpCaches(label) {
  invalidateTarsMcpToolsCache();
  try {
    await invalidateConfigCaches();
  } catch (error) {
    logger.error(`[${label}] Config cache invalidation failed`, error);
  }
}

/**
 * Admin proxy for managing pwc_tars MCP servers (openapi / custom_api) from
 * LibreChat. pwc_tars stays the source of truth; nothing is stored locally.
 * @access Admin (pwc_tars)
 */
const requireTarsMcp = (req, res, next) => {
  if (!isTarsConfigured()) {
    return res.status(503).json({ error: 'pwc_tars integration is not configured' });
  }
  return next();
};

/** pwc_tars 4xx (validation / not-found / forbidden) pass through; the rest surface as 502. */
const proxyErrorResponse = (label, error, res) => {
  logger.error(`[${label}] pwc_tars MCP request failed`, error);
  const status =
    typeof error?.status === 'number' && error.status >= 400 && error.status < 500
      ? error.status
      : 502;
  const message = error?.serverMessage || 'pwc_tars MCP request failed';
  return res.status(status).json({ error: message });
};

const adminHandler = (label, handler) => async (req, res) => {
  try {
    return res.json((await handler(req)) ?? {});
  } catch (error) {
    return proxyErrorResponse(label, error, res);
  }
};

const adminMiddleware = [requireJwtAuth, requireTarsAdmin, requireTarsMcp];

router.get(
  '/mcp/admin/servers',
  adminMiddleware,
  adminHandler('GET /api/tars/mcp/admin/servers', async () => ({
    servers: await adminListTarsMcpServers(),
  })),
);

router.get(
  '/mcp/admin/servers/:serverId',
  adminMiddleware,
  adminHandler('GET /api/tars/mcp/admin/servers/:serverId', async (req) => ({
    server: await adminGetTarsMcpServer(req.params.serverId),
  })),
);

router.post(
  '/mcp/admin/servers',
  adminMiddleware,
  adminHandler('POST /api/tars/mcp/admin/servers', async (req) => {
    const server = await adminCreateTarsMcpServer(req.body ?? {});
    await invalidateMcpCaches('POST /api/tars/mcp/admin/servers');
    return { server };
  }),
);

router.put(
  '/mcp/admin/servers/:serverId',
  adminMiddleware,
  adminHandler('PUT /api/tars/mcp/admin/servers/:serverId', async (req) => {
    const server = await adminUpdateTarsMcpServer(req.params.serverId, req.body ?? {});
    await invalidateMcpCaches('PUT /api/tars/mcp/admin/servers/:serverId');
    return { server };
  }),
);

router.delete(
  '/mcp/admin/servers/:serverId',
  adminMiddleware,
  adminHandler('DELETE /api/tars/mcp/admin/servers/:serverId', async (req) => {
    await adminDeleteTarsMcpServer(req.params.serverId);
    await invalidateMcpCaches('DELETE /api/tars/mcp/admin/servers/:serverId');
    return { success: true };
  }),
);

router.post(
  '/mcp/admin/servers/:serverId/test',
  adminMiddleware,
  adminHandler('POST /api/tars/mcp/admin/servers/:serverId/test', async (req) => ({
    result: await adminTestTarsMcpServer(req.params.serverId),
  })),
);

router.post(
  '/mcp/admin/servers/:serverId/sync',
  adminMiddleware,
  adminHandler('POST /api/tars/mcp/admin/servers/:serverId/sync', async (req) => {
    const result = await adminSyncTarsMcpServer(req.params.serverId);
    await invalidateMcpCaches('POST /api/tars/mcp/admin/servers/:serverId/sync');
    return { result };
  }),
);

router.post(
  '/mcp/admin/parse-openapi',
  adminMiddleware,
  adminHandler('POST /api/tars/mcp/admin/parse-openapi', async (req) => ({
    parsed: await adminParseTarsOpenapi(req.body ?? {}),
  })),
);

router.put(
  '/mcp/admin/tools/:toolId',
  adminMiddleware,
  adminHandler('PUT /api/tars/mcp/admin/tools/:toolId', async (req) => {
    const { is_enabled, description, input_schema } = req.body ?? {};
    const tool = await adminUpdateTarsMcpTool(req.params.toolId, {
      is_enabled,
      description,
      input_schema,
    });
    await invalidateMcpCaches('PUT /api/tars/mcp/admin/tools/:toolId');
    return { tool };
  }),
);

router.delete(
  '/mcp/admin/tools/:toolId',
  adminMiddleware,
  adminHandler('DELETE /api/tars/mcp/admin/tools/:toolId', async (req) => {
    await adminDeleteTarsMcpTool(req.params.toolId);
    await invalidateMcpCaches('DELETE /api/tars/mcp/admin/tools/:toolId');
    return { success: true };
  }),
);

router.get(
  '/mcp/admin/domains/:domainId/servers',
  adminMiddleware,
  adminHandler('GET /api/tars/mcp/admin/domains/:domainId/servers', async (req) => ({
    servers: await adminListTarsDomainMcpServers(Number(req.params.domainId)),
  })),
);

router.get(
  '/mcp/admin/domains/:domainId/available-servers',
  adminMiddleware,
  adminHandler('GET /api/tars/mcp/admin/domains/:domainId/available-servers', async (req) => ({
    servers: await adminListTarsDomainAvailableServers(Number(req.params.domainId)),
  })),
);

router.post(
  '/mcp/admin/domains/save',
  adminMiddleware,
  adminHandler('POST /api/tars/mcp/admin/domains/save', async (req) => {
    const { domain_ids, servers } = req.body ?? {};
    if (!Array.isArray(domain_ids) || domain_ids.length === 0 || !Array.isArray(servers)) {
      const error = new Error('domain_ids and servers are required');
      error.status = 400;
      error.serverMessage = 'domain_ids and servers are required';
      throw error;
    }
    await adminSaveTarsDomainMcp({ domain_ids, servers }, req.user.tarsId);
    await invalidateMcpCaches('POST /api/tars/mcp/admin/domains/save');
    return { success: true };
  }),
);

router.get(
  '/mcp/admin/logs',
  adminMiddleware,
  adminHandler('GET /api/tars/mcp/admin/logs', async (req) => ({
    logs: await adminGetTarsMcpLogs({
      conversation_id: req.query.conversation_id,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }),
  })),
);

/**
 * User-facing proxy: the authenticated user's own pwc_tars MCP settings
 * (visible servers/tools, per-tool toggles, verified credentials).
 * @access Private (tars-linked users; unlinked users get an empty list)
 */
const userMiddleware = [requireJwtAuth, requireTarsMcp];

const userHandler = (label, handler) => async (req, res) => {
  try {
    const tarsId = req.user?.tarsId;
    if (!tarsId) {
      return res.status(403).json({ error: 'This account is not linked to pwc_tars' });
    }
    return res.json((await handler(req, tarsId)) ?? {});
  } catch (error) {
    return proxyErrorResponse(label, error, res);
  }
};

router.get(
  '/mcp/user/settings',
  userMiddleware,
  userHandler('GET /api/tars/mcp/user/settings', async (req, tarsId) => ({
    servers: await getUserTarsMcpSettings(tarsId),
  })),
);

router.put(
  '/mcp/user/servers/:serverId',
  userMiddleware,
  userHandler('PUT /api/tars/mcp/user/servers/:serverId', async (req, tarsId) => {
    const { is_enabled, tool_config } = req.body ?? {};
    await updateUserTarsMcpServer(tarsId, req.params.serverId, { is_enabled, tool_config });
    return { success: true };
  }),
);

router.put(
  '/mcp/user/servers/:serverId/credentials',
  userMiddleware,
  userHandler('PUT /api/tars/mcp/user/servers/:serverId/credentials', async (req, tarsId) => ({
    result: await saveUserTarsMcpCredentials(
      tarsId,
      req.params.serverId,
      req.body?.credentials ?? {},
    ),
  })),
);

router.delete(
  '/mcp/user/servers/:serverId/credentials',
  userMiddleware,
  userHandler('DELETE /api/tars/mcp/user/servers/:serverId/credentials', async (req, tarsId) => {
    await clearUserTarsMcpCredentials(tarsId, req.params.serverId);
    return { success: true };
  }),
);

/**
 * @route POST /api/tars/mcp/:serverId
 * @desc Per-server loopback MCP gateway — the target of the injected
 * `tars_<code>` mcpConfig entries. Registered last so the literal
 * `/mcp/admin/*` and `/mcp/user/*` paths always win.
 * @access Internal — LibreChat's own MCP client, authenticated by gateway key (not JWT).
 */
router.post(
  '/mcp/:serverId',
  gatewayHandler((req) => req.params.serverId),
);
router.get('/mcp/:serverId', methodNotAllowed);
router.delete('/mcp/:serverId', methodNotAllowed);

module.exports = router;
