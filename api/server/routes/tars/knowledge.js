const multer = require('multer');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  fetchTarsModelOptions,
  createTarsKnowledgeBase,
  updateTarsKnowledgeBase,
  deleteTarsKnowledgeBase,
  fetchTarsKnowledgeBases,
  createTarsKnowledgeBaseWithFile,
  fetchTarsKnowledgeBaseDocuments,
  uploadTarsKnowledgeBaseDocuments,
  renameTarsKnowledgeBaseDocument,
  deleteTarsKnowledgeBaseDocument,
  reprocessTarsKnowledgeBaseDocument,
  fetchTarsDocumentChunks,
  updateTarsChunk,
  deleteTarsChunk,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireJwtAuth);
router.use(requireTarsAdmin);

/**
 * @route GET /api/tars/knowledge-bases
 * @desc List pwc_tars knowledge bases with document/chunk/token stats.
 * @access Admin (pwc_tars)
 */
router.get('/knowledge-bases', async (req, res) => {
  try {
    const knowledgeBases = await fetchTarsKnowledgeBases(req.user.tarsId);
    return res.json({ knowledgeBases });
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars knowledge bases' });
  }
});

/**
 * @route GET /api/tars/knowledge-bases/models
 * @desc LLM / embedding / rerank model options for the upload form.
 * @access Admin (pwc_tars)
 */
router.get('/knowledge-bases/models', async (req, res) => {
  try {
    const models = await fetchTarsModelOptions();
    return res.json(models);
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases/models] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars model options' });
  }
});

/**
 * @route POST /api/tars/knowledge-bases
 * @desc Create an empty knowledge base.
 * @access Admin (pwc_tars)
 */
router.post('/knowledge-bases', async (req, res) => {
  try {
    const knowledgeBase = await createTarsKnowledgeBase(req.user.tarsId, req.body ?? {});
    return res.status(201).json({ knowledgeBase });
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases] Failed', error);
    return res.status(500).json({ error: 'Failed to create pwc_tars knowledge base' });
  }
});

/**
 * @route POST /api/tars/knowledge-bases/upload
 * @desc Create a knowledge base (+ RAG config), optionally seeding it with a
 *       file. pwc_tars creates the KB and SysRAGModel even without a file.
 * @access Admin (pwc_tars)
 */
router.post('/knowledge-bases/upload', upload.single('file'), async (req, res) => {
  const {
    knowledgeName,
    description,
    tags,
    llmModel,
    embeddingModel,
    rerankModel,
    maxRetrieveCount,
  } = req.body ?? {};
  if (!knowledgeName || !llmModel) {
    return res.status(400).json({ error: 'knowledgeName and llmModel are required' });
  }

  try {
    const result = await createTarsKnowledgeBaseWithFile(req.user.tarsId, {
      knowledgeName,
      description,
      tags,
      llmModel,
      embeddingModel,
      rerankModel,
      maxRetrieveCount: maxRetrieveCount != null ? Number(maxRetrieveCount) : undefined,
      file: req.file
        ? {
            buffer: req.file.buffer,
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
          }
        : undefined,
    });
    return res.status(201).json(result);
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/upload] Failed', error);
    return res.status(500).json({ error: 'Failed to create pwc_tars knowledge base' });
  }
});

/**
 * @route GET /api/tars/knowledge-bases/:id/documents
 * @desc List documents in a knowledge base.
 * @access Admin (pwc_tars)
 */
router.get('/knowledge-bases/:id/documents', async (req, res) => {
  try {
    const documents = await fetchTarsKnowledgeBaseDocuments(req.params.id);
    return res.json({ documents });
  } catch (error) {
    logger.error('[GET /api/tars/knowledge-bases/:id/documents] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars documents' });
  }
});

/**
 * @route POST /api/tars/knowledge-bases/:id/documents
 * @desc Upload one or more documents into a knowledge base.
 * @access Admin (pwc_tars)
 */
router.post('/knowledge-bases/:id/documents', upload.array('files'), async (req, res) => {
  const files = req.files ?? [];
  if (files.length === 0) {
    return res.status(400).json({ error: 'At least one file is required' });
  }
  const { chunkSize, overlap, processImages, fileSettings, tags } = req.body ?? {};
  let parsedFileSettings;
  if (fileSettings) {
    try {
      parsedFileSettings = JSON.parse(fileSettings);
    } catch {
      return res.status(400).json({ error: 'fileSettings must be valid JSON' });
    }
  }

  try {
    const result = await uploadTarsKnowledgeBaseDocuments(req.user.tarsId, {
      knowledgeBaseId: req.params.id,
      files: files.map((file) => ({
        buffer: file.buffer,
        filename: file.originalname,
        mimetype: file.mimetype,
      })),
      chunkSize: chunkSize != null ? Number(chunkSize) : undefined,
      overlap: overlap != null ? Number(overlap) : undefined,
      processImages:
        processImages != null ? processImages === 'true' || processImages === true : undefined,
      fileSettings: parsedFileSettings,
      tags,
    });
    return res.status(201).json(result);
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/:id/documents] Failed', error);
    return res.status(500).json({ error: 'Failed to upload pwc_tars documents' });
  }
});

