const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  toTarsDateTime,
  fetchTarsActionLogs,
  fetchTarsUserActionLogs,
  fetchTarsActionLogFilterOptions,
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

/** Only non-empty string ids survive; pwc_tars splits these on commas. */
const toIdList = (value) => {
  if (Array.isArray(value)) {
    return value.filter((id) => id != null && id !== '').map(String);
  }
  return typeof value === 'string' && value !== '' ? value.split(',').filter(Boolean) : [];
};

/** Bounds one request; also the ceiling on a CSV export of the filtered set. */
const MAX_PAGE_SIZE = 1000;

const toPageSize = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
};

const toPage = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

/** The window both list endpoints share, normalized once for a single order check. */
const readWindow = (query) => ({
  start: toTarsDateTime(query?.start_date),
  end: toTarsDateTime(query?.end_date),
});

router.use(requireJwtAuth);

/**
 * @route GET /api/tars/audit/operations/options
 * @desc Users, action types and modules for the operation-audit filter bar.
 * @access Admin (pwc_tars)
 */
router.get('/audit/operations/options', requireTarsAdmin, async (req, res) => {
  try {
    const options = await fetchTarsActionLogFilterOptions();
    return res.json(options);
  } catch (error) {
    logger.error('[GET /api/tars/audit/operations/options] Failed', error);
    return relayTarsError(res, error, 'Failed to load audit filter options');
  }
});

/**
 * @route GET /api/tars/audit/operations
 * @desc One page of the system operation audit trail. Paging is pwc_tars-side,
 *       so the page number is part of the request rather than a client slice.
 * @access Admin (pwc_tars)
 */
router.get('/audit/operations', requireTarsAdmin, async (req, res) => {
  const { start, end } = readWindow(req.query);

  if (start != null && end != null && start > end) {
    return res.status(400).json({ error: 'The start date must not be after the end date' });
  }

  try {
    const page = await fetchTarsActionLogs({
      start_date: start,
      end_date: end,
      user_ids: toIdList(req.query.user_ids),
      action_types: toIdList(req.query.action_types),
      modules: toIdList(req.query.modules),
      keyword: (req.query.keyword ?? '').trim(),
      page: toPage(req.query.page),
      page_size: toPageSize(req.query.page_size),
    });
    return res.json(page);
  } catch (error) {
    logger.error('[GET /api/tars/audit/operations] Failed', error);
    return relayTarsError(res, error, 'Failed to load the operation audit trail');
  }
});

/**
 * @route GET /api/tars/audit/operations/user/:userId
 * @desc Every action one operator took in the window, for the timeline view.
 * @access Admin (pwc_tars)
 */
router.get('/audit/operations/user/:userId', requireTarsAdmin, async (req, res) => {
  const { start, end } = readWindow(req.query);

  try {
    const logs = await fetchTarsUserActionLogs(req.params.userId, {
      start_date: start,
      end_date: end,
    });
    return res.json({ logs });
  } catch (error) {
    logger.error('[GET /api/tars/audit/operations/user/:userId] Failed', error);
    return relayTarsError(res, error, 'Failed to load the operator activity');
  }
});

module.exports = router;
