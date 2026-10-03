import { Tools, ContentTypes } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';

/** One prior turn as pwc_tars hands it to a plugin (`ctx.history`). */
export interface TarsHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * How many prior messages a plugin sees — pwc_tars's
 * `SysConst.CONVERSATION_HISTORY_MAX_RECENT_MESSAGES`, so a plugin gets the
 * same window from either host.
 */
export const TARS_PLUGIN_HISTORY_MAX_MESSAGES = 20;

type StoredMessage = Pick<
  TMessage,
  'messageId' | 'parentMessageId' | 'isCreatedByUser' | 'text' | 'content' | 'attachments'
>;

export interface TarsPluginHistorySource {
  conversationId?: string;
  /** Parent of the message being answered; the chain above it is the history. */
  parentMessageId?: string;
  userId?: string;
  getMessages: (filter: { conversationId: string; user: string }) => Promise<StoredMessage[]>;
}

type ContentPart = NonNullable<TMessage['content']>[number];

const partText = (part: ContentPart | undefined): string => {
  if (part?.type !== ContentTypes.TEXT) {
    return '';
  }
  const text = (part as { text?: string | { value?: string } }).text;
  return typeof text === 'string' ? text : (text?.value ?? '');
};

/**
 * Answers plugins that ended the turn wrote for the user. pwc_tars stores that
 * answer as the assistant message itself; here it lives on the call's
 * `tars_trace` attachment and the message text is only the model's closing
 * line, so it is put back in front of that line.
 */
const pluginAnswers = (message: StoredMessage): string[] =>
  (message.attachments ?? []).flatMap((attachment) => {
    const answer =
      attachment.type === Tools.tars_trace ? attachment[Tools.tars_trace]?.step?.answer : undefined;
    return answer?.trim() ? [answer.trim()] : [];
  });

/** What the message said to the user: plugin answers, then its text parts (or `text`). */
const messageText = (message: StoredMessage): string => {
  const fromParts = Array.isArray(message.content)
    ? message.content.map(partText).filter(Boolean).join('\n')
    : '';
  const text = (fromParts || message.text || '').trim();
  const answers = message.isCreatedByUser ? [] : pluginAnswers(message);
  return [...answers, text].filter(Boolean).join('\n\n');
};

/**
 * `ctx.history`: the branch above the message being answered, oldest first,
 * as `{role, content}` — the shape and window pwc_tars's chat builds with
 * `build_history_from_payload`. Read only when a plugin actually runs, so a
 * turn that never calls one costs no query. Empty for a new conversation.
 */
export async function loadTarsPluginHistory(
  source: TarsPluginHistorySource,
): Promise<TarsHistoryMessage[]> {
  const { conversationId, parentMessageId, userId, getMessages } = source;
  if (!conversationId || !parentMessageId || !userId || conversationId === 'new') {
    return [];
  }
  const rows = await getMessages({ conversationId, user: userId });
  const byId = new Map(rows.map((row) => [row.messageId, row]));
  const chain: TarsHistoryMessage[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = parentMessageId;
  while (cursor && !seen.has(cursor) && chain.length < TARS_PLUGIN_HISTORY_MAX_MESSAGES) {
    seen.add(cursor);
    const row = byId.get(cursor);
    if (!row) {
      break;
    }
    const content = messageText(row);
    if (content) {
      chain.push({ role: row.isCreatedByUser ? 'user' : 'assistant', content });
    }
    cursor = row.parentMessageId;
  }
  return chain.reverse();
}
