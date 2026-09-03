const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  isTarsConfigured,
  createTarsPrompt,
  updateTarsPrompt,
  deleteTarsPrompt,
  fetchTarsPromptsForChat,
  fetchTarsDomainKnowledgeBases,
  fetchTarsKnowledgeBasePrompts,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();
router.use(requireJwtAuth);

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
    return res.status(500).json({ error: 'Failed to fetch pwc_tars prompts' });
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
    return res.status(500).json({ error: 'Failed to fetch pwc_tars knowledge base prompts' });
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
    return res.status(500).json({ error: 'Failed to create pwc_tars prompt' });
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
    return res.status(500).json({ error: 'Failed to update pwc_tars prompt' });
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
    return res.status(500).json({ error: 'Failed to delete pwc_tars prompt' });
  }
});

module.exports = router;
