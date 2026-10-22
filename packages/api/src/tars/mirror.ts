import {
  Tools,
  ContentTypes,
  TARS_SWITCH_TOOLS,
  TARS_MESSAGE_STATUS,
} from 'librechat-data-provider';
import type { TMessageContentParts, TextData, TMessage, TFile } from 'librechat-data-provider';
import type { TarsHistoryMessage, TarsPluginHistorySource } from './plugins/context';
import type { UsageMetadata } from '~/stream/interfaces/IJobStore';
import type { TarsTraceRecord, TarsTraceInput } from './trace';
import { tarsContentErrors, TARS_MIRROR_SOURCE } from './trace';
import { loadTarsPluginHistory } from './plugins/context';
import { tarsFetch } from './client';

export interface TarsConversationInput {
  name: string;
  domainId?: string | null;
  modelName?: string | null;
  systemInstruction?: string | null;
}

/** The per-turn columns of a pwc_tars `message` row that LibreChat can supply. */
export interface TarsTurnFields {
  response: string;
  /** This turn's attachments, comma-separated like pwc_tars's own uploads. */
  uploadFilename: string | null;
  isWebSearch: boolean;
  isSqlAgent: boolean;
  messageTokens: number;
  responseTokens: number;
  status: number;
  errorMessage: string | null;
}

export interface TarsMessageInput extends Partial<TarsTurnFields> {
  conversationId: string;
  /**
   * LibreChat's response messageId, reused as the pwc_tars message id so feedback
   * sent under the same id joins this row in the audit report. Resending an id
   * (a continued response) updates the row instead of adding one.
   */
  messageId?: string | null;
  query: string;
  modelName?: string | null;
  ipAddr?: string | null;
  /** Seconds from the turn starting to the response being complete. */
  responseLatency?: number;
  /** The turn's execution trace, which pwc_tars stores for the audit report's timeline. */
  trace?: TarsTraceRecord[];
  /** Earlier turns of the thread, oldest first (see {@link loadTarsMirrorHistory}). */
  history?: TarsHistoryMessage[];
}

/** What LibreChat knows about a finished, stopped or failed turn. */
export interface TarsTurnSource {
  response?: Partial<Pick<TMessage, 'text' | 'content'>> | null;
  files?: Partial<Pick<TFile, 'file_id' | 'filename' | 'type'>>[] | null;
  usage?: UsageMetadata[] | null;
  unfinished?: boolean;
  errorText?: string | null;
}

type TarsToolCall = Extract<TMessageContentParts, { type: ContentTypes.TOOL_CALL }>['tool_call'];

/** The tools that stand for pwc_tars's 資料庫查詢 switch. */
const SQL_TOOL_NAMES = new Set<string>([Tools.sql_agent, ...TARS_SWITCH_TOOLS.sql_agent]);

const partText = (text: string | TextData): string => {
  if (typeof text === 'string') {
    return text;
  }
  return typeof text?.value === 'string' ? text.value : '';
};

/** A list field of the turn, or none when it holds anything else. */
const listOf = <T>(value: readonly T[] | null | undefined): readonly T[] =>
  Array.isArray(value) ? value : [];

const tokens = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const toolCallName = (toolCall: TarsToolCall | undefined): string | undefined => {
  if (toolCall == null || typeof toolCall !== 'object') {
    return undefined;
  }
  if ('name' in toolCall && typeof toolCall.name === 'string') {
    return toolCall.name;
  }
  const name = 'function' in toolCall ? toolCall.function?.name : undefined;
  return typeof name === 'string' ? name : undefined;
};

/**
 * Derives the pwc_tars message columns from a LibreChat turn in one pass over its content.
 * Web search and database query are marked by the tools the turn actually called; tokens
 * add up every model call of the turn, as pwc_tars's agent runtime counts them.
 */
