const { tarsErrorReply } = require('@librechat/api');

/**
 * Answers a failed pwc_tars call: pwc_tars's own reason on a 4xx, otherwise the route's
 * fallback as a 500.
 * @param {import('express').Response} res
 * @param {unknown} error
 * @param {string} fallback
 */
const relayTarsError = (res, error, fallback) => {
  const { status, error: message } = tarsErrorReply(error, fallback);
  return res.status(status).json({ error: message });
};

module.exports = { relayTarsError };
