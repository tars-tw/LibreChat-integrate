import { Tools, ContentTypes, TARS_SWITCH_TOOLS } from 'librechat-data-provider';
import type { TMessageContentParts, TextData, TMessage, TFile } from 'librechat-data-provider';
import type { UsageMetadata } from '~/stream/interfaces/IJobStore';
import { tarsFetch } from './client';

export interface TarsConversationInput {
  name: string;
  domainId?: string | null;
  modelName?: string | null;
  systemInstruction?: string | null;
}

/** pwc_tars `SysConst` message statuses. */
export const TARS_MESSAGE_STATUS = { success: 1, failed: 2, interrupted: 3 } as const;

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
}

/** What LibreChat knows about a finished, stopped or failed turn. */
export interface TarsTurnSource {
  response?: Partial<Pick<TMessage, 'text' | 'content'>> | null;
  files?: Partial<Pick<TFile, 'filename'>>[] | null;
  usage?: UsageMetadata[] | null;
  unfinished?: boolean;
  errorText?: string | null;
}

type TarsToolCall = Extract<TMessageContentParts, { type: ContentTypes.TOOL_CALL }>['tool_call'];

/** The tools that stand for pwc_tars's 資料庫查詢 switch. */
const SQL_TOOL_NAMES = new Set<string>([Tools.sql_agent, ...TARS_SWITCH_TOOLS.sql_agent]);

const partText = (text: string | TextData): string =>
  typeof text === 'string' ? text : (text?.value ?? '');

const toolCallName = (toolCall: TarsToolCall | undefined): string | undefined => {
  if (toolCall == null) {
    return undefined;
  }
  if ('name' in toolCall && typeof toolCall.name === 'string') {
    return toolCall.name;
  }
  return 'function' in toolCall ? toolCall.function?.name : undefined;
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
  for (const part of source.response?.content ?? []) {
    if (part?.type === ContentTypes.TEXT) {
      const text = part.text != null ? partText(part.text) : '';
      if (text) {
        texts.push(text);
      }
      continue;
    }
    if (part?.type !== ContentTypes.TOOL_CALL) {
      continue;
    }
    const name = toolCallName(part.tool_call);
    isWebSearch = isWebSearch || name === Tools.web_search;
    isSqlAgent = isSqlAgent || (name != null && SQL_TOOL_NAMES.has(name));
  }

  let messageTokens = 0;
  let responseTokens = 0;
  for (const usage of source.usage ?? []) {
    messageTokens += usage?.input_tokens ?? 0;
    responseTokens += usage?.output_tokens ?? 0;
  }

  const filenames = (source.files ?? [])
    .map((file) => file?.filename)
    .filter((filename): filename is string => !!filename);

  let status: number = TARS_MESSAGE_STATUS.success;
  if (source.errorText != null) {
    status = TARS_MESSAGE_STATUS.failed;
  } else if (source.unfinished === true) {
    status = TARS_MESSAGE_STATUS.interrupted;
  }

  return {
    response: source.response?.text || texts.join('\n'),
    uploadFilename: filenames.length > 0 ? filenames.join(',') : null,
    isWebSearch,
    isSqlAgent,
    messageTokens,
    responseTokens,
    status,
    errorMessage: source.errorText ?? null,
  };
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
        source: 'librechat',
        query: input.query,
        response: input.response ?? '',
      }),
      model_name: input.modelName ?? null,
      message_tokens: input.messageTokens ?? 0,
      response_tokens: input.responseTokens ?? 0,
      status: input.status ?? TARS_MESSAGE_STATUS.success,
      error_message: input.errorMessage ?? null,
      upload_filename: input.uploadFilename ?? null,
      is_web_search: input.isWebSearch ?? false,
      is_sql_agent: input.isSqlAgent ?? false,
      ip_addr: input.ipAddr?.replace(/^::ffff:/, '') || null,
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
