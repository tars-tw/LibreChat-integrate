const multer = require('multer');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  isTarsConfigured,
  TarsRequestError,
  uploadTarsMemoryFiles,
  listTarsMemoryDocuments,
  deleteTarsMemoryDocument,
  getTarsMemoryDocumentContent,
  downloadTarsMemoryDocument,
  updateTarsMemoryDocumentStatus,
  registerPendingTarsConversation,
  fetchTarsTranscribeModels,
} = require('@librechat/api');
const { requireJwtAuth } = require('~/server/middleware');
const { getConvo, saveConvo } = require('~/models');

const router = express.Router();
/**
 * Unlike the admin-only knowledge-base uploads, this endpoint is reachable by
 * every signed-in user and `memoryStorage` buffers each file whole, so it is
 * capped here. pwc_tars enforces its own token budget after parsing; this only
 * bounds what LibreChat will hold in memory on their behalf.
 */
const MAX_MEMORY_UPLOAD_MB = 100;
const MAX_MEMORY_UPLOAD_FILES = 20;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MEMORY_UPLOAD_MB * 1024 * 1024, files: MAX_MEMORY_UPLOAD_FILES },
});

router.use(requireJwtAuth);

/** Long-term memory only exists for accounts linked to pwc_tars. */
const requireTarsLink = (req, res, next) => {
  if (!isTarsConfigured()) {
    return res.status(503).json({ error: 'pwc_tars integration is not configured' });
  }
  if (!req.user?.tarsId) {
    return res.status(403).json({ error: 'This account is not linked to pwc_tars' });
  }
  return next();
};

router.use('/memory', requireTarsLink);

const errorStatus = (error) => (error instanceof TarsRequestError ? error.status : 500);

/**
 * Multer rejects oversized/too-many files from middleware, where the route's
 * own try/catch cannot see it; answer 413 instead of a generic 500. The whole
 * body is buffered here before the handler runs and pwc_tars logs nothing until
 * it has the bytes, so the buffering leg is timed for the handler to report.
 */
const acceptUpload = (req, res, next) => {
  const startedAt = Date.now();
  return upload.array('files')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      logger.warn(`[POST /api/tars/memory/upload] Rejected by upload limits: ${error.code}`);
      return res.status(413).json({
        error: `Upload rejected: at most ${MAX_MEMORY_UPLOAD_FILES} files, ${MAX_MEMORY_UPLOAD_MB}MB each`,
      });
    }
    req.tarsUploadTiming = { startedAt, bufferedMs: Date.now() - startedAt };
    return next(error);
  });
};

/**
 * The client percent-encodes filenames before appending them to the FormData
 * (multer/busboy would otherwise decode CJK names as latin1); undo it here.
 * Unencoded names (e.g. a raw API caller) pass through unchanged.
 */
const decodeFilename = (originalname) => {
  try {
    return decodeURIComponent(originalname);
  } catch {
    return originalname;
  }
};

/** The list/upload payload shape the client consumes; `summary` stays server-side. */
const toClientDocument = (doc) => ({
  id: doc.id,
  filename: doc.filename,
  extension: doc.extension,
  mime_type: doc.mime_type,
  size: doc.size,
  status: doc.status,
  word_count: doc.word_count,
  tokens: doc.tokens,
  structured: doc.structured,
  created_at: doc.created_at,
});

/**
 * The one line that splits an upload's wall time into its three silent legs:
 * buffering the body out of the browser, the pwc_tars round trip (parse plus
 * inline audio transcription), and the rest of the handler.
 */
const logUploadTiming = (req, files, uploadStartedAt) => {
  const { startedAt, bufferedMs } = req.tarsUploadTiming ?? {};
  const bytes = files.reduce((total, file) => total + file.size, 0);
  logger.debug(
    `[tars-memory] POST /memory/upload files=${files.length} bytes=${bytes} ` +
      `buffer=${bufferedMs ?? '?'}ms tars=${Date.now() - uploadStartedAt}ms ` +
      `total=${startedAt ? Date.now() - startedAt : '?'}ms`,
  );
};

/**
 * pwc_tars does not authorize `update_status`/`delete`, so ownership is proven
 * here first via the content route, which does check `created_by`.
 */
const assertOwnership = async (tarsId, documentId) => {
  await getTarsMemoryDocumentContent(tarsId, documentId);
};

/**
 * @route POST /api/tars/memory/upload
 * @desc Upload chat files into the pwc_tars long-term memory area. With no
 *       linked pwc_tars conversation yet (a brand-new chat), pwc_tars creates
 *       one; the id is returned for the client to send with the first message,
 *       and parked in the pending registry until that send claims it.
 * @access Authenticated + pwc_tars-linked
 */
