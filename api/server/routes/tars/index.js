const express = require('express');
const audit = require('./audit');
const datasets = require('./datasets');
const domains = require('./domains');
const groups = require('./groups');
const knowledge = require('./knowledge');
const mcp = require('./mcp');
const models = require('./models');
const prompts = require('./prompts');
const roles = require('./roles');
const settings = require('./settings');
const sysconfig = require('./sysconfig');
const syslogs = require('./syslogs');
const tickets = require('./tickets');
const token = require('./token');
const usage = require('./usage');
const users = require('./users');

const router = express.Router();
/** First: the MCP gateway authenticates by gateway key, and the sibling routers'
 *  pathless `router.use(requireJwtAuth)` would otherwise intercept `/mcp`. */
router.use('/', mcp);
/** Second: `/settings/logo` is public so the login page can render the branding
 *  before anyone signs in, and the sibling routers' pathless `requireJwtAuth`
 *  would otherwise intercept it. */
router.use('/', settings);
router.use('/', audit);
router.use('/', datasets);
router.use('/', domains);
router.use('/', groups);
router.use('/', knowledge);
router.use('/', models);
router.use('/', prompts);
router.use('/', roles);
router.use('/', sysconfig);
router.use('/', syslogs);
router.use('/', tickets);
router.use('/', token);
router.use('/', usage);
router.use('/', users);

module.exports = router;
