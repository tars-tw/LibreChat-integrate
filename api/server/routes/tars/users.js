const multer = require('multer');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  createTarsUser,
  updateTarsUser,
  deleteTarsUser,
  fetchTarsUsers,
  bulkUpdateTarsUsers,
  bulkDeleteTarsUsers,
  bulkImportTarsUsers,
  fetchTarsAdWhitelist,
  resetTarsUserPassword,
  fetchTarsUserPrepareData,
  downloadTarsUserImportTemplate,
  TarsRequestError,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();
router.use(requireJwtAuth);

const upload = multer({ storage: multer.memoryStorage() });

/**
 * pwc_tars validates account rules (duplicate username, password length, "you
 * cannot delete yourself", …) and answers 4xx with its own `message`/`error`.
 * Those are user-facing, so they are relayed verbatim instead of being
 * flattened into a generic 500.
 */
const relayTarsError = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

/**
 * @route GET /api/tars/users
 * @desc List every pwc_tars account with online state and resolved role names.
 * @access Admin (pwc_tars)
 */
router.get('/users', requireTarsAdmin, async (req, res) => {
  try {
    const users = await fetchTarsUsers();
    return res.json({ users });
  } catch (error) {
    logger.error('[GET /api/tars/users] Failed to fetch pwc_tars users', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars users' });
  }
});

/**
 * @route GET /api/tars/users/prepare-data
 * @desc Roles, user groups and SSO status for the user admin editors.
 * @access Admin (pwc_tars)
 */
router.get('/users/prepare-data', requireTarsAdmin, async (req, res) => {
  try {
    const data = await fetchTarsUserPrepareData(req.user.tarsId);
    return res.json(data);
  } catch (error) {
    logger.error('[GET /api/tars/users/prepare-data] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars user data' });
  }
});

/**
 * @route GET /api/tars/users/ad-whitelist
 * @desc LDAP whitelist usernames available when creating an AD-backed account.
 * @access Admin (pwc_tars)
 */
router.get('/users/ad-whitelist', requireTarsAdmin, async (req, res) => {
  try {
    const usernames = await fetchTarsAdWhitelist(req.user.tarsId);
    return res.json({ usernames });
  } catch (error) {
    logger.error('[GET /api/tars/users/ad-whitelist] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars AD whitelist' });
  }
});

/**
 * @route GET /api/tars/users/import-template
 * @desc Proxy the pwc_tars bulk-import `.xlsx` template to the browser.
 * @access Admin (pwc_tars)
 */
router.get('/users/import-template', requireTarsAdmin, async (req, res) => {
  try {
    const { buffer, contentType } = await downloadTarsUserImportTemplate(req.user.tarsId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="Bulk_User_Import_Template.xlsx"');
    return res.send(buffer);
  } catch (error) {
    logger.error('[GET /api/tars/users/import-template] Failed', error);
    return res.status(500).json({ error: 'Failed to download pwc_tars import template' });
  }
});

/**
 * @route POST /api/tars/users/import
 * @desc Forward a filled-in template to pwc_tars, relaying its per-row errors.
 * @access Admin (pwc_tars)
 */
router.post('/users/import', requireTarsAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'A file is required' });
  }

  try {
    const { ok, status, body } = await bulkImportTarsUsers({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    return res.status(ok ? 200 : status).json(body);
  } catch (error) {
    logger.error('[POST /api/tars/users/import] Failed', error);
    return res.status(500).json({ error: 'Failed to import pwc_tars users' });
  }
});

/**
 * @route PUT /api/tars/users/bulk
 * @desc Apply the same role / group / status change to many accounts.
 * @access Admin (pwc_tars)
 */
router.put('/users/bulk', requireTarsAdmin, async (req, res) => {
  const { ids, updates } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  try {
    const users = await bulkUpdateTarsUsers(req.user.tarsId, ids, updates ?? {});
    return res.json({ users });
  } catch (error) {
    logger.error('[PUT /api/tars/users/bulk] Failed', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars users');
  }
});

/**
 * @route POST /api/tars/users/bulk-delete
 * @desc Delete many accounts at once.
 * @access Admin (pwc_tars)
 */
router.post('/users/bulk-delete', requireTarsAdmin, async (req, res) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  try {
    const deletedCount = await bulkDeleteTarsUsers(req.user.tarsId, ids);
    return res.json({ success: true, deletedCount });
  } catch (error) {
    logger.error('[POST /api/tars/users/bulk-delete] Failed', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars users');
  }
});

/**
 * @route POST /api/tars/users
 * @desc Create a pwc_tars account (local or AD-backed).
 * @access Admin (pwc_tars)
 */
router.post('/users', requireTarsAdmin, async (req, res) => {
  try {
    const user = await createTarsUser(req.user.tarsId, req.body ?? {});
    return res.status(201).json({ user });
  } catch (error) {
    logger.error('[POST /api/tars/users] Failed to create pwc_tars user', error);
    return relayTarsError(res, error, 'Failed to create pwc_tars user');
  }
});

/**
 * @route POST /api/tars/users/:id/reset-password
 * @desc Set a new password for an account.
 * @access Admin (pwc_tars)
 */
router.post('/users/:id/reset-password', requireTarsAdmin, async (req, res) => {
  const { password } = req.body ?? {};
  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }

  try {
    await resetTarsUserPassword(req.params.id, password);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/users/:id/reset-password] Failed', error);
    return relayTarsError(res, error, 'Failed to reset pwc_tars password');
  }
});

/**
 * @route PUT /api/tars/users/:id
 * @desc Update an account's email, display name, role, groups or status.
 * @access Admin (pwc_tars)
 */
router.put('/users/:id', requireTarsAdmin, async (req, res) => {
  try {
    const user = await updateTarsUser(req.user.tarsId, req.params.id, req.body ?? {});
    return res.json({ user });
  } catch (error) {
    logger.error('[PUT /api/tars/users/:id] Failed to update pwc_tars user', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars user');
  }
});

/**
 * @route DELETE /api/tars/users/:id
 * @desc Delete an account.
 * @access Admin (pwc_tars)
 */
router.delete('/users/:id', requireTarsAdmin, async (req, res) => {
  try {
    await deleteTarsUser(req.user.tarsId, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/users/:id] Failed to delete pwc_tars user', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars user');
  }
});

module.exports = router;
