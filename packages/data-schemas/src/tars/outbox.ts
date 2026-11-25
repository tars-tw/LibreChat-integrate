import { Schema } from 'mongoose';
import type { Model } from 'mongoose';
import logger from '~/config/winston';

/** The pwc_tars writes kept for a retry: a chat mirror or a token usage report. */
export const TARS_OUTBOX_KINDS = ['mirror', 'usage'] as const;
export type TarsOutboxKind = (typeof TARS_OUTBOX_KINDS)[number];

/** One kept write, as the outbox hands it back. */
export interface TarsOutboxItem {
  id: string;
  kind: TarsOutboxKind;
  /** The write as it was first sent; opaque to the store. */
  payload: unknown;
  /** Failed attempts so far, the first included. */
  attempts: number;
  /** When the write is given up if it still fails. */
  expiresAt: Date;
}

/** Where pwc_tars writes that failed are kept until they are sent again. */
export interface TarsOutboxStore {
  add: (item: {
    kind: TarsOutboxKind;
    payload: unknown;
    attempts: number;
    nextAttemptAt: Date;
    expiresAt: Date;
    lastError: string;
  }) => Promise<void>;
  /** Writes whose next attempt is due, oldest first. */
  due: (now: Date, limit: number) => Promise<TarsOutboxItem[]>;
  reschedule: (
    id: string,
    update: { attempts: number; nextAttemptAt: Date; lastError: string },
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

interface TarsOutboxDocument {
  kind: TarsOutboxKind;
  payload: string;
  attempts: number;
  nextAttemptAt: Date;
  expiresAt: Date;
  lastError?: string;
}

/**
 * Mongo removes a write this long after it expired. The leader gives it up (and logs it) at
 * `expiresAt`; this only clears what no instance drains any more, e.g. once pwc_tars is unset.
 */
const EXPIRED_GRACE_SECONDS = 24 * 60 * 60;
const MAX_ERROR_CHARS = 1000;

const tarsOutboxSchema = new Schema<TarsOutboxDocument>(
  {
    kind: { type: String, enum: TARS_OUTBOX_KINDS, required: true },
    /** JSON text: a trace may carry keys (`a.b`, `$x`) Mongo would not store as they are. */
    payload: { type: String, required: true },
    attempts: { type: Number, default: 1 },
    nextAttemptAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true, expires: EXPIRED_GRACE_SECONDS },
    lastError: { type: String },
  },
  { timestamps: true, collection: 'tars_outbox' },
);

const clip = (text: string): string => text.slice(0, MAX_ERROR_CHARS);

/**
 * The outbox `createTarsOutbox` (`@librechat/api`) keeps failed pwc_tars writes in. System-wide:
 * the cluster leader drains every user's writes, so the collection has no tenant scope.
 */
export function createTarsOutboxStore(mongoose: typeof import('mongoose')): TarsOutboxStore {
  const TarsOutbox: Model<TarsOutboxDocument> =
    mongoose.models.TarsOutbox ||
    mongoose.model<TarsOutboxDocument>('TarsOutbox', tarsOutboxSchema);

  /** A stored write, or null when its payload cannot be read; that one is dropped. */
  const toItem = async (
    doc: TarsOutboxDocument & { _id: unknown },
  ): Promise<TarsOutboxItem | null> => {
    try {
      return {
        id: String(doc._id),
        kind: doc.kind,
        payload: JSON.parse(doc.payload),
        attempts: doc.attempts ?? 1,
        expiresAt: doc.expiresAt,
      };
    } catch (error) {
      logger.error(
        `[tars-outbox] Dropping unreadable ${doc.kind} write (${String(doc._id)})`,
        error,
      );
      await TarsOutbox.deleteOne({ _id: doc._id }).catch((removeError: unknown) => {
        logger.error('[tars-outbox] Could not drop unreadable outbox write', removeError);
      });
      return null;
    }
  };

  return {
    add: async ({ payload, lastError, ...item }) => {
      await TarsOutbox.create({
        ...item,
        payload: JSON.stringify(payload),
        lastError: clip(lastError),
      });
    },
    due: async (now, limit) => {
      const docs = await TarsOutbox.find({ nextAttemptAt: { $lte: now } })
        .sort({ nextAttemptAt: 1 })
        .limit(limit)
        .lean<Array<TarsOutboxDocument & { _id: unknown }>>();
      const items = await Promise.all(docs.map(toItem));
      return items.filter((item): item is TarsOutboxItem => item != null);
    },
    reschedule: async (id, { lastError, ...update }) => {
      await TarsOutbox.updateOne({ _id: id }, { $set: { ...update, lastError: clip(lastError) } });
    },
    remove: async (id) => {
      await TarsOutbox.deleteOne({ _id: id });
    },
  };
}
