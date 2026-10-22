/**
 * Values a request's tool calls leave for the turn's mirror, by tool call id.
 * Keyed weakly by the request object, so an entry is released with its request
 * and nothing has to clear it after the mirror has read it.
 */
export interface TarsRequestStore<T> {
  /** Adds `value` to what the call already recorded on this request. */
  record(owner: object, toolCallId: string, value: T): void;
  /** What this request's calls recorded, by call id; empty when nothing was. */
  get(owner: object | null | undefined): Map<string, T>;
}

/** A {@link TarsRequestStore} that combines repeated records of one call with `merge`. */
export function createTarsRequestStore<T>(
  merge: (previous: T | undefined, next: T) => T,
): TarsRequestStore<T> {
  const byOwner = new WeakMap<object, Map<string, T>>();
  return {
    record(owner, toolCallId, value) {
      if (owner == null || typeof owner !== 'object' || !toolCallId) {
        return;
      }
      let byCall = byOwner.get(owner);
      if (!byCall) {
        byCall = new Map();
        byOwner.set(owner, byCall);
      }
      byCall.set(toolCallId, merge(byCall.get(toolCallId), value));
    },
    get(owner) {
      return (owner != null && typeof owner === 'object' && byOwner.get(owner)) || new Map();
    },
  };
}
