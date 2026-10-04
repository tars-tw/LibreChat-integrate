const multer = require('multer');

/**
 * Multipart parser for the pwc_tars proxy routes. Files stay in memory because they
 * are relayed to pwc_tars, never stored here. Busboy decodes the filename parameter as
 * latin1 unless told otherwise, which turns the UTF-8 names browsers send (Chinese
 * included) into mojibake before they reach pwc_tars.
 *
 * @param {import('multer').Options['limits']} [limits]
 */
const createTarsUpload = (limits) =>
  multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits });

module.exports = { createTarsUpload };
