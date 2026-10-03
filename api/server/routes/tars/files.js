const express = require('express');
const { createTarsFileHandler, resolveDownloadPath } = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { configMiddleware } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const sendTarsFile = createTarsFileHandler({
  findFile: async (fileId, userId) => {
    const [file] = (await db.getFiles({ file_id: fileId, user: userId })) ?? [];
    return file ?? null;
  },
  openStream: (req, file) =>
    getStrategyFunctions(file.source).getDownloadStream(req, resolveDownloadPath(file)),
});

/**
 * @route GET /api/tars/files/:fileId
 * @desc Stream a user's spreadsheet to pwc_tars's data tools.
 * @access Signed reference (`?u=&exp=&sig=`) minted for each tool call
 */
router.get('/:fileId', configMiddleware, sendTarsFile);

module.exports = router;