router.post('/memory/upload', acceptUpload, async (req, res) => {
  try {
    const files = req.files ?? [];
    if (!files.length) {
      return res.status(400).json({ error: 'No file was uploaded' });
    }
    const domainId = req.body?.domainId;
    if (domainId == null || domainId === '') {
      return res.status(400).json({ error: 'domainId is required' });
    }

    const conversationId = req.body?.conversationId;
    /** An unsent chat re-uses the pwc_tars conversation its first upload created. */
    let tarsConversationId = conversationId ? undefined : req.body?.tarsConversationId;
    if (conversationId) {
      tarsConversationId = (await getConvo(req.user.id, conversationId))?.tarsConversationId;
    }

    const uploadStartedAt = Date.now();
    const result = await uploadTarsMemoryFiles(req.user.tarsId, {
      files: files.map((file) => ({
        buffer: file.buffer,
        mimetype: file.mimetype,
        filename: decodeFilename(file.originalname),
      })),
      tarsConversationId,
      domainId,
      modelName: req.body?.modelName,
      processImages: req.body?.processImages !== 'false',
      sttModelName: req.body?.sttModelName || undefined,
    });
    logUploadTiming(req, files, uploadStartedAt);

    if (result.tarsConversationId && result.tarsConversationId !== tarsConversationId) {
      if (conversationId) {
        await saveConvo(
          { userId: req.user.id },
          { conversationId, tarsConversationId: result.tarsConversationId },
          { context: 'api/server/routes/tars/memory.js - link pwc_tars conversation' },
        );
      } else {
        registerPendingTarsConversation(req.user.id, result.tarsConversationId);
      }
    }

    return res.json({
      tars_conversation_id: result.tarsConversationId,
      processed_files: result.processedFiles,
      rejected_files: result.rejectedFiles,
      token_used: result.tokenUsed,
      token_limit: result.tokenLimit,
    });
  } catch (error) {
    logger.error('[POST /api/tars/memory/upload] Failed', error);
    return res.status(errorStatus(error)).json({
      error: error?.serverMessage ?? 'Failed to upload files to the pwc_tars long-term memory',
    });
  }
});

/**
 * @route GET /api/tars/memory/stt-models
 * @desc Speech-to-text models available for audio uploads (empty = local mac
 *       STT or no provider key on the pwc_tars side).
 * @access Authenticated + pwc_tars-linked
 */
router.get('/memory/stt-models', async (req, res) => {
  const models = await fetchTarsTranscribeModels();
  return res.json(models);
});

/**
 * @route GET /api/tars/memory/list/:tarsConversationId
 * @desc The conversation's memory documents (own rows only) with token usage.
 * @access Authenticated + pwc_tars-linked
 */
router.get('/memory/list/:tarsConversationId', async (req, res) => {
  try {
    const list = await listTarsMemoryDocuments(req.user.tarsId, req.params.tarsConversationId);
    return res.json({
      tars_conversation_id: req.params.tarsConversationId,
      documents: list.documents.map(toClientDocument),
      token_used: list.tokenUsed,
      token_limit: list.tokenLimit,
    });
  } catch (error) {
    logger.error('[GET /api/tars/memory/list] Failed', error);
    return res
      .status(errorStatus(error))
      .json({ error: 'Failed to list pwc_tars long-term memory documents' });
  }
});

/**
 * @route PUT /api/tars/memory/documents/:documentId/status
 * @desc Flip a document's include-in-chat flag (body: `{status: 0|1}`).
 * @access Authenticated + pwc_tars-linked (ownership verified)
 */
router.put('/memory/documents/:documentId/status', async (req, res) => {
  try {
    const status = req.body?.status;
    if (status !== 0 && status !== 1) {
      return res.status(400).json({ error: 'status must be 0 or 1' });
    }
    await assertOwnership(req.user.tarsId, req.params.documentId);
    await updateTarsMemoryDocumentStatus(req.user.tarsId, req.params.documentId, status);
    return res.json({ document_id: req.params.documentId, status });
  } catch (error) {
    logger.error('[PUT /api/tars/memory/documents/:documentId/status] Failed', error);
    return res
      .status(errorStatus(error))
      .json({ error: 'Failed to update the memory document status' });
  }
});

/**
 * @route DELETE /api/tars/memory/documents/:documentId
 * @desc Hard-delete a memory document (row + file on disk).
 * @access Authenticated + pwc_tars-linked (ownership verified)
 */
router.delete('/memory/documents/:documentId', async (req, res) => {
  try {
    await assertOwnership(req.user.tarsId, req.params.documentId);
    await deleteTarsMemoryDocument(req.user.tarsId, req.params.documentId);
    return res.json({ deleted_document_id: req.params.documentId });
  } catch (error) {
    logger.error('[DELETE /api/tars/memory/documents/:documentId] Failed', error);
    return res.status(errorStatus(error)).json({ error: 'Failed to delete the memory document' });
  }
});

/**
 * @route GET /api/tars/memory/documents/:documentId/content
 * @desc The parsed text + preview metadata of one document.
 * @access Authenticated + pwc_tars-linked (pwc_tars checks ownership)
 */
router.get('/memory/documents/:documentId/content', async (req, res) => {
  try {
    const content = await getTarsMemoryDocumentContent(req.user.tarsId, req.params.documentId);
    return res.json(content);
  } catch (error) {
    logger.error('[GET /api/tars/memory/documents/:documentId/content] Failed', error);
    return res
      .status(errorStatus(error))
      .json({ error: 'Failed to read the memory document content' });
  }
});

/**
 * @route GET /api/tars/memory/documents/:documentId/download
 * @desc Stream the original uploaded file through from pwc_tars.
 * @access Authenticated + pwc_tars-linked (pwc_tars checks ownership)
 */
router.get('/memory/documents/:documentId/download', async (req, res) => {
  try {
    const disposition = req.query?.disposition === 'inline' ? 'inline' : 'attachment';
    const upstream = await downloadTarsMemoryDocument(
      req.user.tarsId,
      req.params.documentId,
      disposition,
    );
    for (const header of ['content-type', 'content-length', 'content-disposition']) {
      const value = upstream.headers.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch (error) {
    logger.error('[GET /api/tars/memory/documents/:documentId/download] Failed', error);
    return res.status(errorStatus(error)).json({ error: 'Failed to download the memory document' });
  }
});

module.exports = router;
