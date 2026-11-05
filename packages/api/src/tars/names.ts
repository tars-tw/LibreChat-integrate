import { logger } from '@librechat/data-schemas';
import type { AllMethods, IUser } from '@librechat/data-schemas';

const LOG_TAG = '[backfillTarsDisplayNames]';

export interface TarsNameBackfillResult {
  /** Accounts with an empty name and a username to replace it with. */
  pending: number;
  /** Accounts written; zero on a dry run. */
  updated: number;
}

/**
 * Sets `name` to `username` on pwc_tars accounts stored with an empty or whitespace-only name,
 * which login mapped before it fell back to the username. Idempotent, and each write is guarded
 * by the values it read, so a name written by a concurrent login is kept.
 */
export async function backfillTarsDisplayNames(
  { findUsers, updateUser }: Pick<AllMethods, 'findUsers' | 'updateUser'>,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<TarsNameBackfillResult> {
  const users: IUser[] = await findUsers(
    { provider: 'tars', name: { $in: [/^\s*$/, null] }, username: { $nin: ['', null] } },
    '_id name username',
  );
  const result: TarsNameBackfillResult = { pending: users.length, updated: 0 };

  for (const { _id, name, username } of users) {
    const id = String(_id);
    if (dryRun) {
      logger.info(`${LOG_TAG} Would set the name of user ${id}`);
      continue;
    }
    const updated = await updateUser(
      id,
      { name: username },
      { name: name ?? null, username },
      { preserveExpiresAt: true },
    );
    if (!updated) {
      logger.warn(`${LOG_TAG} Left user ${id} unchanged: it changed after it was read`);
      continue;
    }
    logger.info(`${LOG_TAG} Set the name of user ${id}`);
    result.updated += 1;
  }
  return result;
}
