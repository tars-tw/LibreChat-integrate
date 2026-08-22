const multer = require('multer');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { isTarsDatabaseType } = require('librechat-data-provider');
const {
  TarsRequestError,
  fetchTarsDatabases,
  createTarsDatabase,
  updateTarsDatabase,
  deleteTarsDatabase,
  testTarsDatabaseConnection,
  uploadTarsSqliteDatabase,
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

/** SQLite files are the only upload here, and pwc_tars caps them the same way. */
const MAX_SQLITE_MB = 100;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SQLITE_MB * 1024 * 1024, files: 1 },
});

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
 * Shapes a request body into a connection input. `password` stays undefined
 * when blank so the pwc_tars layer can substitute the stored one.
 */
const databaseInput = (body) => ({
  name: (body.name ?? '').trim(),
  description: body.description ?? '',
  dbType: body.dbType,
  host: (body.host ?? '').trim(),
  port: body.port != null && body.port !== '' ? Number(body.port) : undefined,
  databaseName: (body.databaseName ?? '').trim(),
  username: (body.username ?? '').trim(),
  password: body.password === '' ? undefined : body.password,
  enabled: body.enabled !== false,
  allowedKmIds: toIdList(body.allowedKmIds),
});

/**
 * @route GET /api/tars/data-sources/databases
 * @desc Every application-database connection, credentials stripped.
 * @access Admin (pwc_tars)
 */
router.get('/data-sources/databases', async (req, res) => {
  try {
    const databases = await fetchTarsDatabases();
    return res.json({ databases });
  } catch (error) {
    logger.error('[GET /api/tars/data-sources/databases] Failed', error);
    return relay(res, error, 'Failed to fetch pwc_tars database connections');
  }
});

/**
 * @route POST /api/tars/data-sources/databases
 * @desc Create a connection.
 * @access Admin (pwc_tars)
 */
router.post('/data-sources/databases', async (req, res) => {
  const input = databaseInput(req.body ?? {});
  if (!input.name || !isTarsDatabaseType(input.dbType)) {
    return res.status(400).json({ error: 'name and a supported dbType are required' });
  }

  try {
    const database = await createTarsDatabase(req.user.tarsId, input);
    return res.status(201).json({ database });
  } catch (error) {
    logger.error('[POST /api/tars/data-sources/databases] Failed', error);
    return relay(res, error, 'Failed to create pwc_tars database connection');
  }
});

/**
 * @route POST /api/tars/data-sources/databases/sqlite
 * @desc Create a connection from an uploaded SQLite file.
 * @access Admin (pwc_tars)
 */
router.post('/data-sources/databases/sqlite', upload.single('file'), async (req, res) => {
  const name = (req.body?.name ?? '').trim();
  if (!name || req.file == null) {
    return res.status(400).json({ error: 'name and a SQLite file are required' });
  }

  try {
    const database = await uploadTarsSqliteDatabase(
      req.user.tarsId,
      {
        name,
        description: req.body?.description ?? '',
        allowedKmIds: toIdList(req.body?.allowedKmIds),
      },
      {
        buffer: req.file.buffer,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
      },
    );
    return res.status(201).json({ database });
  } catch (error) {
    logger.error('[POST /api/tars/data-sources/databases/sqlite] Failed', error);
    return relay(res, error, 'Failed to upload pwc_tars SQLite database');
  }
});

/**
 * @route POST /api/tars/data-sources/databases/test
 * @desc Open the connection and list its tables and views.
 * @access Admin (pwc_tars)
 */
router.post('/data-sources/databases/test', async (req, res) => {
  const input = databaseInput(req.body ?? {});
  if (!isTarsDatabaseType(input.dbType)) {
    return res.status(400).json({ error: 'a supported dbType is required' });
  }

  try {
    const result = await testTarsDatabaseConnection({
      ...input,
      databaseId: req.body?.databaseId,
    });
    return res.json(result);
  } catch (error) {
    logger.error('[POST /api/tars/data-sources/databases/test] Failed', error);
    return relay(res, error, 'Failed to connect to the database');
  }
});

/**
 * @route PUT /api/tars/data-sources/databases/:databaseId
 * @desc Edit a connection. A blank password keeps the stored one.
 * @access Admin (pwc_tars)
 */
router.put('/data-sources/databases/:databaseId', async (req, res) => {
  const input = databaseInput(req.body ?? {});
  if (!input.name || !isTarsDatabaseType(input.dbType)) {
    return res.status(400).json({ error: 'name and a supported dbType are required' });
  }

  try {
    const database = await updateTarsDatabase(req.user.tarsId, req.params.databaseId, input);
    return res.json({ database });
  } catch (error) {
    logger.error('[PUT /api/tars/data-sources/databases/:databaseId] Failed', error);
    return relay(res, error, 'Failed to update pwc_tars database connection');
  }
});

/**
 * @route DELETE /api/tars/data-sources/databases/:databaseId
 * @access Admin (pwc_tars)
 */
router.delete('/data-sources/databases/:databaseId', async (req, res) => {
  try {
    await deleteTarsDatabase(req.user.tarsId, req.params.databaseId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/data-sources/databases/:databaseId] Failed', error);
    return relay(res, error, 'Failed to delete pwc_tars database connection');
  }
});

module.exports = router;
