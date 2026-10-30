const { createTarsAgentShare } = require('@librechat/api');
const db = require('~/models');

/** Refuses sharing an agent with anyone not assigned its pwc_tars MCP tools. */
module.exports = createTarsAgentShare({
  getAgent: db.getAgent,
  findEntriesByResource: db.findEntriesByResource,
  findUsersByIds: (ids) => db.findUsers({ _id: { $in: ids } }, 'name username idOnTheSource'),
  findGroupsByIds: (ids) => Promise.all(ids.map((id) => db.findGroupById(id))),
});
