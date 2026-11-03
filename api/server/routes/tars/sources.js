const express = require('express');
const { createTarsSourceFileHandler } = require('@librechat/api');
const db = require('~/models');

const router = express.Router();

const sendTarsSourceFile = createTarsSourceFileHandler({
  findAgent: (agentId) => db.getAgent({ id: agentId }, { tools: 1, tars_source_download: 1 }),
});

/**
 * @route GET /api/tars/kb-files/:agentId/:knowledgeBaseId/:documentId
 * @desc Relay a knowledge-base file cited in an answer, while the agent's 參考資料下載 is on.
 * @access Signed link (`?sig=`) minted when the knowledge search ran
 */
router.get('/:agentId/:knowledgeBaseId/:documentId', sendTarsSourceFile);

module.exports = router;
