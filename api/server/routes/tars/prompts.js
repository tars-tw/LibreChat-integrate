const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { PermissionBits } = require('librechat-data-provider');
const {
  isTarsConfigured,
  createTarsPrompt,
  updateTarsPrompt,
  deleteTarsPrompt,
  fetchTarsPromptsForChat,
  renameTarsPromptCategory,
  fetchTarsDomainKnowledgeBases,
  fetchTarsKnowledgeBasePrompts,
  fetchTarsChatPrompts,
  fetchTarsAgentPrompts,
  createTarsAgentPrompt,
  updateTarsAgentPrompt,
  renameTarsAgentPromptCategory,
  resolveTarsChatPromptAgent,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin, canAccessAgentResource } = require('~/server/middleware');
const { checkPermission } = require('~/server/services/PermissionService');
const { hasCapability } = require('~/server/middleware/roles/capabilities');
const { getAgent } = require('~/models');
const { relayTarsError } = require('./relay');

const router = express.Router();
router.use('/prompts', requireJwtAuth);

/** An agent's prompts are managed by whoever may edit the agent (author or editor share). */
const canEditAgentPrompts = canAccessAgentResource({
  requiredPermission: PermissionBits.EDIT,
  resourceIdParam: 'agent_id',
});

/**
 * @route GET /api/tars/prompts
 * @desc The three-tier "我的提示" list (personal + specialized brain + its knowledge
 *       bases) for the conversation's current brain (`domain_id` query param).
 * @access Private
 */
router.get('/prompts', async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.json({ prompts: [], knowledgeBases: [] });
  }

  try {
    const [prompts, knowledgeBases] = await Promise.all([
      fetchTarsPromptsForChat(req.user.tarsId, req.query.domain_id),
      fetchTarsDomainKnowledgeBases(req.user.tarsId, req.query.domain_id),
    ]);
    return res.json({ prompts, knowledgeBases });
  } catch (error) {
    logger.error('[GET /api/tars/prompts] Failed to fetch pwc_tars prompts', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars prompts');
  }
});

/**
 * @route GET /api/tars/prompts/chat
 * @desc The chat's "我的提示": the selected agent's prompts (`agent_id`, when the user may
 *       view that agent), those of the knowledge bases the agent's 知識庫檢索 picked
 *       (`knowledge_base_ids`, comma separated) that the user may use in chat, and personal
 *       prompts. No 專用腦 tier.
 * @access Private
 */
router.get('/prompts/chat', async (req, res) => {
  const ids = String(req.query.knowledge_base_ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  try {
    const agent = await resolveTarsChatPromptAgent(req.user, req.query.agent_id, {
      getAgent,
      hasCapability,
      checkPermission,
    });
    return res.json(await fetchTarsChatPrompts(req.user.tarsId, ids, agent));
  } catch (error) {
    logger.error('[GET /api/tars/prompts/chat] Failed to fetch pwc_tars prompts', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars prompts');
  }
});

/**
 * @route GET /api/tars/prompts/knowledge-base/:id
 * @desc A knowledge base's own prompts (`prompt_to_knowledge_base`), for the
 *       admin knowledge-base manager's "提示詞管理" dialog. Admin-only, unlike
 *       the conversation-scoped list above.
 * @access Private (admin)
 */
router.get('/prompts/knowledge-base/:id', requireTarsAdmin, async (req, res) => {
  if (!isTarsConfigured()) {
    return res.json({ prompts: [] });
  }

  try {
    const prompts = await fetchTarsKnowledgeBasePrompts(req.params.id);
    return res.json({ prompts });
  } catch (error) {
    logger.error(
      '[GET /api/tars/prompts/knowledge-base/:id] Failed to fetch pwc_tars KB prompts',
      error,
    );
    return relayTarsError(res, error, 'Failed to fetch pwc_tars knowledge base prompts');
  }
});

/**
 * @route GET /api/tars/prompts/agent/:agent_id
 * @desc An agent's own prompts (`prompt_to_agent`), for its prompt management page.
 * @access Private (may edit the agent)
 */
router.get('/prompts/agent/:agent_id', canEditAgentPrompts, async (req, res) => {
  if (!isTarsConfigured()) {
    return res.json({ prompts: [] });
  }

  try {
    const prompts = await fetchTarsAgentPrompts(req.params.agent_id);
    return res.json({ prompts });
  } catch (error) {
    logger.error('[GET /api/tars/prompts/agent/:agent_id] Failed to fetch agent prompts', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars agent prompts');
  }
});

/**
 * @route POST /api/tars/prompts/agent/:agent_id
 * @desc Create a prompt on the agent.
 * @access Private (may edit the agent)
 */
router.post('/prompts/agent/:agent_id', canEditAgentPrompts, async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.status(400).json({ error: 'pwc_tars is not configured' });
  }

  try {
    const prompt = await createTarsAgentPrompt(
      req.user.tarsId,
      req.params.agent_id,
      req.body ?? {},
    );
    return res.status(201).json({ prompt });
  } catch (error) {
    logger.error('[POST /api/tars/prompts/agent/:agent_id] Failed to create agent prompt', error);
    return relayTarsError(res, error, 'Failed to create pwc_tars agent prompt');
  }
});

/**
 * @route PUT /api/tars/prompts/agent/:agent_id/categories/rename
 * @desc Move the agent's prompts from `old_category` to `new_category`.
 * @access Private (may edit the agent)
 */
router.put('/prompts/agent/:agent_id/categories/rename', canEditAgentPrompts, async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.status(400).json({ error: 'pwc_tars is not configured' });
  }

  try {
    const result = await renameTarsAgentPromptCategory(
      req.user.tarsId,
      req.params.agent_id,
      req.body ?? {},
    );
    return res.json(result);
  } catch (error) {
    logger.error('[PUT /api/tars/prompts/agent/:agent_id/categories/rename] Failed', error);
    return relayTarsError(res, error, 'Failed to rename pwc_tars agent prompt category');
  }
});

