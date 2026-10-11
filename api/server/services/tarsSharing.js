const { isLeader, createTarsSharing } = require('@librechat/api');
const { runAsSystem } = require('@librechat/data-schemas');
const db = require('~/models');

/** Sharing with pwc_tars users and groups: the share dialog's directory and the group sync. */
module.exports = createTarsSharing({
  store: {
    findGroupsBySource: db.findGroupsBySource,
    upsertGroupByExternalId: db.upsertGroupByExternalId,
  },
  linkUserSourceIds: db.linkTarsUserSourceIds,
  isLeader,
  runAsSystem,
});
