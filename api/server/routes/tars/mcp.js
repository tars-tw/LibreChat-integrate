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
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');
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

/**
 * @route POST /api/tars/mcp
 * @desc Loopback MCP gateway proxying pwc_tars OpenAPI / custom-API tools.
 * @access Internal — LibreChat's own MCP client, authenticated by gateway key (not JWT).
 */
router.post('/mcp', async (req, res) => {
  if (!isTarsMcpEnabled()) {
    return jsonRpcError(res, 404, -32001, 'TARS MCP gateway is disabled');
  }
  if (!gatewayKeyMatches(req.headers['x-tars-gateway-key'])) {
    return jsonRpcError(res, 403, -32002, 'Forbidden');
  }
  try {
    const tarsUserId = await resolveTarsUserId(req.headers['x-tars-user-id']);
    await handleTarsMcpRequest({ req, res, body: req.body, tarsUserId });
  } catch (error) {
    logger.error('[POST /api/tars/mcp] MCP gateway request failed', error);
    if (!res.headersSent) {
      return jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
});

/** Stateless gateway: no SSE stream to open (GET) and no session to delete (DELETE). */
const methodNotAllowed = (req, res) => jsonRpcError(res, 405, -32000, 'Method not allowed');
router.get('/mcp', methodNotAllowed);
router.delete('/mcp', methodNotAllowed);

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
  adminHandler('POST /api/tars/mcp/admin/servers', async (req) => ({
    server: await adminCreateTarsMcpServer(req.body ?? {}),
  })),
);

router.put(
  '/mcp/admin/servers/:serverId',
  adminMiddleware,
  adminHandler('PUT /api/tars/mcp/admin/servers/:serverId', async (req) => ({
    server: await adminUpdateTarsMcpServer(req.params.serverId, req.body ?? {}),
  })),
);

router.delete(
  '/mcp/admin/servers/:serverId',
  adminMiddleware,
  adminHandler('DELETE /api/tars/mcp/admin/servers/:serverId', async (req) => {
    await adminDeleteTarsMcpServer(req.params.serverId);
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
  adminHandler('POST /api/tars/mcp/admin/servers/:serverId/sync', async (req) => ({
    result: await adminSyncTarsMcpServer(req.params.serverId),
  })),
);

router.post(
  '/mcp/admin/parse-openapi',
  adminMiddleware,
  adminHandler('POST /api/tars/mcp/admin/parse-openapi', async (req) => ({
    parsed: await adminParseTarsOpenapi(req.body ?? {}),
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

module.exports = router;
