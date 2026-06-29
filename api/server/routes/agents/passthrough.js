/**
 * OpenAI-compatible model-passthrough routes.
 *
 * `POST /api/agents/v1m/chat/completions` — chat with a real provider/model
 * (`model: "openAI/gpt-5.4-mini"`) rather than an agent_id. Omits the per-agent
 * ACL check (`checkAgentPermission`) since there is no stored agent.
 *
 * Auth: a shared `LLM_GATEWAY_SERVICE_KEY` (trusted service-to-service) takes
 * precedence; otherwise it falls back to per-user remote-agent API keys +
 * the REMOTE_AGENTS feature gate.
 */
const express = require('express');
const { PassthroughChatCompletionController } = require('~/server/controllers/agents/passthrough');
const { configMiddleware } = require('~/server/middleware');
const {
  gatewayServiceAuth,
  preAuthTenantMiddleware,
  skipFeatureIfServiceAuth,
} = require('./middleware');

const router = express.Router();

router.use(preAuthTenantMiddleware);
router.use(gatewayServiceAuth);
router.use(configMiddleware);
router.use(skipFeatureIfServiceAuth);

router.post('/chat/completions', PassthroughChatCompletionController);

module.exports = router;
