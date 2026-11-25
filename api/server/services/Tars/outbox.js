const mongoose = require('mongoose');
const { logger, runAsSystem, createTarsOutboxStore } = require('@librechat/data-schemas');
const {
  isLeader,
  createTarsOutbox,
  isTarsConfigured,
  redeliverTarsMirror,
  deliverTarsUsageReport,
} = require('@librechat/api');
const { getConvo, saveConvo } = require('~/models');

/**
 * Starts resending the pwc_tars writes (chat mirrors, usage reports) that failed while
 * pwc_tars was down or slow, as `tars.outbox` configures. See `createTarsOutbox`.
 * `?.` because upstream specs mock `@librechat/api` without it. Never throws.
 */
function startTarsOutbox(appConfig) {
  try {
    if (!isTarsConfigured?.()) {
      return;
    }
    createTarsOutbox({
      store: createTarsOutboxStore(mongoose),
      handlers: {
        mirror: (delivery) => redeliverTarsMirror({ getConvo, saveConvo }, delivery),
        usage: (delivery) => deliverTarsUsageReport(delivery),
      },
      isLeader,
      runAsSystem,
      config: appConfig?.config?.tars?.outbox,
    }).start();
  } catch (error) {
    logger.error('[tars-outbox] Could not start the retry of failed pwc_tars writes', error);
  }
}

module.exports = { startTarsOutbox };
