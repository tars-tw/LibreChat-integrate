const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { fetchTarsReleaseNotes } = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);

/**
 * @route GET /api/tars/home
 * @desc Published release notes from pwc_tars.
 * @access Admin
 */
router.get('/home', requireTarsAdmin, async (req, res) => {
  try {
    const releaseNotes = await fetchTarsReleaseNotes();
    return res.json({ releaseNotes });
  } catch (error) {
    logger.error('[GET /api/tars/home] Failed', error);
    return res.status(500).json({
      error: 'Failed to fetch pwc_tars release notes',
    });
  }
});

module.exports = router;
