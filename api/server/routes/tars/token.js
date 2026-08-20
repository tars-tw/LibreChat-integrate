const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  TarsRequestError,
  fetchTarsTokenConfigs,
  createTarsTokenConfig,
  updateTarsTokenConfig,
  deleteTarsTokenConfig,
  searchTarsTokenUsers,
  fetchTarsTokenUserQuotas,
  createTarsTokenUserQuota,
  updateTarsTokenUserQuota,
  deleteTarsTokenUserQuota,
  fetchTarsTokenPrepareData,
  fetchTarsTokenSystemDefaults,
  updateTarsTokenSystemDefault,
  fetchTarsTokenReportUser,
  fetchTarsTokenReportExport,
  fetchTarsTokenReportMembers,
  fetchTarsTokenReportOverview,
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

const actorOf = (req) => ({ tarsId: req.user.tarsId });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The reports scan `token_usage_log` for the whole range, so an obviously wrong
 * range is rejected here rather than costing a full table scan upstream.
 */
const rangeOf = (body) => {
  const start = body?.start_date ?? '';
  const end = body?.end_date ?? '';
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) {
    return { error: 'A start and end date in YYYY-MM-DD form are required' };
  }
  if (start > end) {
    return { error: 'The start date must not be after the end date' };
  }
  return { range: { start_date: start, end_date: end } };
};

/** Blank strings mean "no filter" upstream, where they would match no row. */
const filtersOf = (query, keys) =>
  keys.reduce((filters, key) => {
    const value = query[key];
    if (value != null && value !== '') {
      filters[key] = value;
    }
    return filters;
  }, {});

const CONFIG_FIELDS = [
  'domain_id',
  'user_group_id',
  'provider',
  'system_total_limit',
  'default_user_limit',
  'reset_type',
  'reset_day',
  'warning_threshold',
  'is_active',
];

const QUOTA_FIELDS = [
  'user_id',
  'provider',
  'domain_id',
  'user_group_id',
  'custom_limit',
  'status',
];

const SYSTEM_DEFAULT_FIELDS = [
  'provider',
  'system_total_limit',
  'default_user_limit',
  'reset_type',
  'reset_day',
  'warning_threshold',
];

/** Only the fields the caller actually sent, so a PUT never blanks an untouched column. */
const pick = (body, fields) =>
  fields.reduce((input, field) => {
    if (body?.[field] !== undefined) {
      input[field] = body[field];
    }
    return input;
  }, {});

router.use(requireJwtAuth);
router.use(requireTarsAdmin);

/**
 * @route GET /api/tars/token/prepare-data
 * @desc User groups (with the brains their roles grant) and every brain, for the
 *       quota form's linked pickers.
 * @access Admin (pwc_tars)
 */
router.get('/token/prepare-data', async (req, res) => {
  try {
    return res.json(await fetchTarsTokenPrepareData());
  } catch (error) {
    logger.error('[GET /api/tars/token/prepare-data] Failed', error);
    return relayTarsError(res, error, 'Failed to load token quota form data');
  }
});

/**
 * @route GET /api/tars/token/users
 * @desc Search pwc_tars users for the personal-quota picker (upstream caps at 20).
 * @access Admin (pwc_tars)
 */
router.get('/token/users', async (req, res) => {
  try {
    const users = await searchTarsTokenUsers((req.query.q ?? '').trim());
    return res.json({ users });
  } catch (error) {
    logger.error('[GET /api/tars/token/users] Failed', error);
    return relayTarsError(res, error, 'Failed to search users');
  }
});

/**
 * @route GET /api/tars/token/configs
 * @desc Group-level quota rules, optionally narrowed by brain, group or provider.
 * @access Admin (pwc_tars)
 */
router.get('/token/configs', async (req, res) => {
  try {
    const configs = await fetchTarsTokenConfigs(
      filtersOf(req.query, ['domain_id', 'user_group_id', 'provider', 'is_active']),
    );
    return res.json({ configs });
  } catch (error) {
    logger.error('[GET /api/tars/token/configs] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch token quota rules');
  }
});

router.post('/token/configs', async (req, res) => {
  const { domain_id: domainId, user_group_id: groupId } = req.body ?? {};
  if (!domainId || !groupId) {
    return res.status(400).json({ error: 'A specialized brain and a user group are required' });
  }
  try {
    const config = await createTarsTokenConfig(actorOf(req), pick(req.body, CONFIG_FIELDS));
    return res.status(201).json({ config });
  } catch (error) {
    logger.error('[POST /api/tars/token/configs] Failed', error);
    return relayTarsError(res, error, 'Failed to create the token quota rule');
  }
});

router.put('/token/configs/:configId', async (req, res) => {
  try {
    const config = await updateTarsTokenConfig(
      actorOf(req),
      req.params.configId,
      pick(req.body, CONFIG_FIELDS),
    );
    return res.json({ config });
  } catch (error) {
    logger.error('[PUT /api/tars/token/configs/:configId] Failed', error);
    return relayTarsError(res, error, 'Failed to update the token quota rule');
  }
});

router.delete('/token/configs/:configId', async (req, res) => {
  try {
    await deleteTarsTokenConfig(req.params.configId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/token/configs/:configId] Failed', error);
    return relayTarsError(res, error, 'Failed to delete the token quota rule');
  }
});

/**
 * @route GET /api/tars/token/quotas
 * @desc Per-person quota overrides, with the consumption pwc_tars counts against them.
 * @access Admin (pwc_tars)
 */
