const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  fetchTarsKnowledgeBaseDatasets,
  importTarsWebsiteDataset,
  updateTarsWebsiteDataset,
  deleteTarsWebsiteDataset,
  fetchTarsWebsiteChunks,
  fetchTarsDatabaseTables,
  fetchTarsBoundTables,
  bindTarsDatabase,
  unbindTarsDatabase,
  fetchTarsDatabasePrompt,
  updateTarsDatabasePrompt,
  fetchTarsFileSystemSources,
  fetchTarsFileSystemFiles,
  importTarsFileSystemDataset,
  refreshTarsFileSystemDataset,
  rebuildTarsFileSystemDataset,
  reprocessTarsFileSystemDataset,
  unlinkTarsFileSystemDataset,
  batchDeleteTarsDatasets,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsMenuAccess } = require('~/server/middleware');
const { relayTarsError } = require('./relay');

const router = express.Router();

/** Shares `/knowledge-bases` with the knowledge router, so the gate names only this router's sub-resources. */
const KNOWLEDGE_BASE_SOURCES = ['databases', 'datasets', 'file-systems', 'websites'].map(
  (source) => `/knowledge-bases/:id/${source}`,
);

/** The detail page behind 知識庫清單, so the same grant opens it. */
router.use(KNOWLEDGE_BASE_SOURCES, requireJwtAuth, requireTarsMenuAccess('kb.list'));

