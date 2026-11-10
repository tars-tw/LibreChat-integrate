const express = require('express');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const { generateCheckAccess, createTarsMemoryHandlers } = require('@librechat/api');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');
const { getRoleByName, updateUserMemoryAutoUpdate } = require('~/models');

const checkMemoryRead = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.READ],
  getRoleByName,
});
const checkMemoryCreate = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.CREATE],
  getRoleByName,
});
const checkMemoryUpdate = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.UPDATE],
  getRoleByName,
});
const checkMemoryOptOut = generateCheckAccess({
  permissionType: PermissionTypes.MEMORIES,
  permissions: [Permissions.USE, Permissions.OPT_OUT],
  getRoleByName,
});

const router = express.Router();
const handlers = createTarsMemoryHandlers({ updateMemoryAutoUpdate: updateUserMemoryAutoUpdate });

/** `configMiddleware` resolves `tars.memoryAssist.enabled`, which switches the API off with the panel. */
router.use('/memory', requireJwtAuth, configMiddleware);

/**
 * @route GET /api/tars/memory
 * @desc The user's pwc_tars personal memory.
 * @route DELETE /api/tars/memory
 * @desc Deletes all of the user's memory.
 * @route POST /api/tars/memory
 * @desc Adds the user's own lines to their profile.
 * @route PATCH /api/tars/memory/preferences
 * @desc Chooses whether the AI maintains the memory or the user does.
 * @route PUT /api/tars/memory/:id
 * @desc Edits one record; the reply carries its new id.
 * @route DELETE /api/tars/memory/:id
 * @desc Deletes one record.
 * @access The memory's owner, by the `MEMORIES` role permissions
 */
router.get('/memory', checkMemoryRead, handlers.list);
router.delete('/memory', checkMemoryUpdate, handlers.clear);
router.post('/memory', checkMemoryCreate, handlers.create);
router.patch('/memory/preferences', checkMemoryOptOut, handlers.preferences);
router.put('/memory/:id', checkMemoryUpdate, handlers.update);
router.delete('/memory/:id', checkMemoryUpdate, handlers.remove);

module.exports = router;
