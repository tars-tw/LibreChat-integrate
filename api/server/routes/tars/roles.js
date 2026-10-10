const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  createTarsRole,
  updateTarsRole,
  deleteTarsRole,
  recordTarsRoleExport,
  fetchTarsRolePrepareData,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');
const { relayTarsError } = require('./relay');

const router = express.Router();
router.use('/roles', requireJwtAuth);

/**
 * @route GET /api/tars/roles
 * @desc Every pwc_tars role plus the specialized brains they can be bound to.
 * @access Admin (pwc_tars)
 */
router.get('/roles', requireTarsAdmin, async (req, res) => {
  try {
    const data = await fetchTarsRolePrepareData();
    return res.json(data);
  } catch (error) {
    logger.error('[GET /api/tars/roles] Failed to fetch pwc_tars roles', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars roles');
  }
});

/**
 * @route POST /api/tars/roles
 * @desc Create a role.
 * @access Admin (pwc_tars)
 */
router.post('/roles', requireTarsAdmin, async (req, res) => {
  try {
    const role = await createTarsRole(req.user.tarsId, req.body ?? {});
    return res.status(201).json({ role });
  } catch (error) {
    logger.error('[POST /api/tars/roles] Failed to create pwc_tars role', error);
    return relayTarsError(res, error, 'Failed to create pwc_tars role');
  }
});

/**
 * @route POST /api/tars/roles/export-log
 * @desc Record the role-list export in the pwc_tars audit trail. The rows are
 *       turned into a CSV in the browser, so pwc_tars never sees the export and
 *       this is the only thing that puts it on the record.
 * @access Admin (pwc_tars)
 */
router.post('/roles/export-log', requireTarsAdmin, async (req, res) => {
  const count = Number.parseInt(req.body?.count, 10);
  if (!Number.isFinite(count) || count < 1) {
    return res.status(400).json({ error: 'A positive row count is required' });
  }

  try {
    const pageUrl = typeof req.body?.page_url === 'string' ? req.body.page_url : undefined;
    await recordTarsRoleExport(req.user.tarsId, count, pageUrl);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/roles/export-log] Failed', error);
    return relayTarsError(res, error, 'Failed to record the pwc_tars export');
  }
});

/**
 * @route PUT /api/tars/roles/:id
 * @desc Update a role's name, brains, menu permissions, status or default flag.
 * @access Admin (pwc_tars)
 */
router.put('/roles/:id', requireTarsAdmin, async (req, res) => {
  try {
    const role = await updateTarsRole(req.user.tarsId, req.params.id, req.body ?? {});
    return res.json({ role });
  } catch (error) {
    logger.error('[PUT /api/tars/roles/:id] Failed to update pwc_tars role', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars role');
  }
});

/**
 * @route DELETE /api/tars/roles/:id
 * @desc Delete a role. Admin and default roles are refused; pwc_tars clears the
 *       deleted id off every user, group and brain.
 * @access Admin (pwc_tars)
 */
router.delete('/roles/:id', requireTarsAdmin, async (req, res) => {
  try {
    await deleteTarsRole(req.user.tarsId, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/roles/:id] Failed to delete pwc_tars role', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars role');
  }
});

module.exports = router;