/**
 * @route GET /api/tars/knowledge-bases/:id/datasets
 * @desc Every dataset in a knowledge base, with the system upload limits.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.get('/knowledge-bases/:id/datasets', async (req, res) => {
  try {
    const datasets = await fetchTarsKnowledgeBaseDatasets(req.user.tarsId, req.params.id);
    return res.json(datasets);
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases/:id/datasets] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars datasets');
  }
});

/**
 * @route POST /api/tars/knowledge-bases/:id/websites
 * @desc Crawl a site and import it as a dataset.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.post('/knowledge-bases/:id/websites', async (req, res) => {
  const { name, url, description, enabled, chunkSize } = req.body ?? {};
  if (!name || !url) {
    return res.status(400).json({ error: 'name and url are required' });
  }

  try {
    const website = await importTarsWebsiteDataset(req.user.tarsId, {
      knowledgeBaseId: req.params.id,
      name,
      url,
      description,
      enabled,
      chunkSize: chunkSize != null ? Number(chunkSize) : undefined,
    });
    return res.status(201).json({ website });
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/:id/websites] Failed', error);
    return relayTarsError(res, error, 'Failed to import pwc_tars website dataset');
  }
});

/**
 * @route PUT /api/tars/knowledge-bases/:id/websites/:websiteId
 * @desc Rename or re-describe a website dataset. The URL is fixed at import.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.put('/knowledge-bases/:id/websites/:websiteId', async (req, res) => {
  const { name, description } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const website = await updateTarsWebsiteDataset(req.user.tarsId, req.params.websiteId, {
      name,
      description,
    });
    return res.json({ website });
  } catch (error) {
    logger.error('[PUT /api/tars/knowledge-bases/:id/websites/:websiteId] Failed', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars website dataset');
  }
});

/**
 * @route DELETE /api/tars/knowledge-bases/:id/websites/:websiteId
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.delete('/knowledge-bases/:id/websites/:websiteId', async (req, res) => {
  try {
    await deleteTarsWebsiteDataset(req.user.tarsId, req.params.id, req.params.websiteId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/knowledge-bases/:id/websites/:websiteId] Failed', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars website dataset');
  }
});

/**
 * @route GET /api/tars/knowledge-bases/:id/websites/:websiteId/chunks
 * @desc Every crawled chunk of one website dataset.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.get('/knowledge-bases/:id/websites/:websiteId/chunks', async (req, res) => {
  try {
    const page = await fetchTarsWebsiteChunks(req.user.tarsId, req.params.websiteId);
    return res.json(page);
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases/:id/websites/:websiteId/chunks] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars website chunks');
  }
});

/**
 * @route GET /api/tars/knowledge-bases/:id/databases/:databaseId/tables
 * @desc The connection's tables and views, plus the ones already bound.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.get('/knowledge-bases/:id/databases/:databaseId/tables', async (req, res) => {
  try {
    const [available, bound] = await Promise.all([
      fetchTarsDatabaseTables(req.user.tarsId, req.params.id, req.params.databaseId),
      fetchTarsBoundTables(req.user.tarsId, req.params.id, req.params.databaseId),
    ]);
    return res.json({ ...available, bound });
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases/:id/databases/:databaseId/tables] Failed', error);
    return relayTarsError(res, error, 'Failed to list pwc_tars database tables');
  }
});

/**
 * @route PUT /api/tars/knowledge-bases/:id/databases/:databaseId
 * @desc Bind the chosen tables. Re-sending a different list adjusts a binding.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.put('/knowledge-bases/:id/databases/:databaseId', async (req, res) => {
  const { tables } = req.body ?? {};
  if (!Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({ error: 'tables must be a non-empty array' });
  }

  try {
    await bindTarsDatabase(req.user.tarsId, req.params.id, req.params.databaseId, tables);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[PUT /api/tars/knowledge-bases/:id/databases/:databaseId] Failed', error);
    return relayTarsError(res, error, 'Failed to bind pwc_tars database');
  }
});

/**
 * @route DELETE /api/tars/knowledge-bases/:id/databases/:databaseId
 * @desc Unbind. The connection itself is left in place.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.delete('/knowledge-bases/:id/databases/:databaseId', async (req, res) => {
  try {
    await unbindTarsDatabase(req.user.tarsId, req.params.id, req.params.databaseId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/knowledge-bases/:id/databases/:databaseId] Failed', error);
    return relayTarsError(res, error, 'Failed to unbind pwc_tars database');
  }
});

/**
 * @route GET /api/tars/knowledge-bases/:id/databases/:databaseId/prompt
 * @desc The schema description the text-to-SQL prompt is built from.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.get('/knowledge-bases/:id/databases/:databaseId/prompt', async (req, res) => {
  try {
    const prompt = await fetchTarsDatabasePrompt(req.params.id, req.params.databaseId);
    return res.json(prompt);
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases/:id/databases/:databaseId/prompt] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars database prompt');
  }
});

/**
 * @route PUT /api/tars/knowledge-bases/:id/databases/:databaseId/prompt
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.put('/knowledge-bases/:id/databases/:databaseId/prompt', async (req, res) => {
  const { bindingId, tableInfo } = req.body ?? {};
  if (!bindingId || typeof tableInfo !== 'string') {
    return res.status(400).json({ error: 'bindingId and tableInfo are required' });
  }

  try {
    await updateTarsDatabasePrompt(req.user.tarsId, bindingId, tableInfo);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[PUT /api/tars/knowledge-bases/:id/databases/:databaseId/prompt] Failed', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars database prompt');
  }
});

/**
 * @route GET /api/tars/knowledge-bases/:id/file-systems
 * @desc The file servers this knowledge base may import a document group from.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.get('/knowledge-bases/:id/file-systems', async (req, res) => {
  try {
    const sources = await fetchTarsFileSystemSources(req.user.tarsId, req.params.id);
    return res.json({ sources });
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases/:id/file-systems] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars file systems');
  }
});

/**
 * @route GET /api/tars/knowledge-bases/:id/file-systems/:fsId/files
 * @desc What the file server currently holds, for the import picker.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.get('/knowledge-bases/:id/file-systems/:fsId/files', async (req, res) => {
  try {
    const files = await fetchTarsFileSystemFiles(req.user.tarsId, req.params.id, req.params.fsId);
    return res.json({ files });
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases/:id/file-systems/:fsId/files] Failed', error);
    return relayTarsError(res, error, 'Failed to list pwc_tars file server files');
  }
});

/**
 * @route POST /api/tars/knowledge-bases/:id/file-systems/:fsId
 * @desc Import a document group from a file server.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.post('/knowledge-bases/:id/file-systems/:fsId', async (req, res) => {
  const { name, syncAll, uploadOnly, files, chunkSize, overlap, selectedFolder, tags } =
    req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    await importTarsFileSystemDataset(req.user.tarsId, {
      knowledgeBaseId: req.params.id,
      fileSystemId: req.params.fsId,
      name,
      syncAll,
      uploadOnly,
      files: Array.isArray(files) ? files : undefined,
      chunkSize: chunkSize != null ? Number(chunkSize) : undefined,
      overlap: overlap != null ? Number(overlap) : undefined,
      selectedFolder: typeof selectedFolder === 'string' ? selectedFolder : undefined,
      tags,
    });
    return res.status(201).json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/:id/file-systems/:fsId] Failed', error);
    return relayTarsError(res, error, 'Failed to import pwc_tars document group');
  }
});

/**
 * @route POST /api/tars/knowledge-bases/:id/file-systems/:fsId/refresh
 * @desc Pull anything new or newer from the file server.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.post('/knowledge-bases/:id/file-systems/:fsId/refresh', async (req, res) => {
  const { chunkSize, overlap } = req.body ?? {};
  try {
    await refreshTarsFileSystemDataset(req.user.tarsId, req.params.id, req.params.fsId, {
      chunkSize: chunkSize != null ? Number(chunkSize) : undefined,
      overlap: overlap != null ? Number(overlap) : undefined,
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/:id/file-systems/:fsId/refresh] Failed', error);
    return relayTarsError(res, error, 'Failed to refresh pwc_tars document group');
  }
});

/**
 * @route POST /api/tars/knowledge-bases/:id/file-systems/:fsId/rebuild
 * @desc Delete every existing document in the group and re-import everything
 *       from the source file server. Destructive; pwc_tars rejects it with
 *       409 while a document in the group is still processing.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.post('/knowledge-bases/:id/file-systems/:fsId/rebuild', async (req, res) => {
  const { chunkSize, overlap } = req.body ?? {};
  try {
    await rebuildTarsFileSystemDataset(req.user.tarsId, req.params.id, req.params.fsId, {
      chunkSize: chunkSize != null ? Number(chunkSize) : undefined,
      overlap: overlap != null ? Number(overlap) : undefined,
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/:id/file-systems/:fsId/rebuild] Failed', error);
    return relayTarsError(res, error, 'Failed to rebuild pwc_tars document group');
  }
});

/**
 * @route POST /api/tars/knowledge-bases/:id/file-systems/:fsId/reprocess
 * @desc Reprocess every document in the group that did not finish.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.post('/knowledge-bases/:id/file-systems/:fsId/reprocess', async (req, res) => {
  try {
    await reprocessTarsFileSystemDataset(req.user.tarsId, req.params.id, req.params.fsId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/:id/file-systems/:fsId/reprocess] Failed', error);
    return relayTarsError(res, error, 'Failed to reprocess pwc_tars document group');
  }
});

/**
 * @route DELETE /api/tars/knowledge-bases/:id/file-systems/:fsId
 * @desc Unlink the group, deleting the documents it brought in.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.delete('/knowledge-bases/:id/file-systems/:fsId', async (req, res) => {
  try {
    await unlinkTarsFileSystemDataset(req.user.tarsId, req.params.id, req.params.fsId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/knowledge-bases/:id/file-systems/:fsId] Failed', error);
    return relayTarsError(res, error, 'Failed to unlink pwc_tars document group');
  }
});

/**
 * @route POST /api/tars/knowledge-bases/:id/datasets/batch-delete
 * @desc Delete several datasets at once. pwc_tars answers before the work is
 *       done, so the client must refetch rather than assume completion.
 * @access 知識庫清單 (kb.list) or pwc_tars admin
 */
router.post('/knowledge-bases/:id/datasets/batch-delete', async (req, res) => {
  const { documentIds, websiteIds, databaseIds, fileSystemIds } = req.body ?? {};
  const total =
    (documentIds?.length ?? 0) +
    (websiteIds?.length ?? 0) +
    (databaseIds?.length ?? 0) +
    (fileSystemIds?.length ?? 0);
  if (total === 0) {
    return res.status(400).json({ error: 'At least one id is required' });
  }

  try {
    await batchDeleteTarsDatasets(req.user.tarsId, req.params.id, {
      documentIds,
      websiteIds,
      databaseIds,
      fileSystemIds,
    });
    return res.status(202).json({ accepted: total });
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/:id/datasets/batch-delete] Failed', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars datasets');
  }
});

module.exports = router;
