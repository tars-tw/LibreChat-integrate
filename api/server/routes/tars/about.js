const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { fetchTarsReleaseNotes } = require('@librechat/api');
const { requireJwtAuth, requireTarsMenuAccess } = require('~/server/middleware');
const { relayTarsError } = require('./relay');

const router = express.Router();

router.use('/home', requireJwtAuth);

/**
 * @route GET /api/tars/home
 * @desc Published release notes from pwc_tars.
 * @access Admin, or a role granted 關於 (`admin.about`)
 */
router.get('/home', requireTarsMenuAccess('admin.about'), async (req, res) => {
  try {
    const releaseNotes = await fetchTarsReleaseNotes();
    return res.json({ releaseNotes });
  } catch (error) {
    logger.error('[GET /api/tars/home] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars release notes');
  }
});

module.exports = router;
