const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { isTarsFileProtocol } = require('librechat-data-provider');
const {
  TarsRequestError,
  fetchTarsFileSystems,
  createTarsFileSystem,
  updateTarsFileSystem,
  deleteTarsFileSystem,
  testTarsFileSystemConnection,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);
router.use(requireTarsAdmin);

/** pwc_tars answers a rejected connection with its own reason; relay it. */
const relay = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

const toIdList = (value) => {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value !== 'string' || value === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

/**
 * Shapes a request body into a document-group input. The credentials stay
 * blank when the form left them so the pwc_tars layer can substitute the
 * stored ones.
 */
const fileSystemInput = (body) => ({
  name: (body.name ?? '').trim(),
  description: body.description ?? '',
  protocol: body.protocol,
  host: (body.host ?? '').trim(),
  port: body.port != null && body.port !== '' ? Number(body.port) : undefined,
  path: (body.path ?? '').trim(),
  hostName: (body.hostName ?? '').trim(),
  account: (body.account ?? '').trim(),
  password: body.password ?? '',
  allowedKmIds: toIdList(body.allowedKmIds),
});

/**
 * @route GET /api/tars/data-sources/file-systems
 * @desc Every document group, credentials stripped.
 * @access Admin (pwc_tars)
 */
router.get('/data-sources/file-systems', async (req, res) => {
  try {
    const fileSystems = await fetchTarsFileSystems();
    return res.json({ fileSystems });
  } catch (error) {
    logger.error('[GET /api/tars/data-sources/file-systems] Failed', error);
    return relay(res, error, 'Failed to fetch pwc_tars document groups');
  }
});

/**
 * @route POST /api/tars/data-sources/file-systems
 * @desc Create a document group.
 * @access Admin (pwc_tars)
 */
router.post('/data-sources/file-systems', async (req, res) => {
  const input = fileSystemInput(req.body ?? {});
  if (!input.name || !input.host || !isTarsFileProtocol(input.protocol)) {
    return res.status(400).json({ error: 'name, host and a supported protocol are required' });
  }

  try {
    const fileSystem = await createTarsFileSystem(req.user.tarsId, input);
    return res.status(201).json({ fileSystem });
  } catch (error) {
    logger.error('[POST /api/tars/data-sources/file-systems] Failed', error);
    return relay(res, error, 'Failed to create pwc_tars document group');
  }
});

/**
 * @route POST /api/tars/data-sources/file-systems/test
 * @desc Open the connection and list the files the share holds.
 * @access Admin (pwc_tars)
 */
router.post('/data-sources/file-systems/test', async (req, res) => {
  const input = fileSystemInput(req.body ?? {});
  if (!input.host || !isTarsFileProtocol(input.protocol)) {
    return res.status(400).json({ error: 'host and a supported protocol are required' });
  }

  try {
    const result = await testTarsFileSystemConnection({
      ...input,
      fileSystemId: req.body?.fileSystemId,
    });
    return res.json(result);
  } catch (error) {
    logger.error('[POST /api/tars/data-sources/file-systems/test] Failed', error);
    return relay(res, error, 'Failed to connect to the file server');
  }
});

/**
 * @route PUT /api/tars/data-sources/file-systems/:fileSystemId
 * @desc Edit a document group. Blank credentials keep the stored ones.
 * @access Admin (pwc_tars)
 */
router.put('/data-sources/file-systems/:fileSystemId', async (req, res) => {
  const input = fileSystemInput(req.body ?? {});
  if (!input.name || !input.host || !isTarsFileProtocol(input.protocol)) {
    return res.status(400).json({ error: 'name, host and a supported protocol are required' });
  }

  try {
    const fileSystem = await updateTarsFileSystem(req.user.tarsId, req.params.fileSystemId, input);
    return res.json({ fileSystem });
  } catch (error) {
    logger.error('[PUT /api/tars/data-sources/file-systems/:fileSystemId] Failed', error);
    return relay(res, error, 'Failed to update pwc_tars document group');
  }
});

/**
 * @route DELETE /api/tars/data-sources/file-systems/:fileSystemId
 * @access Admin (pwc_tars)
 */
router.delete('/data-sources/file-systems/:fileSystemId', async (req, res) => {
  try {
    await deleteTarsFileSystem(req.user.tarsId, req.params.fileSystemId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/data-sources/file-systems/:fileSystemId] Failed', error);
    return relay(res, error, 'Failed to delete pwc_tars document group');
  }
});

module.exports = router;
