const express = require('express');
const domains = require('./domains');
const knowledge = require('./knowledge');
const prompts = require('./prompts');
const sysconfig = require('./sysconfig');

const router = express.Router();
router.use('/', domains);
router.use('/', knowledge);
router.use('/', prompts);
router.use('/', sysconfig);

module.exports = router;
