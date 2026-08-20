const multer = require('multer');
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  fetchTarsTickets,
  createTarsTicket,
  updateTarsTicket,
  fetchTarsTicketDetail,
  createTarsTicketComment,
  fetchTarsTicketComponents,
  fetchTarsTicketFieldOptions,
  TARS_TICKET_MAX_FILES,
  TARS_TICKET_MAX_FILE_MB,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TARS_TICKET_MAX_FILE_MB * 1024 * 1024, files: TARS_TICKET_MAX_FILES },
});

/** pwc_tars answers 4xx with its own user-facing message; relay it verbatim. */
const relayTarsError = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

const toUploadFile = (file) => ({
  buffer: file.buffer,
  filename: file.originalname,
  mimetype: file.mimetype,
});

const ticketInput = (body) => ({
  title: (body.title ?? '').trim(),
  description: (body.description ?? '').trim(),
  type: body.type ?? '',
  priority: body.priority ?? '',
  severity: body.severity ?? '',
  component_id: body.component_id ?? '',
});

router.use(requireJwtAuth);

/**
 * @route GET /api/tars/tickets
 * @desc Ticket history for the signed-in operator, with live Issue Tracker status.
 * @access Admin (pwc_tars)
 */
router.get('/tickets', requireTarsAdmin, async (req, res) => {
  try {
    const tickets = await fetchTarsTickets(req.user.tarsId);
    return res.json({ tickets });
  } catch (error) {
    logger.error('[GET /api/tars/tickets] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars support tickets');
  }
});

/**
 * @route GET /api/tars/tickets/options
 * @desc Type / priority / severity domains plus the Issue Tracker components.
 *       Components degrade to an empty list: pwc_tars 400s when the Issue
 *       Tracker is unconfigured, which must not blank out the whole form.
 * @access Admin (pwc_tars)
 */
router.get('/tickets/options', requireTarsAdmin, async (req, res) => {
  try {
    const [fields, components] = await Promise.all([
      fetchTarsTicketFieldOptions(),
      fetchTarsTicketComponents().catch((error) => {
        logger.warn('[GET /api/tars/tickets/options] Component lookup failed', error);
        return [];
      }),
    ]);
    return res.json({ ...fields, components });
  } catch (error) {
    logger.error('[GET /api/tars/tickets/options] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars ticket field options');
  }
});

/**
 * @route GET /api/tars/tickets/:id
 * @desc One ticket enriched with its Issue Tracker status, comments and attachments.
 * @access Admin (pwc_tars)
 */
router.get('/tickets/:id', requireTarsAdmin, async (req, res) => {
  try {
    const ticket = await fetchTarsTicketDetail(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Support ticket not found' });
    }
    return res.json({ ticket });
  } catch (error) {
    logger.error('[GET /api/tars/tickets/:id] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch pwc_tars support ticket');
  }
});

/**
 * @route POST /api/tars/tickets
 * @desc File a new ticket, with up to five attachments.
 * @access Admin (pwc_tars)
 */
router.post(
  '/tickets',
  requireTarsAdmin,
  upload.array('attachments', TARS_TICKET_MAX_FILES),
  async (req, res) => {
    try {
      const ticket = await createTarsTicket(
        {
          tarsId: req.user.tarsId,
          name: req.user.name ?? req.user.username,
          email: req.user.email,
        },
        ticketInput(req.body ?? {}),
        (req.files ?? []).map(toUploadFile),
      );
      return res.json({ ticket });
    } catch (error) {
      logger.error('[POST /api/tars/tickets] Failed', error);
      return relayTarsError(res, error, 'Failed to create pwc_tars support ticket');
    }
  },
);

/**
 * @route PUT /api/tars/tickets/:id
 * @desc Edit a ticket the Issue Tracker still reports as editable.
 * @access Admin (pwc_tars)
 */
router.put(
  '/tickets/:id',
  requireTarsAdmin,
  upload.array('attachments', TARS_TICKET_MAX_FILES),
  async (req, res) => {
    try {
      const ticket = await updateTarsTicket(
        req.user.tarsId,
        req.params.id,
        ticketInput(req.body ?? {}),
        (req.files ?? []).map(toUploadFile),
      );
      return res.json({ ticket });
    } catch (error) {
      logger.error('[PUT /api/tars/tickets/:id] Failed', error);
      return relayTarsError(res, error, 'Failed to update pwc_tars support ticket');
    }
  },
);

/**
 * @route POST /api/tars/tickets/:id/comments
 * @desc Post a customer reply onto the ticket.
 * @access Admin (pwc_tars)
 */
router.post('/tickets/:id/comments', requireTarsAdmin, async (req, res) => {
  try {
    const body = (req.body?.body ?? '').trim();
    if (!body) {
      return res.status(400).json({ error: 'Comment body is required' });
    }
    const id = await createTarsTicketComment(req.user.tarsId, req.params.id, body);
    return res.json({ id });
  } catch (error) {
    logger.error('[POST /api/tars/tickets/:id/comments] Failed', error);
    return relayTarsError(res, error, 'Failed to post pwc_tars ticket comment');
  }
});

module.exports = router;
