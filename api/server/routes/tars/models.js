const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  fetchTarsModelProfiles,
  createTarsModelProfile,
  updateTarsModelProfile,
  deleteTarsModelProfile,
  getTarsUserModelProfileNames,
  saveTarsModelAssignees,
  fetchTarsModelAssignees,
  fetchTarsModelPermissions,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');
const { relayTarsError } = require('./relay');

const router = express.Router();

router.use('/models', requireJwtAuth);
router.use('/model-profiles', requireJwtAuth);
router.use('/model-permissions', requireJwtAuth);

/**
 * @route GET /api/tars/models
 * @desc The model_profile names the signed-in user may pick — the whitelist the
 *       chat and agent model selectors filter by. pwc_tars applies
 *       sys_model_permission per user (admins get every model); an account with
 *       no pwc_tars link gets the global list. `models: null` means no
 *       restriction (TARS unconfigured).
 * @access Authenticated
 */
router.get('/models', async (req, res) => {
  try {
    const models = await getTarsUserModelProfileNames(req.user?.tarsId);
    return res.json({ models });
  } catch (error) {
    logger.error('[GET /api/tars/models] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars model profiles');
  }
});

/**
 * @route GET /api/tars/model-profiles
 * @desc Every pwc_tars model profile, disabled ones included (模型管理).
 * @access Admin (pwc_tars)
 */
router.get('/model-profiles', requireTarsAdmin, async (req, res) => {
  try {
    const profiles = await fetchTarsModelProfiles(req.user.tarsId);
    return res.json({ profiles });
  } catch (error) {
    logger.error('[GET /api/tars/model-profiles] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars model profiles');
  }
});

/**
 * @route POST /api/tars/model-profiles
 * @desc Create a model profile.
 * @access Admin (pwc_tars)
 */
router.post('/model-profiles', requireTarsAdmin, async (req, res) => {
  try {
    const profile = await createTarsModelProfile(req.user.tarsId, req.body ?? {});
    return res.status(201).json({ profile, sync: null });
  } catch (error) {
    logger.error('[POST /api/tars/model-profiles] Failed', error);
    return relayTarsError(res, error, 'Failed to create pwc_tars model profile');
  }
});

/**
 * @route PUT /api/tars/model-profiles/:id
 * @desc Update a model profile's fields or enabled flag; reports what a
 *       disable/rename moved onto another model.
 * @access Admin (pwc_tars)
 */
router.put('/model-profiles/:id', requireTarsAdmin, async (req, res) => {
  try {
    const result = await updateTarsModelProfile(req.user.tarsId, req.params.id, req.body ?? {});
    return res.json(result);
  } catch (error) {
    logger.error('[PUT /api/tars/model-profiles/:id] Failed', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars model profile');
  }
});

/**
 * @route DELETE /api/tars/model-profiles/:id
 * @desc Soft-delete a model profile; reports what moved onto another model.
 * @access Admin (pwc_tars)
 */
router.delete('/model-profiles/:id', requireTarsAdmin, async (req, res) => {
  try {
    const result = await deleteTarsModelProfile(req.user.tarsId, req.params.id);
    return res.json({ success: true, ...result });
  } catch (error) {
    logger.error('[DELETE /api/tars/model-profiles/:id] Failed', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars model profile');
  }
});

/**
 * @route GET /api/tars/model-permissions
 * @desc Every model's direct assignees (sys_model_permission); a model left out
 *       has none and is open to everyone.
 * @access Admin (pwc_tars)
 */
router.get('/model-permissions', requireTarsAdmin, async (req, res) => {
  try {
    const permissions = await fetchTarsModelPermissions(req.user.tarsId);
    return res.json({ permissions });
  } catch (error) {
    logger.error('[GET /api/tars/model-permissions] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars model permissions');
  }
});

/**
 * @route GET /api/tars/model-permissions/:id
 * @desc One model's assignees, disabled users/groups included.
 * @access Admin (pwc_tars)
 */
router.get('/model-permissions/:id', requireTarsAdmin, async (req, res) => {
  try {
    const principals = await fetchTarsModelAssignees(req.user.tarsId, req.params.id);
    return res.json({ principals });
  } catch (error) {
    logger.error('[GET /api/tars/model-permissions/:id] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars model permission');
  }
});

/**
 * @route PUT /api/tars/model-permissions/:id
 * @desc Overwrite one model's assignees; an empty list opens it to everyone.
 * @access Admin (pwc_tars)
 */
router.put('/model-permissions/:id', requireTarsAdmin, async (req, res) => {
  try {
    const result = await saveTarsModelAssignees(req.user.tarsId, req.params.id, req.body ?? {});
    return res.json({ result });
  } catch (error) {
    logger.error('[PUT /api/tars/model-permissions/:id] Failed', error);
    return relayTarsError(res, error, 'Failed to save pwc_tars model permission');
  }
});

module.exports = router;
