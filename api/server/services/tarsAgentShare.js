const { createTarsAgentShare } = require('@librechat/api');
const tarsSharing = require('~/server/services/tarsSharing');
const db = require('~/models');

/**
 * Refuses sharing an agent with anyone lacking its pwc_tars MCP tools or picked knowledge
 * bases, and turns its MCP servers on in My Tools for the people it is shared with.
 */
module.exports = createTarsAgentShare({
  getAgent: db.getAgent,
  findEntriesByResource: db.findEntriesByResource,
  findUsersByIds: (ids) => db.findUsers({ _id: { $in: ids } }, 'name username idOnTheSource'),
  findGroupsByIds: (ids) => Promise.all(ids.map((id) => db.findGroupById(id))),
  directory: tarsSharing.directory,
});
