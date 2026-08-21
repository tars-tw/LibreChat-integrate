const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  fetchTarsSchedules,
  createTarsSchedule,
  updateTarsSchedule,
  deleteTarsSchedule,
  runTarsScheduleNow,
  stopTarsSchedule,
  restartTarsSchedule,
  updateTarsScheduleSyncAll,
  TARS_SCHEDULE_DATASET_TYPES,
} = require('@librechat/api');
const { requireJwtAuth, requireTarsAdmin } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);
router.use(requireTarsAdmin);

/**
 * Relays a pwc_tars 4xx message rather than flattening it to a 500.
 * @param {import('express').Response} res
 * @param {unknown} error
 * @param {string} fallback
 */
const relay = (res, error, fallback) => {
  const status = error?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return res.status(status).json({ error: error.message ?? fallback });
  }
  return res.status(500).json({ error: fallback });
};

/**
 * @route GET /api/tars/schedules
 * @desc Recurring dataset refreshes. Without `knowledgeBaseId`, every schedule
 *       in the knowledge bases the caller may see.
 * @access Admin (pwc_tars)
 */
router.get('/schedules', async (req, res) => {
  try {
    const schedules = await fetchTarsSchedules(req.user.tarsId, req.query.knowledgeBaseId);
    return res.json({ schedules });
  } catch (error) {
    logger.error('[GET /api/tars/schedules] Failed', error);
    return relay(res, error, 'Failed to fetch pwc_tars schedules');
  }
});

/**
 * @route POST /api/tars/schedules
 * @desc Schedule a dataset. pwc_tars arms the job as part of this call.
 * @access Admin (pwc_tars)
 */
router.post('/schedules', async (req, res) => {
  const { datasetId, datasetType, knowledgeBaseId, frequency, frequencyUnit, startTime, endTime } =
    req.body ?? {};

  if (!datasetId || !knowledgeBaseId || !startTime || !frequencyUnit) {
    return res.status(400).json({
      error:
        'datasetId, datasetType, knowledgeBaseId, frequency, frequencyUnit and startTime are required',
    });
  }
  if (!TARS_SCHEDULE_DATASET_TYPES.includes(datasetType)) {
    return res.status(400).json({ error: `Unsupported datasetType: ${datasetType}` });
  }
  if (!Number.isInteger(frequency) || frequency < 1) {
    return res.status(400).json({ error: 'frequency must be a positive integer' });
  }

  try {
    const schedule = await createTarsSchedule(req.user.tarsId, {
      datasetId,
      datasetType,
      knowledgeBaseId,
      frequency,
      frequencyUnit,
      startTime,
      endTime,
    });
    return res.status(201).json({ schedule });
  } catch (error) {
    logger.error('[POST /api/tars/schedules] Failed', error);
    return relay(res, error, 'Failed to create pwc_tars schedule');
  }
});

/**
 * @route PUT /api/tars/schedules/:id
 * @desc Change a schedule's cadence.
 * @access Admin (pwc_tars)
 */
router.put('/schedules/:id', async (req, res) => {
  const { frequency, frequencyUnit, startTime, endTime } = req.body ?? {};
  if (!Number.isInteger(frequency) || frequency < 1 || !frequencyUnit || !startTime) {
    return res.status(400).json({ error: 'frequency, frequencyUnit and startTime are required' });
  }

  try {
    await updateTarsSchedule(req.params.id, { frequency, frequencyUnit, startTime, endTime });
    return res.json({ success: true });
  } catch (error) {
    logger.error('[PUT /api/tars/schedules/:id] Failed', error);
    return relay(res, error, 'Failed to update pwc_tars schedule');
  }
});

/**
 * @route DELETE /api/tars/schedules/:id
 * @access Admin (pwc_tars)
 */
router.delete('/schedules/:id', async (req, res) => {
  try {
    await deleteTarsSchedule(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/tars/schedules/:id] Failed', error);
    return relay(res, error, 'Failed to delete pwc_tars schedule');
  }
});

/**
 * The three job actions differ only in which pwc_tars call they make, so they
 * are registered from one table rather than written out three times.
 */
const JOB_ACTIONS = [
  ['run', runTarsScheduleNow, 'Failed to run pwc_tars schedule'],
  ['stop', stopTarsSchedule, 'Failed to stop pwc_tars schedule'],
  ['restart', restartTarsSchedule, 'Failed to restart pwc_tars schedule'],
];

for (const [action, call, fallback] of JOB_ACTIONS) {
  /**
   * @route POST /api/tars/schedules/:id/{run|stop|restart}
   * @desc pwc_tars exposes run and stop as GETs even though they act; these
   *       are POSTs so a prefetch or a crawler cannot trigger them.
   * @access Admin (pwc_tars)
   */
  router.post(`/schedules/:id/${action}`, async (req, res) => {
    try {
      await call(req.params.id);
      return res.json({ success: true });
    } catch (error) {
      logger.error(`[POST /api/tars/schedules/:id/${action}] Failed`, error);
      return relay(res, error, fallback);
    }
  });
}

/**
 * @route PUT /api/tars/schedules/:id/sync-all
 * @desc Whether the run pulls every file under the path. Document groups only —
 *       the flag lives on the group link, not on the schedule.
 * @access Admin (pwc_tars)
 */
router.put('/schedules/:id/sync-all', async (req, res) => {
  const { isSyncAll } = req.body ?? {};
  if (typeof isSyncAll !== 'boolean') {
    return res.status(400).json({ error: 'isSyncAll must be a boolean' });
  }

  try {
    await updateTarsScheduleSyncAll(req.params.id, isSyncAll);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[PUT /api/tars/schedules/:id/sync-all] Failed', error);
    return relay(res, error, 'Failed to update pwc_tars sync setting');
  }
});

module.exports = router;
