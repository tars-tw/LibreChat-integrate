const { Types } = require('mongoose');
const { configureWorkflowShareAccess } = require('@librechat/api');
const { ResourceType, PermissionBits } = require('librechat-data-provider');
const db = require('~/models');

/**
 * Who may reach someone else's personal Workflow project: whoever an agent its owner built on it
 * is shared with. The decision lives in `@librechat/api` (`langflow/access`); these are its reads.
 */
configureWorkflowShareAccess({
  findAgentsBindingServer: async (serverName) => {
    const agents = await db.getAgents(
      { mcpServerNames: serverName },
      { _id: 1, author: 1, tools: 1 },
    );
    return agents.map((agent) => ({
      id: String(agent._id),
      author: String(agent.author),
      tools: agent.tools ?? [],
    }));
  },
  findUserIdByTarsId: async (tarsId) => {
    const user = await db.findUser({ tarsId }, '_id');
    return user?._id ? String(user._id) : null;
  },
  findViewableAgentIds: async (user, agentIds) => {
    const principals = await db.getUserPrincipals({
      userId: user.id,
      role: user.role,
      idOnTheSource: user.idOnTheSource,
    });
    const viewable = await db.findAccessibleResources(
      principals,
      ResourceType.AGENT,
      PermissionBits.VIEW,
      agentIds.map((id) => new Types.ObjectId(id)),
    );
    return viewable.map(String);
  },
});
