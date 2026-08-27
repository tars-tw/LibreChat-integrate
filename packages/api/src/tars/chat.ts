/**
 * The model and 專用腦 each LibreChat user's current chat turn is running on,
 * so pwc_tars reverse-calls made from inside that turn (the SQL agent) inherit
 * both: the nested LLM loop runs on the model the user picked, and the
 * databases it may reach are the ones the active brain binds — mirroring how
 * pwc_tars's own chat path resolves a database from the domain's knowledge
 * bases rather than from everything the user can see.
 *
 * A per-process side channel rather than a request parameter because those
 * calls arrive over MCP, whose tool-call context carries the user and nothing
 * else. LibreChat's `{{LIBRECHAT_BODY_*}}` header placeholders are not usable
 * here: any referenced body field becomes mandatory, and `model` is absent from
 * the payload of saved-agent turns (`compactAgentsBaseSchema` omits it), which
 * would take the whole MCP server down for those turns.
 *
 * Entries are recorded per user, so the only way to read a stale value is for
 * one user to run two concurrent turns on different models — both are valid
 * models, so the cost is that one nested run uses the other turn's.
 */

/** Long enough to outlive a slow agent run, short enough that nothing lingers. */
const CHAT_CONTEXT_TTL_MS = 15 * 60_000;
/** Bound on tracked users; the oldest entry is evicted past this. */
const MAX_TRACKED_USERS = 1_000;

/** What a chat turn carries that pwc_tars reverse-calls need. */
export interface TarsChatContext {
  /** Model the turn resolved to, as LibreChat names it. */
  model?: string;
  /** Active 專用腦 (`sys_domain.id`). */
  domainId?: string;
}

interface ChatContextEntry extends TarsChatContext {
  recordedAt: number;
}

/** Insertion order is recency: {@link rememberTarsChatContext} re-inserts on update. */
const chatContexts = new Map<string, ChatContextEntry>();

function evictExpired(now: number): void {
  for (const [userId, entry] of chatContexts) {
    if (now - entry.recordedAt >= CHAT_CONTEXT_TTL_MS) {
      chatContexts.delete(userId);
    }
  }
}

const normalize = (value?: string | number | null): string | undefined => {
  const text = value == null ? '' : String(value).trim();
  return text || undefined;
};

/**
 * Records what a chat turn resolved to, keyed by LibreChat user id. Absent
 * fields are dropped rather than stored blank, so a turn that names only one of
 * the two does not erase the other's meaning — the entry is replaced whole, so
 * each turn's context stands on its own.
 */
export function rememberTarsChatContext(
  librechatUserId: string,
  context: { model?: string | null; domainId?: string | number | null },
): void {
  if (!librechatUserId) {
    return;
  }
  const model = normalize(context.model);
  const domainId = normalize(context.domainId);
  if (!model && !domainId) {
    return;
  }
  const now = Date.now();
  chatContexts.delete(librechatUserId);
  if (chatContexts.size >= MAX_TRACKED_USERS) {
    evictExpired(now);
  }
  while (chatContexts.size >= MAX_TRACKED_USERS) {
    const oldest = chatContexts.keys().next().value;
    if (oldest == null) {
      break;
    }
    chatContexts.delete(oldest);
  }
  chatContexts.set(librechatUserId, { model, domainId, recordedAt: now });
}

/** What this user's most recent chat turn resolved to, if still fresh. */
export function recallTarsChatContext(librechatUserId: string): TarsChatContext {
  const entry = chatContexts.get(librechatUserId);
  if (!entry) {
    return {};
  }
  if (Date.now() - entry.recordedAt >= CHAT_CONTEXT_TTL_MS) {
    chatContexts.delete(librechatUserId);
    return {};
  }
  return { model: entry.model, domainId: entry.domainId };
}

/** Drops every recorded turn. */
export function clearTarsChatContexts(): void {
  chatContexts.clear();
}
