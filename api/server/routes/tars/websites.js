const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  fetchTarsWebsites,
  deleteTarsWebsite,
  importTarsWebsiteDataset,
  updateTarsWebsiteDataset,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);
router.use(requireTarsAdmin);

/** pwc_tars explains why a crawl failed; that beats a generic string. */
const relay = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

/**
 * @route GET /api/tars/data-sources/websites
 * @desc Every website dataset, plus the knowledge bases one may be imported into.
 * @access Admin (pwc_tars)
 */
router.get('/data-sources/websites', async (req, res) => {
  try {
    const { websites, knowledgeBases } = await fetchTarsWebsites();
    return res.json({ websites, knowledgeBases });
  } catch (error) {
    logger.error('[GET /api/tars/data-sources/websites] Failed', error);
    return relay(res, error, 'Failed to fetch pwc_tars website datasets');
  }
});

/**
 * @route POST /api/tars/data-sources/websites
 * @desc Crawl a site and import it into a knowledge base. Slow by nature:
 *       pwc_tars fetches, chunks and embeds inside this request.
 * @access Admin (pwc_tars)
 */
router.post('/data-sources/websites', async (req, res) => {
  const body = req.body ?? {};
  const knowledgeBaseId = (body.knowledgeBaseId ?? '').trim();
  const name = (body.name ?? '').trim();
  const url = (body.url ?? '').trim();

  if (!knowledgeBaseId || !name || !url) {
    return res.status(400).json({ error: 'knowledgeBaseId, name and url are required' });
  }

  try {
    const website = await importTarsWebsiteDataset(req.user.tarsId, {
      knowledgeBaseId,
      name,
      url,
      description: body.description ?? '',
      enabled: body.enabled !== false,
      chunkSize:
        body.chunkSize != null && body.chunkSize !== '' ? Number(body.chunkSize) : undefined,
    });
    return res.status(201).json({ website });
  } catch (error) {
    logger.error('[POST /api/tars/data-sources/websites] Failed', error);
    return relay(res, error, 'Failed to import the website');
  }
});

/**
 * @route PUT /api/tars/data-sources/websites/:websiteId
 * @desc Rename or re-describe. The URL is fixed at import: pwc_tars does not
 *       re-crawl on an edit, so a changed address would not match its chunks.
 * @access Admin (pwc_tars)
 */
router.put('/data-sources/websites/:websiteId', async (req, res) => {
  const name = (req.body?.name ?? '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const website = await updateTarsWebsiteDataset(req.user.tarsId, req.params.websiteId, {
      name,
      description: req.body?.description ?? '',
    });
    return res.json({ website });
  } catch (error) {
    logger.error('[PUT /api/tars/data-sources/websites/:websiteId] Failed', error);
    return relay(res, error, 'Failed to update pwc_tars website dataset');
  }
});

/**
 * @route DELETE /api/tars/data-sources/websites/:websiteId
 * @desc Delete a website dataset along with its chunks and vectors.
 * @access Admin (pwc_tars)
 */
router.delete('/data-sources/websites/:websiteId', async (req, res) => {
  const knowledgeBaseId = req.query?.knowledgeBaseId ?? null;

  try {
    await deleteTarsWebsite(
      req.user.tarsId,
      req.params.websiteId,
      typeof knowledgeBaseId === 'string' && knowledgeBaseId !== '' ? knowledgeBaseId : null,
    );
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/data-sources/websites/:websiteId] Failed', error);
    return relay(res, error, 'Failed to delete pwc_tars website dataset');
  }
});

module.exports = router;
