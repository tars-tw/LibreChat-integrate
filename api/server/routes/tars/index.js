const express = require('express');
const domains = require('./domains');
const knowledge = require('./knowledge');
const prompts = require('./prompts');

const router = express.Router();
router.use('/', domains);
router.use('/', knowledge);
router.use('/', prompts);

module.exports = router;
