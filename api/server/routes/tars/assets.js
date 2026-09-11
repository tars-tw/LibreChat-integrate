const express = require('express');
const { sendTarsAsset } = require('@librechat/api');

const router = express.Router();

/**
 * @route GET /api/tars/static/:dir/*splat
 * @desc Relay a pwc_tars generated chart or file so the browser never has to reach pwc_tars.
 * @access Signed link (`?sig=`) minted when the tool result is relayed
 */
router.get('/:dir/*splat', sendTarsAsset);

module.exports = router;
