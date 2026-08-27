const { logger } = require('@librechat/data-schemas');
const { isTarsConfigured, rememberTarsChatContext } = require('@librechat/api');

/**
 * Records the model and the 專用腦 this chat turn runs on, so pwc_tars
 * reverse-calls made from inside the turn — the SQL agent, which reaches
 * LibreChat over MCP and therefore sees no request context — inherit both: the
 * nested loop runs on the user's model, and it may only reach the databases the
 * active brain binds.
 *
 * Mounted after `buildEndpointOption` because the resolved agent, not the
 * request body, is what names the model: saved-agent payloads carry no `model`
 * at all. Awaiting the agent costs nothing extra — the controller awaits the
 * same in-flight promise immediately after. Non-fatal: a failure only means the
 * nested run falls back to pwc_tars's default model and the user's full
 * database list.
 */
const recordTarsChatContext = async (req, res, next) => {
  try {
    if (!isTarsConfigured() || !req.user?.id) {
      return next();
    }
    const endpointOption = req.body?.endpointOption;
    const agent = await endpointOption?.agent;
    rememberTarsChatContext(req.user.id, {
      model: agent?.model ?? endpointOption?.model_parameters?.model ?? req.body?.model,
      domainId: endpointOption?.domain_id ?? req.body?.domain_id,
    });
  } catch (error) {
    logger.debug('[recordTarsChatContext] Failed to record the chat context', error);
  }
  return next();
};

module.exports = recordTarsChatContext;
