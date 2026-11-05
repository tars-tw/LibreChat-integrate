require('dotenv').config();
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const mongoose = require('mongoose');
const { createModels, runAsSystem } = require('@librechat/data-schemas');
const { backfillTarsDisplayNames } = require('@librechat/api');
const { findUsers, updateUser } = require('~/models');
const connect = require('./connect');

createModels(mongoose);

/**
 * Sets `name` to `username` on pwc_tars accounts stored with an empty name.
 * Idempotent; safe to run while the server is up.
 *
 * Usage: node config/migrate-tars-display-names.js [--dry-run]
 */
(async () => {
  let exitCode = 0;
  try {
    await connect();
    const result = await runAsSystem(() =>
      backfillTarsDisplayNames(
        { findUsers, updateUser },
        { dryRun: process.argv.includes('--dry-run') },
      ),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('TARS display name migration failed:', error);
    exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
  /** Exit explicitly: with Redis enabled, the cache clients opened on connect keep the process alive. */
  process.exit(exitCode);
})();
