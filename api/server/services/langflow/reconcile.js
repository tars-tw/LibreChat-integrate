const { SystemRoles, EModelEndpoint } = require('librechat-data-provider');
const {
  fetchWorkflowFlows,
  resolveLangflowOrigin,
  createWorkflowAgentSync,
} = require('@librechat/api');
const { getMCPServerTools, invalidateCachedTools } = require('~/server/services/Config');
const { grantPermission } = require('~/server/services/PermissionService');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const db = require('~/models');

/** Fallback orchestration provider/model, used only for a flow whose TARS node leaves the model
 *  blank ("let pwc_tars pick"). Env-overridable so other deployments can route Workflow agents
 *  through a different endpoint/model than this instance's defaults. */
const PROVIDER = process.env.LANGFLOW_AGENT_PROVIDER || EModelEndpoint.openAI;
const MODEL = process.env.LANGFLOW_AGENT_MODEL || 'gpt-5.4-mini';

const syncWorkflowAgents = createWorkflowAgentSync({
  fetchFlows: (tarsId) => {
    const origin = resolveLangflowOrigin();
    const apiKey = process.env.LANGFLOW_API_KEY;
    return origin && apiKey ? fetchWorkflowFlows(origin, apiKey, tarsId) : Promise.resolve(null);
  },
  findSharedOwner: () => {
    const email = process.env.LANGFLOW_AGENT_OWNER_EMAIL;
    return db.findUser(email ? { email } : { role: SystemRoles.ADMIN }, '_id');
  },
  getAgents: (filter) => db.getAgents(filter),
  createAgent: (data) => db.createAgent(data),
  updateAgent: (filter, changes) => db.updateAgent(filter, changes, { skipVersioning: true }),
  deleteAgent: (filter) => db.deleteAgent(filter),
  grantPermission,
  defaultOrchestration: { provider: PROVIDER, model: MODEL },
  getCachedTools: (userId, serverName) => getMCPServerTools(userId, serverName),
  invalidateCachedTools: (userId, serverName) => invalidateCachedTools({ userId, serverName }),
});

/**
 * Keeps the Workflow agents in step with Langflow before an agent list is served: the shared
 * account's flows for everyone, the requesting user's own flows for them (see
 * `createWorkflowAgentSync` in `@librechat/api`). Never throws.
 *
 * @param {ServerRequest} req - The agent-list request; its user decides whose personal flows sync,
 *   and it loads this instance's model catalogue when a flow names a model.
 */
async function reconcileLangflowAgents(req) {
  if (!req?.user?.id) {
    return;
  }
  await syncWorkflowAgents({ id: req.user.id, tarsId: req.user.tarsId }, () =>
    getModelsConfig(req),
  );
}

module.exports = { reconcileLangflowAgents };
