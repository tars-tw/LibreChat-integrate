const express = require('express');
const { createWorkflowTicketHandler, createWorkflowAccountsHandler } = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

router.use('/workflow', requireJwtAuth);

/**
 * @route POST /api/tars/workflow/ticket
 * @desc One-time ticket the Workflow iframe trades for a Langflow session on the user's own
 *       account; a pwc_tars admin may pass `{ actAs }` to enter another workspace (audited).
 * @access Admin, or a role granted Workflow (`admin.langflow`) — checked against pwc_tars live,
 *         falling back to the login-time grant only when pwc_tars cannot be reached
 */
router.post('/workflow/ticket', createWorkflowTicketHandler());

/**
 * @route GET /api/tars/workflow/accounts
 * @desc The workspaces an admin can switch into: everyone who has entered Workflow.
 * @access Admin (pwc_tars)
 */
router.get('/workflow/accounts', requireTarsAdmin, createWorkflowAccountsHandler());

module.exports = router;
