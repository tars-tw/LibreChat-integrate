const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  createTarsRole,
  updateTarsRole,
  deleteTarsRole,
  fetchTarsRolePrepareData,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();
router.use(requireJwtAuth);

/** pwc_tars answers 4xx with its own user-facing message; relay it verbatim. */
const relayTarsError = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

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
    return res.status(500).json({ error: 'Failed to fetch pwc_tars roles' });
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
 * @desc Delete a role.
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
