import { logger } from '@librechat/data-schemas';
import { tarsConfigSchema } from 'librechat-data-provider';
import type { TarsOutboxKind, TarsOutboxItem, TarsOutboxStore } from '@librechat/data-schemas';
import type { TTarsOutboxConfig } from 'librechat-data-provider';
import { createTarsGroupSyncScheduler } from './groupSync';
import { TarsRequestError } from './client';

/** Delivers one kept write; throws as the original call did when it fails again. */
export type TarsOutboxHandlers = Partial<
  Record<TarsOutboxKind, (payload: never) => Promise<unknown>>
>;

const DEFAULTS: TTarsOutboxConfig = tarsConfigSchema.parse({}).outbox;

let configured: { store: TarsOutboxStore; maxAgeMs: number } | null = null;

/** Sets the store failed writes are kept in; without one they are only logged. */
export function configureTarsOutbox(
  store: TarsOutboxStore | null,
  maxAgeMs: number = DEFAULTS.maxAgeMs,
): void {
  configured = store == null ? null : { store, maxAgeMs };
}

/** Whether a failed pwc_tars call may succeed if tried again later. */
export function isRetryableTarsError(error: unknown): boolean {
  if (error instanceof TarsRequestError) {
    return error.status >= 500 || error.status === 429;
  }
  // No reply at all: pwc_tars unreachable, the call timed out or was aborted.
  return true;
}

/** Whether pwc_tars gave no answer or asked to slow down, so the rest of a round can wait. */
function isPwcTarsBackingOff(error: unknown): boolean {
  return !(error instanceof TarsRequestError) || error.status === 429;
}

/** Wait before the attempt after `attempts` failures: 1 min, 2, 4, … up to an hour. */
export function tarsOutboxRetryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60_000);
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? 'unknown error');

/**
 * Keeps a pwc_tars write that failed for a reason worth retrying (pwc_tars down, a timeout,
 * a 5xx or a 429). Returns whether it was kept; a write that cannot succeed (a 4xx) or with
 * no store configured is not. Each write carries an idempotency key (`request_id`), so
 * pwc_tars records a retried one once even when the first attempt landed and only its reply
 * was lost. Never throws.
 */
export async function deferTarsWrite(
  kind: TarsOutboxKind,
  payload: unknown,
  error: unknown,
): Promise<boolean> {
  const outbox = configured;
  if (outbox == null || !isRetryableTarsError(error)) {
    return false;
  }
  try {
    const now = Date.now();
    await outbox.store.add({
      kind,
      payload,
      attempts: 1,
      nextAttemptAt: new Date(now + tarsOutboxRetryDelayMs(1)),
      expiresAt: new Date(now + outbox.maxAgeMs),
      lastError: errorText(error),
    });
    logger.warn(`[tars-outbox] Kept a failed ${kind} write to retry later: ${errorText(error)}`);
    return true;
  } catch (storeError) {
    logger.error(`[tars-outbox] Could not keep a failed ${kind} write for retry`, storeError);
    return false;
  }
}

/**
 * Retries the kept writes that are due, once each. A round stops at the first write
 * pwc_tars did not answer (or answered with a 429): the rest stay due for the next round
 * rather than each waiting out its own timeout. Never throws.
 */
export async function drainTarsOutbox(
  handlers: TarsOutboxHandlers,
  { now = new Date(), limit = DEFAULTS.batchSize }: { now?: Date; limit?: number } = {},
): Promise<{ delivered: number; retried: number; dropped: number }> {
  const counts = { delivered: 0, retried: 0, dropped: 0 };
  const store = configured?.store;
  if (store == null) {
    return counts;
  }
  let dueItems: TarsOutboxItem[];
  try {
    dueItems = await store.due(now, limit);
  } catch (storeError) {
    logger.error('[tars-outbox] Could not load due pwc_tars writes', storeError);
    return counts;
  }
  for (const item of dueItems) {
    try {
      const handler = handlers[item.kind];
      if (handler == null) {
        throw new Error(`no handler for ${item.kind} writes`);
      }
      await handler(item.payload as never);
      await store.remove(item.id);
      counts.delivered += 1;
    } catch (error) {
      const attempts = item.attempts + 1;
      const expired = now.getTime() >= new Date(item.expiresAt).getTime();
      const retry = handlers[item.kind] != null && isRetryableTarsError(error) && !expired;
      try {
        if (retry) {
          await store.reschedule(item.id, {
            attempts,
            nextAttemptAt: new Date(now.getTime() + tarsOutboxRetryDelayMs(attempts)),
            lastError: errorText(error),
          });
          counts.retried += 1;
        } else {
          await store.remove(item.id);
          counts.dropped += 1;
          logger.error(
            `[tars-outbox] Gave up a ${item.kind} write after ${attempts} attempt(s); ` +
              `it did not reach pwc_tars: ${errorText(error)}`,
          );
        }
      } catch (storeError) {
        logger.error(`[tars-outbox] Could not update ${item.kind} write (${item.id})`, storeError);
      }
      if (retry && isPwcTarsBackingOff(error)) {
        break;
      }
    }
  }
  if (counts.delivered + counts.retried + counts.dropped > 0) {
    logger.info(
      `[tars-outbox] delivered=${counts.delivered} retried=${counts.retried} dropped=${counts.dropped}`,
    );
  }
  return counts;
}

/**
 * Configures the store on this instance and returns the periodic retry, which only the
 * cluster leader runs, so two instances never deliver the same kept write. The retry runs
 * as the system tenant: it sends every user's writes, outside any request.
 */
export function createTarsOutbox(deps: {
  store: TarsOutboxStore;
  handlers: TarsOutboxHandlers;
  isLeader: () => Promise<boolean>;
  runAsSystem: <T>(fn: () => Promise<T>) => Promise<T>;
  config?: Partial<TTarsOutboxConfig> | null;
}): { start: () => void; stop: () => void } {
  const config = { ...DEFAULTS, ...deps.config };
  if (!config.enabled) {
    configureTarsOutbox(null);
    return { start: () => undefined, stop: () => undefined };
  }
  configureTarsOutbox(deps.store, config.maxAgeMs);
  const scheduler = createTarsGroupSyncScheduler({
    isLeader: deps.isLeader,
    run: () => deps.runAsSystem(() => drainTarsOutbox(deps.handlers, { limit: config.batchSize })),
    label: 'tarsOutbox',
  });
  return {
    start: () => scheduler.start(config.intervalMs),
    stop: () => scheduler.stop(),
  };
}