export function buildTarsTurnFields(source: TarsTurnSource): TarsTurnFields {
  const texts: string[] = [];
  let isWebSearch = false;
  let isSqlAgent = false;
  for (const part of listOf(source.response?.content)) {
    if (part == null || typeof part !== 'object') {
      continue;
    }
    if (part.type === ContentTypes.TEXT) {
      const text = part.text != null ? partText(part.text) : '';
      if (text) {
        texts.push(text);
      }
      continue;
    }
    if (part.type !== ContentTypes.TOOL_CALL) {
      continue;
    }
    const name = toolCallName(part.tool_call);
    isWebSearch = isWebSearch || name === Tools.web_search;
    isSqlAgent = isSqlAgent || (name != null && SQL_TOOL_NAMES.has(name));
  }

  let messageTokens = 0;
  let responseTokens = 0;
  for (const usage of listOf(source.usage)) {
    messageTokens += tokens(usage?.input_tokens);
    responseTokens += tokens(usage?.output_tokens);
  }

  const filenames = listOf(source.files)
    .map((file) => file?.filename)
    .filter((filename): filename is string => typeof filename === 'string' && filename !== '');

  let status: number = TARS_MESSAGE_STATUS.success;
  if (source.errorText != null) {
    status = TARS_MESSAGE_STATUS.failed;
  } else if (source.unfinished === true) {
    status = TARS_MESSAGE_STATUS.interrupted;
  }

  return {
    response:
      (typeof source.response?.text === 'string' && source.response.text) || texts.join('\n'),
    uploadFilename: filenames.length > 0 ? filenames.join(',') : null,
    isWebSearch,
    isSqlAgent,
    messageTokens,
    responseTokens,
    status,
    errorMessage: typeof source.errorText === 'string' ? source.errorText : null,
  };
}

/**
 * The `error_message` pwc_tars stores for a turn that stopped short, in the
 * product's language: the audit report shows it as the reason.
 */
export const TARS_INTERRUPTED_MESSAGES = {
  aborted: '使用者中止了回覆',
  stepLimitReached: '已達工具呼叫步數上限，回覆未完成',
  incomplete: '回覆未完成',
} as const;

/** How a LibreChat turn ended, as the request controller knows it. */
export interface TarsTurnOutcome {
  /** The run failed outright; the turn has no response. */
  error?: string | null;
  /** The user stopped it. */
  aborted?: boolean;
  /** The run halted before the answer was complete. */
  incomplete?: boolean;
  stepLimitReached?: boolean;
}

/**
 * The status and error message pwc_tars records for the turn, matching what
 * its own chat stores: a failure is `failed`, a turn that stopped short is
 * `interrupted`. A run that hit an error part still answered, but failed.
 */
export function resolveTarsMessageOutcome(
  outcome: TarsTurnOutcome | null | undefined,
  content?: TarsTraceInput['content'],
): { status: number; errorMessage: string | null } {
  if (outcome?.error) {
    return { status: TARS_MESSAGE_STATUS.failed, errorMessage: outcome.error };
  }
  const [contentError] = tarsContentErrors(content);
  if (contentError) {
    return { status: TARS_MESSAGE_STATUS.failed, errorMessage: contentError };
  }
  if (outcome?.aborted) {
    return {
      status: TARS_MESSAGE_STATUS.interrupted,
      errorMessage: TARS_INTERRUPTED_MESSAGES.aborted,
    };
  }
  if (outcome?.stepLimitReached) {
    return {
      status: TARS_MESSAGE_STATUS.interrupted,
      errorMessage: TARS_INTERRUPTED_MESSAGES.stepLimitReached,
    };
  }
  if (outcome?.incomplete) {
    return {
      status: TARS_MESSAGE_STATUS.interrupted,
      errorMessage: TARS_INTERRUPTED_MESSAGES.incomplete,
    };
  }
  return { status: TARS_MESSAGE_STATUS.success, errorMessage: null };
}

/**
 * The history a mirrored message records: the branch above the turn, in the same
 * shape and window pwc_tars plugins get. A regenerate answers an existing user
 * message, so the walk starts at this turn's own query, which is dropped.
 */
export async function loadTarsMirrorHistory(
  source: TarsPluginHistorySource & { isRegenerate?: boolean },
): Promise<TarsHistoryMessage[]> {
  const history = await loadTarsPluginHistory(source);
  const last = history[history.length - 1];
  return source.isRegenerate && last?.role === 'user' ? history.slice(0, -1) : history;
}

/**
 * Creates a pwc_tars conversation (`POST /api/conversation/create_conversation`)
 * so a LibreChat conversation can be mirrored into pwc_tars. Returns the new
 * pwc_tars conversation id, or null if pwc_tars returns an unexpected payload.
 */
export async function createTarsConversation(
  tarsId: string,
  input: TarsConversationInput,
  baseUrl?: string,
): Promise<string | null> {
  const data = await tarsFetch<{ conversation?: { id?: string } }>(
    '/api/conversation/create_conversation',
    {
      method: 'POST',
      body: {
        name: input.name,
        domain_id: input.domainId ?? null,
        model_name: input.modelName ?? null,
        system_instruction: input.systemInstruction ?? null,
        created_by: tarsId,
      },
      baseUrl,
    },
  );
  return data?.conversation?.id ?? null;
}

/**
 * Names already pushed to pwc_tars, so the rename below costs one request per
 * conversation rather than one per turn. Bounded by evicting in insertion order:
 * a stale eviction only causes a redundant rename, never a wrong one.
 */
