const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { getTarsModelProfileNames } = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

/**
 * @route GET /api/tars/models
 * @desc Names of the active pwc_tars model_profile rows — the whitelist the
 *       model selector uses to lock/reorder models. `models: null` means no
 *       restriction (TARS unconfigured or unreachable with no cached list).
 * @access Authenticated
 */
router.get('/models', async (req, res) => {
  try {
    const models = await getTarsModelProfileNames();
    return res.json({ models });
  } catch (error) {
    logger.error('[GET /api/tars/models] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars model profiles' });
  }
});

module.exports = router;
