const { createTarsOidcTeardown } = require('@librechat/api');
const { maybeUninstallOAuthMCP } = require('~/server/services/MCP/oauthCleanup');
const { invalidateCachedTools } = require('~/server/services/Config');
const { getMCPManager, getMCPServersRegistry } = require('~/config');
const db = require('~/models');

/** Clears users' OIDC tokens for a pwc_tars MCP server that was deleted or re-pointed. */
module.exports = createTarsOidcTeardown({
  findTokenUserIds: (identifiers) => db.findTokenUserIds(identifiers),
  resolveAllowlists: (userId) => getMCPServersRegistry().resolveAllowlists({ userId }),
  invalidateUserTools: (userId, serverName) => invalidateCachedTools({ userId, serverName }),
  disconnectUser: (userId, serverName) =>
    getMCPManager()?.disconnectUserConnection(userId, serverName),
  uninstallOAuthMCP: maybeUninstallOAuthMCP,
});
