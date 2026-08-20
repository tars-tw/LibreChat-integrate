const multer = require('multer');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  importTarsAdData,
  importTarsLicense,
  fetchTarsLdapTree,
  deleteTarsAdData,
  saveTarsSsoConfig,
  fetchTarsSsoConfigs,
  updateTarsSsoConfig,
  deleteTarsSsoConfig,
  fetchTarsSystemLogo,
  uploadTarsSystemLogo,
  removeTarsSystemLogo,
  fetchTarsSyncSchedule,
  saveTarsSyncSchedule,
  deleteTarsSyncSchedule,
  testTarsLdapConnection,
  fetchTarsSystemSettings,
  fetchTarsWhitelistUsersDetail,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

/** pwc_tars answers 4xx with its own user-facing message; relay it verbatim. */
const relayTarsError = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

const toUploadFile = (file) => ({
  buffer: file.buffer,
  filename: file.originalname,
  mimetype: file.mimetype,
});

/**
 * @route GET /api/tars/settings/logo
 * @desc Proxy the pwc_tars system logo so the browser never calls pwc_tars.
 *       Public: the login page renders it before anyone is authenticated.
 * @access Public
 */
router.get('/settings/logo', async (req, res) => {
  try {
    const logo = await fetchTarsSystemLogo();
    if (!logo) {
      return res.status(404).end();
    }
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(logo.buffer);
  } catch (error) {
    logger.error('[GET /api/tars/settings/logo] Failed to fetch pwc_tars system logo', error);
    return res.status(404).end();
  }
});

router.use(requireJwtAuth);

/**
 * @route GET /api/tars/settings
 * @desc pwc_tars licence status and validity window.
 * @access Admin (pwc_tars)
 */
router.get('/settings', requireTarsAdmin, async (req, res) => {
  try {
    const settings = await fetchTarsSystemSettings();
    return res.json(settings);
  } catch (error) {
    logger.error('[GET /api/tars/settings] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars system settings' });
  }
});

/**
 * @route POST /api/tars/settings/logo
 * @desc Upload the system logo through pwc_tars' own settings endpoint.
 * @access Admin (pwc_tars)
 */
router.post('/settings/logo', requireTarsAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'A file is required' });
  }

  try {
    await uploadTarsSystemLogo(
      req.user.tarsId,
      req.user.username ?? req.user.name ?? 'unknown',
      toUploadFile(req.file),
    );
    return res.json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/settings/logo] Failed', error);
    return relayTarsError(res, error, 'Failed to upload pwc_tars system logo');
  }
});

/**
 * @route DELETE /api/tars/settings/logo
 * @desc Remove the stored system logo.
 * @access Admin (pwc_tars)
 */
router.delete('/settings/logo', requireTarsAdmin, async (req, res) => {
  try {
    await removeTarsSystemLogo(req.user.tarsId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/settings/logo] Failed', error);
    return relayTarsError(res, error, 'Failed to remove pwc_tars system logo');
  }
});

/**
 * @route POST /api/tars/settings/license
 * @desc Upload a `.key` licence file; pwc_tars decrypts and applies it.
 * @access Admin (pwc_tars)
 */
router.post('/settings/license', requireTarsAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'A file is required' });
  }

  try {
    const license = await importTarsLicense(toUploadFile(req.file));
    return res.json(license);
  } catch (error) {
    logger.error('[POST /api/tars/settings/license] Failed', error);
    return res.status(400).json({ error: error?.message ?? 'Failed to import pwc_tars licence' });
  }
});

/**
 * @route GET /api/tars/settings/sso
 * @desc Every stored LDAP configuration.
 * @access Admin (pwc_tars)
 */
router.get('/settings/sso', requireTarsAdmin, async (req, res) => {
  try {
    const configs = await fetchTarsSsoConfigs(req.user.tarsId);
    return res.json({ configs });
  } catch (error) {
    logger.error('[GET /api/tars/settings/sso] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars SSO configurations' });
  }
});

/**
 * @route POST /api/tars/settings/sso
 * @desc Create an LDAP configuration.
 * @access Admin (pwc_tars)
 */
router.post('/settings/sso', requireTarsAdmin, async (req, res) => {
  try {
    await saveTarsSsoConfig(req.user.tarsId, req.body ?? {});
    return res.status(201).json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/settings/sso] Failed', error);
    return relayTarsError(res, error, 'Failed to create pwc_tars SSO configuration');
  }
});

/**
 * @route PUT /api/tars/settings/sso/:id
 * @desc Update an LDAP configuration.
 * @access Admin (pwc_tars)
 */