const SYNCED_CONVERSATION_NAMES = new Map<string, string>();
const SYNCED_NAME_CACHE_LIMIT = 5000;

/**
 * Renames a pwc_tars conversation to match LibreChat's generated title
 * (`PUT /api/conversation/update_conversation/:id`).
 *
 * A conversation that a long-term-memory upload created is named
 * `長期記憶對話_MMDD` by pwc_tars, and the mirror only passes a name when it
 * creates the conversation itself — so without this those threads keep the
 * placeholder name forever on the pwc_tars side. No-ops once the name matches
 * what was last sent.
 */
export async function syncTarsConversationName(
  tarsId: string,
  tarsConversationId: string,
  name: string,
  baseUrl?: string,
): Promise<void> {
  if (SYNCED_CONVERSATION_NAMES.get(tarsConversationId) === name) {
    return;
  }
  await tarsFetch(
    `/api/conversation/update_conversation/${encodeURIComponent(tarsConversationId)}`,
    {
      method: 'PUT',
      body: { name, updated_by: tarsId },
      baseUrl,
    },
  );
  if (SYNCED_CONVERSATION_NAMES.size >= SYNCED_NAME_CACHE_LIMIT) {
    const oldest = SYNCED_CONVERSATION_NAMES.keys().next().value;
    if (oldest != null) {
      SYNCED_CONVERSATION_NAMES.delete(oldest);
    }
  }
  SYNCED_CONVERSATION_NAMES.set(tarsConversationId, name);
}

/**
 * Mirrors one LibreChat query/response turn into a pwc_tars message
 * (`POST /api/message/create_message`). `message` stores the raw turn as JSON
 * (pwc_tars uses it for the request payload); `response` holds the answer text.
 * `ipAddr` is the user's address; Node reports IPv4 clients as `::ffff:a.b.c.d`.
 * Its `messages` follow pwc_tars's own shape — the history then this query — so
 * the audit report can show the history and pwc_tars can continue the thread.
 */
export async function createTarsMessage(
  tarsId: string,
  input: TarsMessageInput,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/message/create_message', {
    method: 'POST',
    body: {
      ...(input.messageId ? { id: input.messageId } : {}),
      conversation_id: input.conversationId,
      query: input.query,
      response: input.response ?? '',
      message: JSON.stringify({
        source: TARS_MIRROR_SOURCE,
        query: input.query,
        response: input.response ?? '',
        messages: [...(input.history ?? []), { role: 'user', content: input.query }],
      }),
      model_name: input.modelName ?? null,
      message_tokens: input.messageTokens ?? 0,
      response_tokens: input.responseTokens ?? 0,
      ...(input.responseLatency != null && { response_latency: input.responseLatency }),
      ...(input.trace?.length && { trace: input.trace }),
      status: input.status ?? TARS_MESSAGE_STATUS.success,
      error_message: input.errorMessage || null,
      upload_filename: input.uploadFilename || null,
      is_web_search: input.isWebSearch === true,
      is_sql_agent: input.isSqlAgent === true,
      ip_addr: (typeof input.ipAddr === 'string' && input.ipAddr.replace(/^::ffff:/, '')) || null,
      created_by: tarsId,
    },
    baseUrl,
  });
}

/**
 * Soft-deletes the linked pwc_tars conversation and its messages
 * (`DELETE /api/conversation/delete_conversation/:id`) when the LibreChat
 * conversation is deleted. `knowledge_base_id` is required by pwc_tars but only
 * used to remove per-conversation memory files (none for mirrored chats), so a
 * placeholder is sent.
 */
export async function deleteTarsConversation(
  tarsId: string,
  tarsConversationId: string,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch(
    `/api/conversation/delete_conversation/${encodeURIComponent(tarsConversationId)}`,
    {
      method: 'DELETE',
      query: { user_id: tarsId, knowledge_base_id: 'librechat' },
      baseUrl,
    },
  );
}

/**
 * Batch soft-delete of multiple linked pwc_tars conversations
 * (`DELETE /api/conversation/delete_conversations`), used when LibreChat clears
 * all or many conversations at once. See {@link deleteTarsConversation} for the
 * `knowledge_base_id` placeholder rationale.
 */
export async function deleteTarsConversations(
  tarsId: string,
  tarsConversationIds: string[],
  baseUrl?: string,
): Promise<void> {
  if (!tarsConversationIds.length) {
    return;
  }
  await tarsFetch('/api/conversation/delete_conversations', {
    method: 'DELETE',
    body: {
      conversation_ids: tarsConversationIds,
      knowledge_base_id: 'librechat',
      user_id: tarsId,
    },
    baseUrl,
  });
}
