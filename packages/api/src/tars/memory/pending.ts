/**
 * Uploading memory files on a brand-new chat creates the pwc_tars conversation
 * before the LibreChat conversation exists, so the mapping has no document to
 * live on yet. This registry parks those ids per LibreChat user until the first
 * send claims them (`request.js` adopts the id only when a claim succeeds, or
 * when document ownership is re-verified against pwc_tars after a restart).
 */
const TTL_MS = 24 * 60 * 60 * 1000;

interface PendingEntry {
  tarsConversationIds: Map<string, number>;
}

const pendingByUser = new Map<string, PendingEntry>();

function prune(entry: PendingEntry): void {
  const now = Date.now();
  for (const [id, registeredAt] of entry.tarsConversationIds) {
    if (now - registeredAt > TTL_MS) {
      entry.tarsConversationIds.delete(id);
    }
  }
}

export function registerPendingTarsConversation(
  librechatUserId: string,
  tarsConversationId: string,
): void {
  const entry = pendingByUser.get(librechatUserId) ?? { tarsConversationIds: new Map() };
  prune(entry);
  entry.tarsConversationIds.set(tarsConversationId, Date.now());
  pendingByUser.set(librechatUserId, entry);
}

/** Consumes a pending id; true only when this user registered it and it has not expired. */
export function claimPendingTarsConversation(
  librechatUserId: string,
  tarsConversationId: string,
): boolean {
  const entry = pendingByUser.get(librechatUserId);
  if (!entry) {
    return false;
  }
  prune(entry);
  const claimed = entry.tarsConversationIds.delete(tarsConversationId);
  if (entry.tarsConversationIds.size === 0) {
    pendingByUser.delete(librechatUserId);
  }
  return claimed;
}

/** Test hook. */
export function clearPendingTarsConversations(): void {
  pendingByUser.clear();
}