/**
 * @route PUT /api/tars/prompts/agent/:agent_id/:id
 * @desc Update one of the agent's prompts; a prompt of another agent is 404.
 * @access Private (may edit the agent)
 */
router.put('/prompts/agent/:agent_id/:id', canEditAgentPrompts, async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.status(400).json({ error: 'pwc_tars is not configured' });
  }

  try {
    const prompt = await updateTarsAgentPrompt(
      req.user.tarsId,
      req.params.agent_id,
      req.params.id,
      req.body ?? {},
    );
    return res.json({ prompt });
  } catch (error) {
    logger.error(
      '[PUT /api/tars/prompts/agent/:agent_id/:id] Failed to update agent prompt',
      error,
    );
    return relayTarsError(res, error, 'Failed to update pwc_tars agent prompt');
  }
});

/**
 * @route DELETE /api/tars/prompts/agent/:agent_id/:id
 * @desc Delete one of the agent's prompts; a prompt of another agent is 404.
 * @access Private (may edit the agent)
 */
router.delete('/prompts/agent/:agent_id/:id', canEditAgentPrompts, async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.status(400).json({ error: 'pwc_tars is not configured' });
  }

  try {
    await deleteTarsPrompt(req.params.id, { agentId: req.params.agent_id });
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/prompts/agent/:agent_id/:id] Failed', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars agent prompt');
  }
});

/**
 * @route POST /api/tars/prompts
 * @desc Create a prompt. Body `domain_id` / `knowledge_base_id` route it to the
 *       specialized-brain or knowledge-base tier; otherwise it is personal.
 * @access Private
 */
router.post('/prompts', async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.status(400).json({ error: 'pwc_tars is not configured' });
  }

  try {
    const prompt = await createTarsPrompt(req.user.tarsId, req.body ?? {});
    return res.status(201).json({ prompt });
  } catch (error) {
    logger.error('[POST /api/tars/prompts] Failed to create pwc_tars prompt', error);
    return relayTarsError(res, error, 'Failed to create pwc_tars prompt');
  }
});

/**
 * @route PUT /api/tars/prompts/categories/rename
 * @desc Move one tier's prompts from `old_category` to `new_category` (rename, or
 *       delete a category by merging it into another). `domain_id` /
 *       `knowledge_base_id` pick the tier; otherwise the user's personal prompts.
 * @access Private
 */
router.put('/prompts/categories/rename', async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.status(400).json({ error: 'pwc_tars is not configured' });
  }

  try {
    const result = await renameTarsPromptCategory(req.user.tarsId, req.body ?? {});
    return res.json(result);
  } catch (error) {
    logger.error('[PUT /api/tars/prompts/categories/rename] Failed to rename category', error);
    return relayTarsError(res, error, 'Failed to rename pwc_tars prompt category');
  }
});

/**
 * @route PUT /api/tars/prompts/:id
 * @desc Update a prompt.
 * @access Private
 */
router.put('/prompts/:id', async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.status(400).json({ error: 'pwc_tars is not configured' });
  }

  try {
    const prompt = await updateTarsPrompt(req.user.tarsId, req.params.id, req.body ?? {});
    return res.json({ prompt });
  } catch (error) {
    logger.error('[PUT /api/tars/prompts/:id] Failed to update pwc_tars prompt', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars prompt');
  }
});

/**
 * @route DELETE /api/tars/prompts/:id
 * @desc Delete a prompt. `domain_id` / `knowledge_base_id` query params pick the tier.
 * @access Private
 */
router.delete('/prompts/:id', async (req, res) => {
  if (!isTarsConfigured() || !req.user?.tarsId) {
    return res.status(400).json({ error: 'pwc_tars is not configured' });
  }

  try {
    await deleteTarsPrompt(req.params.id, {
      domainId: req.query.domain_id,
      knowledgeBaseId: req.query.knowledge_base_id,
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/prompts/:id] Failed to delete pwc_tars prompt', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars prompt');
  }
});

module.exports = router;
