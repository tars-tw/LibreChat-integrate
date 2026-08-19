const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  createTarsUserGroup,
  updateTarsUserGroup,
  deleteTarsUserGroup,
  assignTarsUsersToGroup,
  removeTarsUserFromGroup,
  fetchTarsGroupPrepareData,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();
router.use(requireJwtAuth);

/** pwc_tars answers 4xx with its own user-facing `message`; relay it verbatim. */
const relayTarsError = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

/**
 * @route GET /api/tars/groups
 * @desc Every pwc_tars user group (with its member list) plus all roles.
 * @access Admin (pwc_tars)
 */
router.get('/groups', requireTarsAdmin, async (req, res) => {
  try {
    const data = await fetchTarsGroupPrepareData();
    return res.json(data);
  } catch (error) {
    logger.error('[GET /api/tars/groups] Failed to fetch pwc_tars groups', error);
    return res.status(500).json({ error: 'Failed to fetch pwc_tars groups' });
  }
});

/**
 * @route POST /api/tars/groups
 * @desc Create a user group.
 * @access Admin (pwc_tars)
 */
router.post('/groups', requireTarsAdmin, async (req, res) => {
  try {
    const group = await createTarsUserGroup(req.user.tarsId, req.body ?? {});
    return res.status(201).json({ group });
  } catch (error) {
    logger.error('[POST /api/tars/groups] Failed to create pwc_tars group', error);
    return relayTarsError(res, error, 'Failed to create pwc_tars group');
  }
});

/**
 * @route PUT /api/tars/groups/:id
 * @desc Update a user group's name, description, roles or status.
 * @access Admin (pwc_tars)
 */
router.put('/groups/:id', requireTarsAdmin, async (req, res) => {
  try {
    const group = await updateTarsUserGroup(req.user.tarsId, req.params.id, req.body ?? {});
    return res.json({ group });
  } catch (error) {
    logger.error('[PUT /api/tars/groups/:id] Failed to update pwc_tars group', error);
    return relayTarsError(res, error, 'Failed to update pwc_tars group');
  }
});

/**
 * @route DELETE /api/tars/groups/:id
 * @desc Delete a group; pwc_tars unbinds every member in the same transaction.
 * @access Admin (pwc_tars)
 */
router.delete('/groups/:id', requireTarsAdmin, async (req, res) => {
  try {
    await deleteTarsUserGroup(req.user.tarsId, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/groups/:id] Failed to delete pwc_tars group', error);
    return relayTarsError(res, error, 'Failed to delete pwc_tars group');
  }
});

/**
 * @route POST /api/tars/groups/:id/members
 * @desc Add users to a group, keeping their other group memberships.
 * @access Admin (pwc_tars)
 */
router.post('/groups/:id/members', requireTarsAdmin, async (req, res) => {
  const { userIds } = req.body ?? {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds must be a non-empty array' });
  }

  try {
    await assignTarsUsersToGroup(req.user.tarsId, req.params.id, userIds);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[POST /api/tars/groups/:id/members] Failed', error);
    return relayTarsError(res, error, 'Failed to add members to pwc_tars group');
  }
});

/**
 * @route DELETE /api/tars/groups/:id/members/:userId
 * @desc Remove one member from a group, leaving their other groups intact.
 * @access Admin (pwc_tars)
 */
router.delete('/groups/:id/members/:userId', requireTarsAdmin, async (req, res) => {
  try {
    await removeTarsUserFromGroup(req.user.tarsId, req.params.id, req.params.userId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/groups/:id/members/:userId] Failed', error);
    return relayTarsError(res, error, 'Failed to remove member from pwc_tars group');
  }
});

module.exports = router;
