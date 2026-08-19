const express = require('express');
const domains = require('./domains');
const knowledge = require('./knowledge');
const mcp = require('./mcp');
const models = require('./models');
const prompts = require('./prompts');
const sysconfig = require('./sysconfig');
const users = require('./users');

const router = express.Router();
/** First: the MCP gateway authenticates by gateway key, and the sibling routers'
 *  pathless `router.use(requireJwtAuth)` would otherwise intercept `/mcp`. */
router.use('/', mcp);
router.use('/', domains);
router.use('/', knowledge);
router.use('/', models);
router.use('/', prompts);
router.use('/', sysconfig);
router.use('/', users);

module.exports = router;
