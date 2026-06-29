/**
 * OpenAI-compatible "model passthrough" controller.
 *
 * Unlike the agent endpoint (`controllers/agents/openai.js`) where `model` is an
 * agent_id, here `model` is a real `"<provider>/<model>"` pair (e.g.
 * `openAI/gpt-5.4-mini`). It builds a bare ephemeral agent (no tools, no system
 * prompt) and reuses the shared `createAgentChatCompletion` streaming core, so
 * LibreChat acts as a plain LLM gateway to its configured providers.
 */
const { logger } = require('@librechat/data-schemas');
const {
  createRun,
  initializeAgent,
  createErrorResponse,
  resolvePassthroughModel,
  buildPassthroughGetAgent,
  createAgentChatCompletion,
} = require('@librechat/api');
const { getSkillDbMethods } = require('~/server/services/Endpoints/agents/skillDeps');
const { loadAgentTools } = require('~/server/services/ToolService');
const { getMCPServerTools } = require('~/server/services/Config');
const { logViolation } = require('~/cache');
const db = require('~/models');

function sendError(res, statusCode, message, code = null) {
  res.status(statusCode).json(createErrorResponse(message, 'invalid_request_error', code));
}

/**
 * Tool loader passed to `initializeAgent`. The ephemeral passthrough agent has
 * no tools, so this is effectively a no-op, but a valid loader keeps the shared
 * initialization path happy.
 */
function loadTools({ req, res, tools, model, agentId, provider, tool_options, tool_resources }) {
  const agent = { id: agentId, tools, provider, model, tool_options };
  return loadAgentTools({
    req,
    res,
    agent,
    tool_resources,
    definitionsOnly: true,
    streamId: null,
  }).catch((error) => {
    logger.error('[passthrough] Error loading tools for agent ' + agentId, error);
  });
}

const PassthroughChatCompletionController = async (req, res) => {
  const appConfig = req.config;
  const rawModel = req.body?.model;
  if (!rawModel || typeof rawModel !== 'string') {
    return sendError(res, 400, 'model is required');
  }

  const resolution = resolvePassthroughModel(rawModel, appConfig);
  if (!resolution.ok) {
    return sendError(res, 400, resolution.error, 'model_not_found');
  }

  const skillDbMethods = getSkillDbMethods();
  const dbMethods = {
    getConvoFiles: db.getConvoFiles,
    getFiles: db.getFiles,
    getUserKey: db.getUserKey,
    getMessages: db.getMessages,
    updateFilesUsage: db.updateFilesUsage,
    getUserKeyValues: db.getUserKeyValues,
    getUserCodeFiles: db.getUserCodeFiles,
    getToolFilesByIds: db.getToolFilesByIds,
    getCodeGeneratedFiles: db.getCodeGeneratedFiles,
    listSkillsByAccess: skillDbMethods.listSkillsByAccess,
    listAlwaysApplySkills: skillDbMethods.listAlwaysApplySkills,
    getSkillByName: skillDbMethods.getSkillByName,
  };

  const deps = {
    getAgent: buildPassthroughGetAgent(req, resolution.value, {
      getAgent: db.getAgent,
      getMCPServerTools,
    }),
    initializeAgent: (params) => initializeAgent(params, dbMethods),
    createRun,
    loadAgentTools: loadTools,
    logViolation,
    appConfig,
  };

  await createAgentChatCompletion(req, res, deps);
};

module.exports = { PassthroughChatCompletionController };