router.put('/settings/sso/:id', requireTarsAdmin, async (req, res) => {
  try {
    await updateTarsSsoConfig(req.user.tarsId, req.params.id, req.body ?? {});
    return res.json({ success: true });
  } catch (error) {
    logger.error('[PUT /api/tars/settings/sso/:id] Failed', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars SSO configuration');
  }
});

/**
 * @route DELETE /api/tars/settings/sso/:id
 * @desc Delete an LDAP configuration.
 * @access Admin (pwc_tars)
 */
router.delete('/settings/sso/:id', requireTarsAdmin, async (req, res) => {
  try {
    await deleteTarsSsoConfig(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/settings/sso/:id] Failed', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars SSO configuration');
  }
});

/**
 * @route POST /api/tars/settings/sso/test
 * @desc Test an LDAP bind, using either a stored config or draft values.
 * @access Admin (pwc_tars)
 */
router.post('/settings/sso/test', requireTarsAdmin, async (req, res) => {
  try {
    const message = await testTarsLdapConnection(req.body ?? {});
    return res.json({ message });
  } catch (error) {
    logger.error('[POST /api/tars/settings/sso/test] Failed', error);
    return relayTarsError(res, error, 'LDAP connection failed');
  }
});

/**
 * @route POST /api/tars/settings/sso/tree
 * @desc Browse the LDAP directory tree.
 * @access Admin (pwc_tars)
 */
router.post('/settings/sso/tree', requireTarsAdmin, async (req, res) => {
  try {
    const nodes = await fetchTarsLdapTree(req.body ?? {});
    return res.json({ nodes });
  } catch (error) {
    logger.error('[POST /api/tars/settings/sso/tree] Failed', error);
    return relayTarsError(res, error, 'Failed to read the LDAP directory');
  }
});

/**
 * @route POST /api/tars/settings/sso/whitelist
 * @desc Resolve whitelist usernames against the directory.
 * @access Admin (pwc_tars)
 */
router.post('/settings/sso/whitelist', requireTarsAdmin, async (req, res) => {
  try {
    const users = await fetchTarsWhitelistUsersDetail(req.body ?? {});
    return res.json({ users });
  } catch (error) {
    logger.error('[POST /api/tars/settings/sso/whitelist] Failed', error);
    return relayTarsError(res, error, 'Failed to resolve the LDAP whitelist');
  }
});

/**
 * @route POST /api/tars/settings/sso/:id/import
 * @desc Sync accounts and groups from AD into pwc_tars.
 * @access Admin (pwc_tars)
 */
router.post('/settings/sso/:id/import', requireTarsAdmin, async (req, res) => {
  try {
    const message = await importTarsAdData(req.params.id, req.body?.enableUsers !== false);
    return res.json({ message });
  } catch (error) {
    logger.error('[POST /api/tars/settings/sso/:id/import] Failed', error);
    return relayTarsError(res, error, 'Failed to import AD data');
  }
});

/**
 * @route DELETE /api/tars/settings/sso/:id/import
 * @desc Remove everything this configuration synced from AD.
 * @access Admin (pwc_tars)
 */
router.delete('/settings/sso/:id/import', requireTarsAdmin, async (req, res) => {
  try {
    const message = await deleteTarsAdData(req.params.id);
    return res.json({ message });
  } catch (error) {
    logger.error('[DELETE /api/tars/settings/sso/:id/import] Failed', error);
    return relayTarsError(res, error, 'Failed to remove AD-synced data');
  }
});

/**
 * @route GET /api/tars/settings/sso/:id/schedule
 * @desc The configuration's sync schedule.
 * @access Admin (pwc_tars)
 */
router.get('/settings/sso/:id/schedule', requireTarsAdmin, async (req, res) => {
  try {
    const schedule = await fetchTarsSyncSchedule(req.params.id);
    return res.json({ schedule });
  } catch (error) {
    logger.error('[GET /api/tars/settings/sso/:id/schedule] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch the sync schedule' });
  }
});

/**
 * @route PUT /api/tars/settings/sso/:id/schedule
 * @desc Save the sync schedule.
 * @access Admin (pwc_tars)
 */
router.put('/settings/sso/:id/schedule', requireTarsAdmin, async (req, res) => {
  try {
    await saveTarsSyncSchedule(req.params.id, req.body ?? {});
    return res.json({ success: true });
  } catch (error) {
    logger.error('[PUT /api/tars/settings/sso/:id/schedule] Failed', error);
    return relayTarsError(res, error, 'Failed to save the sync schedule');
  }
});

/**
 * @route DELETE /api/tars/settings/sso/:id/schedule
 * @desc Clear the sync schedule.
 * @access Admin (pwc_tars)
 */
router.delete('/settings/sso/:id/schedule', requireTarsAdmin, async (req, res) => {
  try {
    await deleteTarsSyncSchedule(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/settings/sso/:id/schedule] Failed', error);
    return relayTarsError(res, error, 'Failed to clear the sync schedule');
  }
});

module.exports = router;