router.get('/token/quotas', async (req, res) => {
  try {
    const quotas = await fetchTarsTokenUserQuotas(
      filtersOf(req.query, ['domain_id', 'user_group_id', 'user_id', 'provider', 'status']),
    );
    return res.json({ quotas });
  } catch (error) {
    logger.error('[GET /api/tars/token/quotas] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch personal token quotas');
  }
});

router.post('/token/quotas', async (req, res) => {
  const { user_id: userId, provider } = req.body ?? {};
  if (!userId || !provider) {
    return res.status(400).json({ error: 'A user and a provider are required' });
  }
  try {
    const quota = await createTarsTokenUserQuota(actorOf(req), pick(req.body, QUOTA_FIELDS));
    return res.status(201).json({ quota });
  } catch (error) {
    logger.error('[POST /api/tars/token/quotas] Failed', error);
    return relayTarsError(res, error, 'Failed to create the personal token quota');
  }
});

router.put('/token/quotas/:quotaId', async (req, res) => {
  try {
    const quota = await updateTarsTokenUserQuota(
      actorOf(req),
      req.params.quotaId,
      pick(req.body, QUOTA_FIELDS),
    );
    return res.json({ quota });
  } catch (error) {
    logger.error('[PUT /api/tars/token/quotas/:quotaId] Failed', error);
    return relayTarsError(res, error, 'Failed to update the personal token quota');
  }
});

router.delete('/token/quotas/:quotaId', async (req, res) => {
  try {
    await deleteTarsTokenUserQuota(req.params.quotaId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/token/quotas/:quotaId] Failed', error);
    return relayTarsError(res, error, 'Failed to delete the personal token quota');
  }
});

/**
 * @route GET /api/tars/token/system-defaults
 * @desc The per-provider fallback rules — config rows with neither brain nor group.
 * @access Admin (pwc_tars)
 */
router.get('/token/system-defaults', async (req, res) => {
  try {
    const defaults = await fetchTarsTokenSystemDefaults();
    return res.json({ defaults });
  } catch (error) {
    logger.error('[GET /api/tars/token/system-defaults] Failed', error);
    return relayTarsError(res, error, 'Failed to fetch token quota defaults');
  }
});

/** Upserts by provider — pwc_tars creates the row when no default exists yet. */
router.put('/token/system-defaults', async (req, res) => {
  if (!req.body?.provider) {
    return res.status(400).json({ error: 'A provider is required' });
  }
  try {
    const config = await updateTarsTokenSystemDefault(
      actorOf(req),
      pick(req.body, SYSTEM_DEFAULT_FIELDS),
    );
    return res.json({ config });
  } catch (error) {
    logger.error('[PUT /api/tars/token/system-defaults] Failed', error);
    return relayTarsError(res, error, 'Failed to update the token quota default');
  }
});

/**
 * @route POST /api/tars/token/report/overview
 * @desc Group totals for the period, plus the specialized-brain and model
 *       splits. POST because pwc_tars takes the range in the body.
 * @access Admin (pwc_tars)
 */
router.post('/token/report/overview', async (req, res) => {
  const { range, error } = rangeOf(req.body);
  if (error != null) {
    return res.status(400).json({ error });
  }
  try {
    return res.json(await fetchTarsTokenReportOverview(range));
  } catch (err) {
    logger.error('[POST /api/tars/token/report/overview] Failed', err);
    return relayTarsError(res, err, 'Failed to run the token usage report');
  }
});

/**
 * @route POST /api/tars/token/report/members
 * @desc Member totals inside the given user groups.
 * @access Admin (pwc_tars)
 */
router.post('/token/report/members', async (req, res) => {
  const { range, error } = rangeOf(req.body);
  if (error != null) {
    return res.status(400).json({ error });
  }
  const groupIds = Array.isArray(req.body?.user_group_ids)
    ? req.body.user_group_ids.filter((id) => id != null && id !== '').map(String)
    : [];
  if (groupIds.length === 0) {
    return res.status(400).json({ error: 'At least one user group is required' });
  }
  try {
    const members = await fetchTarsTokenReportMembers(range, groupIds);
    return res.json({ members });
  } catch (err) {
    logger.error('[POST /api/tars/token/report/members] Failed', err);
    return relayTarsError(res, err, 'Failed to fetch member token usage');
  }
});

/**
 * @route POST /api/tars/token/report/user
 * @desc One person's period totals and their day-by-day series.
 * @access Admin (pwc_tars)
 */
router.post('/token/report/user', async (req, res) => {
  const { range, error } = rangeOf(req.body);
  if (error != null) {
    return res.status(400).json({ error });
  }
  if (!req.body?.user_id) {
    return res.status(400).json({ error: 'A user is required' });
  }
  try {
    const usage = await fetchTarsTokenReportUser(range, String(req.body.user_id));
    return res.json({ usage });
  } catch (err) {
    logger.error('[POST /api/tars/token/report/user] Failed', err);
    return relayTarsError(res, err, 'Failed to fetch the user token usage detail');
  }
});

/**
 * @route POST /api/tars/token/report/export
 * @desc The three datasets the CSV export is built from: group totals, every
 *       account's totals, and the raw usage log.
 * @access Admin (pwc_tars)
 */
router.post('/token/report/export', async (req, res) => {
  const { range, error } = rangeOf(req.body);
  if (error != null) {
    return res.status(400).json({ error });
  }
  try {
    return res.json(await fetchTarsTokenReportExport(range));
  } catch (err) {
    logger.error('[POST /api/tars/token/report/export] Failed', err);
    return relayTarsError(res, err, 'Failed to export the token usage report');
  }
});

module.exports = router;