/**
 * @route PUT /api/tars/knowledge-bases/:id/documents/:docId/rename
 * @desc Rename a document.
 * @access Admin (pwc_tars)
 */
router.put('/knowledge-bases/:id/documents/:docId/rename', async (req, res) => {
  const { newFilename } = req.body ?? {};
  if (!newFilename) {
    return res.status(400).json({ error: 'newFilename is required' });
  }
  try {
    const document = await renameTarsKnowledgeBaseDocument(req.user.tarsId, {
      knowledgeBaseId: req.params.id,
      documentId: req.params.docId,
      newFilename,
    });
    return res.json({ document });
  } catch (error) {
    logger.error('[PUT /api/tars/knowledge-bases/:id/documents/:docId/rename] Failed', error);
    return res.status(500).json({ error: 'Failed to rename pwc_tars document' });
  }
});

/**
 * @route DELETE /api/tars/knowledge-bases/:id/documents/:docId
 * @desc Delete a document (pwc_tars cascades chunks / vectors).
 * @access Admin (pwc_tars)
 */
router.delete('/knowledge-bases/:id/documents/:docId', async (req, res) => {
  try {
    await deleteTarsKnowledgeBaseDocument(req.user.tarsId, {
      knowledgeBaseId: req.params.id,
      documentId: req.params.docId,
    });
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/knowledge-bases/:id/documents/:docId] Failed', error);
    return res.status(500).json({ error: 'Failed to delete pwc_tars document' });
  }
});

/**
 * @route POST /api/tars/knowledge-bases/:id/documents/:docId/reprocess
 * @desc Re-chunk and re-embed an existing document.
 * @access Admin (pwc_tars)
 */
router.post('/knowledge-bases/:id/documents/:docId/reprocess', async (req, res) => {
  const { chunkSize, overlap } = req.body ?? {};
  try {
    const result = await reprocessTarsKnowledgeBaseDocument(req.user.tarsId, {
      knowledgeBaseId: req.params.id,
      documentId: req.params.docId,
      chunkSize: chunkSize != null ? Number(chunkSize) : undefined,
      overlap: overlap != null ? Number(overlap) : undefined,
    });
    return res.json(result);
  } catch (error) {
    logger.error('[POST /api/tars/knowledge-bases/:id/documents/:docId/reprocess] Failed', error);
    return res.status(500).json({ error: 'Failed to reprocess pwc_tars document' });
  }
});

/**
 * @route GET /api/tars/documents/:docId/chunks
 * @desc List chunks of a document.
 * @access Admin (pwc_tars)
 */
router.get('/documents/:docId/chunks', async (req, res) => {
  try {
    const chunks = await fetchTarsDocumentChunks(req.params.docId);
    return res.json({ chunks });
  } catch (error) {
    logger.error('[GET /api/tars/documents/:docId/chunks] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars chunks' });
  }
});

/**
 * @route PUT /api/tars/chunks/:chunkId
 * @desc Update a chunk's content.
 * @access Admin (pwc_tars)
 */
router.put('/chunks/:chunkId', async (req, res) => {
  const { content } = req.body ?? {};
  if (content == null) {
    return res.status(400).json({ error: 'content is required' });
  }
  try {
    const chunk = await updateTarsChunk(req.user.tarsId, {
      chunkId: req.params.chunkId,
      content,
    });
    return res.json({ chunk });
  } catch (error) {
    logger.error('[PUT /api/tars/chunks/:chunkId] Failed', error);
    return res.status(500).json({ error: 'Failed to update pwc_tars chunk' });
  }
});

/**
 * @route DELETE /api/tars/chunks/:chunkId
 * @desc Delete a chunk.
 * @access Admin (pwc_tars)
 */
router.delete('/chunks/:chunkId', async (req, res) => {
  try {
    await deleteTarsChunk(req.params.chunkId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/chunks/:chunkId] Failed', error);
    return res.status(500).json({ error: 'Failed to delete pwc_tars chunk' });
  }
});

/**
 * @route PUT /api/tars/knowledge-bases/:id
 * @desc Update a knowledge base (name/description/retrieve count/domain binding).
 * @access Admin (pwc_tars)
 */
router.put('/knowledge-bases/:id', async (req, res) => {
  try {
    const knowledgeBase = await updateTarsKnowledgeBase(
      req.user.tarsId,
      req.params.id,
      req.body ?? {},
    );
    return res.json({ knowledgeBase });
  } catch (error) {
    logger.error('[PUT /api/tars/knowledge-bases/:id] Failed', error);
    return res.status(500).json({ error: 'Failed to update pwc_tars knowledge base' });
  }
});

/**
 * @route DELETE /api/tars/knowledge-bases/:id
 * @desc Delete a knowledge base (pwc_tars cascades Milvus / chunks / documents).
 * @access Admin (pwc_tars)
 */
router.delete('/knowledge-bases/:id', async (req, res) => {
  try {
    await deleteTarsKnowledgeBase(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/knowledge-bases/:id] Failed', error);
    return res.status(500).json({ error: 'Failed to delete pwc_tars knowledge base' });
  }
});

module.exports = router;
