const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const {
  isTarsConfigured,
  createTarsChatMirror,
  deleteTarsConversation,
  deleteTarsConversations,
  mirrorTarsMessageFeedback,
} = require('@librechat/api');
const { getConvo, saveConvo, getMessage, getMessages } = require('~/models');

let chatMirror;

/**
 * Mirrors a finished, stopped or failed chat turn into pwc_tars; never rejects (see
 * `createTarsChatMirror`). Built on first use with `?.` because upstream specs mock
 * `@librechat/api` without it, and a throw here would break the chat controller.
 */
function mirrorChatToTars(req, input) {
  chatMirror ??= createTarsChatMirror?.({ getConvo, saveConvo, getMessages });
  return chatMirror?.(req, input);
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
