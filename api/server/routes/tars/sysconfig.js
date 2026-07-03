const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { fetchTarsSysConfigs, updateTarsSysConfig } = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);
router.use(requireTarsAdmin);

/**
 * @route GET /api/tars/sys-configs
 * @desc List pwc_tars system parameters (sys_config rows with is_displayed=true).
 * @access Admin (pwc_tars)
 */
router.get('/sys-configs', async (req, res) => {
  try {
    const sysConfigs = await fetchTarsSysConfigs();
    return res.json({ sysConfigs });
  } catch (error) {
    logger.error('[GET /api/tars/sys-configs] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars system parameters' });
  }
});

/**
 * @route PUT /api/tars/sys-configs
 * @desc Update a system parameter's value/description/status; the provider key
 *       cache is invalidated so the change applies to the next chat request.
 * @access Admin (pwc_tars)
 */
router.put('/sys-configs', async (req, res) => {
  const { key, value, description, status } = req.body ?? {};
  if (!key) {
    return res.status(400).json({ error: 'key is required' });
  }
  try {
    await updateTarsSysConfig(
      { tarsId: req.user.tarsId, name: req.user.name ?? req.user.username ?? '' },
      { key, value, description, status },
    );
    return res.json({ success: true });
  } catch (error) {
    logger.error('[PUT /api/tars/sys-configs] Failed', error);
    return res.status(500).json({ error: 'Failed to update pwc_tars system parameter' });
  }
});

module.exports = router;
