const crypto = require('node:crypto');
const { SystemRoles, PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  isEnabled,
  generateCheckAccess,
  preAuthTenantMiddleware,
  createRequireApiKeyAuth,
  createRemoteAgentAuth,
  createCheckRemoteAgentAccess,
} = require('@librechat/api');
const { getEffectivePermissions } = require('~/server/services/PermissionService');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');

const apiKeyMiddleware = createRequireApiKeyAuth({
  validateAgentApiKey: db.validateAgentApiKey,
  findUser: db.findUser,
});

const requireRemoteAgentAuth = createRemoteAgentAuth({
  apiKeyMiddleware,
  findUser: db.findUser,
  getRolesByNames: db.findRolesByNames,
  updateUser: db.updateUser,
  getAppConfig,
});

const checkRemoteAgentsFeature = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName: db.getRoleByName,
});

const checkAgentPermission = createCheckRemoteAgentAccess({
  getAgent: db.getAgent,
  getEffectivePermissions,
});

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Sentinel ObjectId-shaped id (24 hex chars) for the synthetic gateway user.
// Must parse as a valid Mongo ObjectId — downstream `getAppConfig` builds
// permission principals via `new ObjectId(user.id)`, which throws on a
// non-hex id (e.g. a plain label) and spams "Error building principals".
// All-zeros never collides with a real user; principal lookup just yields base.
const GATEWAY_SERVICE_USER = { id: '000000000000000000000000', role: SystemRoles.USER };

/**
 * Authorize a model-passthrough gateway request, in precedence order:
 *  1. `LLM_GATEWAY_SERVICE_KEY` set and presented as the Bearer token — trusted
 *     service-to-service (a single shared secret, mirroring pwc_tars'
 *     `KEY_LANGFLOW_API_KEY`).
 *  2. `LLM_GATEWAY_ALLOW_UNAUTHENTICATED=true` — open access for a closed
 *     internal deployment where the endpoint is only reachable on a trusted
 *     network. Opt-in only: the default stays locked down so a generic install
 *     never exposes an unauthenticated LLM proxy.
 *  3. Otherwise — per-user remote-agent API keys (minted keys keep working).
 * Cases 1 and 2 attach a fixed service user and skip the REMOTE_AGENTS gate.
 */
function gatewayServiceAuth(req, res, next) {
  const serviceKey = process.env.LLM_GATEWAY_SERVICE_KEY;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (serviceKey && token && timingSafeEqual(token, serviceKey)) {
    req.user = GATEWAY_SERVICE_USER;
    req.gatewayServiceAuth = true;
    return next();
  }
  if (isEnabled(process.env.LLM_GATEWAY_ALLOW_UNAUTHENTICATED)) {
    req.user = GATEWAY_SERVICE_USER;
    req.gatewayServiceAuth = true;
    return next();
  }
  return requireRemoteAgentAuth(req, res, next);
}

function skipFeatureIfServiceAuth(req, res, next) {
  if (req.gatewayServiceAuth) {
    return next();
  }
  return checkRemoteAgentsFeature(req, res, next);
}

module.exports = {
  checkAgentPermission,
  gatewayServiceAuth,
  preAuthTenantMiddleware,
  requireRemoteAgentAuth,
  checkRemoteAgentsFeature,
  skipFeatureIfServiceAuth,
};
