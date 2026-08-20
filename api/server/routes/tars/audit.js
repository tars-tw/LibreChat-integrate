const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  fetchTarsAuditReport,
  fetchTarsAuditFilterOptions,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

/** pwc_tars answers 4xx with its own user-facing message; relay it verbatim. */
const relayTarsError = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

/** Only string ids survive; pwc_tars builds SQL `IN` clauses from these. */
const toIdList = (value) =>
  Array.isArray(value) ? value.filter((id) => id != null && id !== '').map(String) : [];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

router.use(requireJwtAuth);

/**
 * @route GET /api/tars/audit/messages/options
 * @desc Users, specialized brains and knowledge bases for the audit filter bar.
 * @access Admin (pwc_tars)
 */
router.get('/audit/messages/options', requireTarsAdmin, async (req, res) => {
  try {
    const options = await fetchTarsAuditFilterOptions();
    return res.json(options);
  } catch (error) {
    logger.error('[GET /api/tars/audit/messages/options] Failed', error);
    return relayTarsError(res, error, 'Failed to load audit filter options');
  }
});

/**
 * @route POST /api/tars/audit/messages
 * @desc Message audit report for a date range. POST because the filter set —
 *       multi-select user and knowledge-base ids plus a free-text keyword — does
 *       not fit a query string, matching the pwc_tars endpoint it fronts.
 * @access Admin (pwc_tars)
 */
router.post('/audit/messages', requireTarsAdmin, async (req, res) => {
  const { start_date: startDate, end_date: endDate } = req.body ?? {};

  /** Checked here so an obvious typo never costs a full table scan upstream. */
  if (!DATE_PATTERN.test(startDate ?? '') || !DATE_PATTERN.test(endDate ?? '')) {
    return res.status(400).json({ error: 'A start and end date in YYYY-MM-DD form are required' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: 'The start date must not be after the end date' });
  }

  try {
    const report = await fetchTarsAuditReport(req.user.tarsId, {
      start_date: startDate,
      end_date: endDate,
      filter_user_ids: toIdList(req.body?.filter_user_ids),
      knowledge_base_ids: toIdList(req.body?.knowledge_base_ids),
      domain_id: req.body?.domain_id ?? '',
      query_filter: (req.body?.query_filter ?? '').trim(),
    });
    return res.json(report);
  } catch (error) {
    logger.error('[POST /api/tars/audit/messages] Failed', error);
    return relayTarsError(res, error, 'Failed to run the message audit report');
  }
});

module.exports = router;
