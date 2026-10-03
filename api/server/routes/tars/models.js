const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  fetchTarsModelProfiles,
  createTarsModelProfile,
  updateTarsModelProfile,
  deleteTarsModelProfile,
  getTarsModelProfileNames,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

router.use('/models', requireJwtAuth);
router.use('/model-profiles', requireJwtAuth);

/**
 * pwc_tars answers 4xx with its own message (missing field, malformed config,
 * 409 when no system default model can take over a disabled one); relay it
 * with its status so the page can tell those cases apart.
 */
const relayTarsError = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

/**
 * @route GET /api/tars/models
 * @desc Names of the active pwc_tars model_profile rows — the whitelist the
 *       model selector uses to lock/reorder models. `models: null` means no
 *       restriction (TARS unconfigured or unreachable with no cached list).
 * @access Authenticated
 */
router.get('/models', async (req, res) => {
  try {
    const models = await getTarsModelProfileNames();
    return res.json({ models });
  } catch (error) {
    logger.error('[GET /api/tars/models] Failed', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars model profiles' });
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

module.exports = router;
