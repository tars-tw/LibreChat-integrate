import { logger } from '@librechat/data-schemas';
import type { TFeedback, TFeedbackTagKey, TMinimalFeedback } from 'librechat-data-provider';
import { isTarsConfigured, tarsFetch } from './client';

/**
 * A message's feedback as Mongo holds it: the route stores the minimal form (tag key),
 * but the schema types `tag` as the full tag object, so both shapes are accepted.
 */
export type TarsStoredFeedback = TMinimalFeedback | TFeedback;

/**
 * The zh-Hant wording LibreChat shows for each tag (`com_ui_feedback_tag_*`). pwc_tars has
 * no tag column, so the label is written into the comment text where its audit report shows it.
 */
const TAG_LABELS: Record<TFeedbackTagKey, string> = {
  not_matched: '不符合我的要求',
  inaccurate: '回答不正確',
  bad_style: '風格或語氣不佳',
  missing_image: '預期產生圖片',
  unjustified_refusal: '無故拒絕回答',
  not_helpful: '缺少有用資訊',
  other: '其他問題',
  accurate_reliable: '準確且可靠',
  creative_solution: '創意解法',
  clear_well_written: '清晰且表達流暢',
  attention_to_detail: '注重細節',
};

/** The vote and comment fields of `POST /api/message/update_message_feedback`. */
export interface TarsFeedbackSubmission {
  is_like_hit: boolean;
  is_dislike_hit: boolean;
  message_feedback: string;
}

const tagKeyOf = (feedback: TarsStoredFeedback | null | undefined): string | undefined => {
  const tag = feedback?.tag;
  return typeof tag === 'string' ? tag : tag?.key;
};

const textOf = (feedback: TarsStoredFeedback | null | undefined): string =>
  feedback?.text?.trim() ?? '';

/**
 * What to append to pwc_tars for a feedback change, or null when there is nothing new.
 *
 * pwc_tars records every call as a new row and sums the votes, so a vote is sent only when
 * the rating or tag changes. Adding or editing the comment on the same choice is sent with
 * both votes off — the shape pwc_tars's own comment dialog uses — so it does not count twice.
 * Clearing the feedback is not sent: pwc_tars has no way to retract a row.
 */
export function buildTarsFeedbackSubmission(
  feedback: TarsStoredFeedback | null | undefined,
  previous: TarsStoredFeedback | null | undefined,
): TarsFeedbackSubmission | null {
  const tagKey = tagKeyOf(feedback);
  if (!feedback?.rating || !tagKey) {
    return null;
  }

  const text = textOf(feedback);
  const sameChoice = previous?.rating === feedback.rating && tagKeyOf(previous) === tagKey;
  if (sameChoice && (!text || text === textOf(previous))) {
    return null;
  }

  const label = `[${TAG_LABELS[tagKey as TFeedbackTagKey] ?? tagKey}]`;
  return {
    is_like_hit: !sameChoice && feedback.rating === 'thumbsUp',
    is_dislike_hit: !sameChoice && feedback.rating === 'thumbsDown',
    message_feedback: text ? `${label} ${text}` : label,
  };
}

export interface TarsFeedbackMirrorInput {
  /** The rater's pwc_tars user id; unlinked accounts are skipped. */
  tarsId?: string | null;
  /** LibreChat's response messageId, which the chat mirror also uses as the pwc_tars message id. */
  messageId: string;
  feedback?: TarsStoredFeedback | null;
  previous?: TarsStoredFeedback | null;
}

/**
 * Appends a LibreChat feedback change to pwc_tars (`POST /api/message/update_message_feedback`).
 * `getTarsConversationId` resolves the linked pwc_tars conversation and is only called when
 * there is something to send; a conversation the chat mirror never linked (a temporary chat)
 * is skipped. Never throws.
 */
export async function mirrorTarsMessageFeedback(
  input: TarsFeedbackMirrorInput,
  getTarsConversationId: () => Promise<string | null | undefined>,
  baseUrl?: string,
): Promise<void> {
  try {
    const { tarsId, messageId, feedback, previous } = input;
    if (!isTarsConfigured(baseUrl) || !tarsId || !messageId) {
      return;
    }
    const submission = buildTarsFeedbackSubmission(feedback, previous);
    if (!submission) {
      return;
    }
    const conversationId = await getTarsConversationId();
    if (!conversationId) {
      return;
    }
    await tarsFetch('/api/message/update_message_feedback', {
      method: 'POST',
      baseUrl,
      body: {
        user_id: tarsId,
        conversation_id: conversationId,
        message_id: messageId,
        ...submission,
      },
    });
  } catch (error) {
    logger.error('[mirrorTarsMessageFeedback] Failed to send feedback to pwc_tars', error);
  }
}
