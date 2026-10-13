const { isLeader, createWorkflowTransfer } = require('@librechat/api');
const { runAsSystem } = require('@librechat/data-schemas');
const db = require('~/models');

/** Hands the Workflow flows of users who lost Workflow to the Langflow system account. */
module.exports = createWorkflowTransfer({
  isLeader,
  runAsSystem,
  findUserByTarsId: (tarsId) => db.findUser({ tarsId }, '_id'),
  agents: {
    getAgents: (filter) => db.getAgents(filter),
    deleteAgent: (filter) => db.deleteAgent(filter),
  },
});
