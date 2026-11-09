const { createTarsMcpGrantEnable } = require('@librechat/api');
const tarsSharing = require('~/server/services/tarsSharing');

/** Turns an MCP server on in My Tools for the people an admin newly assigns it to. */
module.exports = createTarsMcpGrantEnable({ directory: tarsSharing.directory });
