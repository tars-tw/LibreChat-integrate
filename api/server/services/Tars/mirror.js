const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const {
  isTarsConfigured,
  createTarsConversation,
  createTarsMessage,
  buildTarsTurnFields,
  syncTarsConversationName,
  deleteTarsConversation,
  deleteTarsConversations,
  mirrorTarsMessageFeedback,
} = require('@librechat/api');
const { getConvo, saveConvo, getMessage } = require('~/models');

/**
 * Best-effort, one-way mirror of a finished, stopped or failed LibreChat chat turn into
 * the pwc_tars DB (LibreChat → pwc_tars). Lazily creates the linked pwc_tars conversation
 * on the first turn and stores the mapping (`tarsConversationId`) on the LibreChat
 * conversation, then appends the query/response as a pwc_tars message. Keeps the
 * pwc_tars-side conversation name in step with LibreChat's generated title.
 * `turn` is a `TarsTurnSource` (response, files, usage, unfinished / errorText).
 *
 * Never throws — any failure is logged and swallowed so chat is unaffected.
 */
async function mirrorChatToTars(
  req,
  { conversationId, existingTarsConversationId, title, model, domainId, query, messageId, turn },
) {
  try {
    const tarsId = req?.user?.tarsId;
    if (!isTarsConfigured() || !tarsId || !conversationId || !query) {
      return;
    }

    const userId = req.user.id;
    // Prefer the mapping captured before generation (the agent's convo save wipes it);
    // fall back to re-reading in case it survived.
    let tarsConversationId =
      existingTarsConversationId || (await getConvo(userId, conversationId))?.tarsConversationId;

    if (!tarsConversationId) {
      tarsConversationId = await createTarsConversation(tarsId, {
        name: title || 'New Chat',
        domainId,
        modelName: model,
        systemInstruction: req?.body?.promptPrefix ?? null,
      });
      if (!tarsConversationId) {
        return;
      }
    } else if (title) {
      // An adopted conversation was named by whoever created it — a long-term-memory
      // upload names it `長期記憶對話_MMDD` — so push LibreChat's title once it exists.
      // Deduplicated inside, so this is one request per conversation, not per turn.
      await syncTarsConversationName(tarsId, tarsConversationId, title);
    }

    // Always re-assert the mapping: the agent's per-turn convo save wipes it, so without
    // re-saving each turn the next turn would create a duplicate pwc_tars conversation.
    await saveConvo(
      { userId },
      { conversationId, tarsConversationId },
      { context: 'api/server/services/Tars/mirror.js - link pwc_tars conversation' },
    );

    await createTarsMessage(tarsId, {
      conversationId: tarsConversationId,
      messageId,
      query,
      modelName: model,
      ipAddr: req.ip,
      ...buildTarsTurnFields(turn ?? {}),
    });
  } catch (error) {
    logger.error('[mirrorChatToTars] Failed to mirror conversation to pwc_tars', error);
  }
}

/**
 * Best-effort mirror of a LibreChat conversation deletion into pwc_tars. Given the
 * linked `tarsConversationId` (resolved before the LibreChat doc is removed),
 * soft-deletes the pwc_tars conversation. Never throws.
 */
async function mirrorDeleteToTars(req, tarsConversationId) {
  try {
    const tarsId = req?.user?.tarsId;
    if (!isTarsConfigured() || !tarsId || !tarsConversationId) {
      return;
    }
    await deleteTarsConversation(tarsId, tarsConversationId);
  } catch (error) {
    logger.error('[mirrorDeleteToTars] Failed to delete pwc_tars conversation', error);
  }
}

/**
 * Collects the linked pwc_tars conversation ids for the LibreChat conversations that
 * a delete operation will remove (matching `filter`, scoped to the user). Must be
 * called BEFORE the LibreChat docs are deleted. Returns [] for non-tars users.
 */
async function collectTarsConversationIds(userId, filter = {}) {
  try {
    const Conversation = mongoose.models.Conversation;
    if (!Conversation) {
      return [];
    }
    const rows = await Conversation.find(
      { ...filter, user: userId, tarsConversationId: { $exists: true, $ne: null } },
      'tarsConversationId',
    ).lean();
    return rows.map((row) => row.tarsConversationId).filter(Boolean);
  } catch (error) {
    logger.error('[collectTarsConversationIds] Failed to collect pwc_tars conversation ids', error);
    return [];
  }
}

/**
 * Best-effort batch mirror of LibreChat conversation deletions into pwc_tars
 * (clear-all / bulk delete). Never throws.
 */
async function mirrorDeleteManyToTars(req, tarsConversationIds) {
  try {
    const tarsId = req?.user?.tarsId;
    if (!isTarsConfigured() || !tarsId || !tarsConversationIds?.length) {
      return;
    }
    await deleteTarsConversations(tarsId, tarsConversationIds);
  } catch (error) {
    logger.error('[mirrorDeleteManyToTars] Failed to delete pwc_tars conversations', error);
  }
}

/**
 * The message's feedback before a change, which the pwc_tars feedback mirror compares
 * against. Read only for pwc_tars-linked users; never throws.
 */
async function getTarsFeedbackBaseline(req, messageId) {
  if (!isTarsConfigured() || !req?.user?.tarsId) {
    return null;
  }
  try {
    return (await getMessage({ user: req.user.id, messageId }))?.feedback ?? null;
  } catch (error) {
    logger.error('[getTarsFeedbackBaseline] Failed to read the previous feedback', error);
    return null;
  }
}

/**
 * Best-effort mirror of a LibreChat like/dislike (and the chosen tag / comment) into pwc_tars
 * `message_feedback`, keyed by the linked pwc_tars conversation. Never throws.
 */
async function mirrorFeedbackToTars(req, { conversationId, messageId, previous, feedback }) {
  try {
    await mirrorTarsMessageFeedback(
      { tarsId: req?.user?.tarsId, messageId, previous, feedback },
      async () => (await getConvo(req.user.id, conversationId))?.tarsConversationId,
    );
  } catch (error) {
    logger.error('[mirrorFeedbackToTars] Failed to send feedback to pwc_tars', error);
  }
}

module.exports = {
  mirrorChatToTars,
  mirrorFeedbackToTars,
  getTarsFeedbackBaseline,
  mirrorDeleteToTars,
  mirrorDeleteManyToTars,
  collectTarsConversationIds,
};
