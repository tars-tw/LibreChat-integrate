const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { TarsRequestError, fetchTarsProviderUsage } = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

/** pwc_tars answers 4xx with its own user-facing message; relay it verbatim. */
const relayTarsError = (res, error, fallback) => {
  if (error instanceof TarsRequestError && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.serverMessage ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

const PROVIDERS = new Set(['openai', 'anthropic']);
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

router.use(requireJwtAuth);

/**
 * @route GET /api/tars/usage/:provider
 * @desc One month of provider spend and token usage, billed straight from the
 *       provider's admin API. pwc_tars supplies the price-query key itself, so
 *       no credential crosses this route.
 * @access Admin (pwc_tars)
 */
router.get('/usage/:provider', requireTarsAdmin, async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.has(provider)) {
    return res.status(400).json({ error: 'Unsupported usage provider' });
  }

  const { month, budget } = req.query;
  if (month != null && !MONTH_PATTERN.test(month)) {
    return res.status(400).json({ error: 'A month in YYYY-MM form is required' });
  }

  const parsedBudget = budget == null || budget === '' ? undefined : Number(budget);
  if (parsedBudget != null && (!Number.isFinite(parsedBudget) || parsedBudget < 0)) {
    return res.status(400).json({ error: 'The budget must be a non-negative number' });
  }

  try {
    const usage = await fetchTarsProviderUsage(provider, { month, budget: parsedBudget });
    return res.json(usage);
  } catch (error) {
    logger.error(`[GET /api/tars/usage/${provider}] Failed`, error);
    return relayTarsError(res, error, 'Failed to fetch provider usage');
  }
});

module.exports = router;
