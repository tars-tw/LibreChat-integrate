import { randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import { TARS_MESSAGE_STATUS } from 'librechat-data-provider';
import type { TEphemeralAgent, TTarsMemoryAssistConfig } from 'librechat-data-provider';
import type { TarsMemoryUser, TarsMemoryAccessDeps, TarsTemporaryTurnFields } from './memory';
import type { TarsTurnSource, TarsTurnOutcome, TarsMessageInput } from './mirror';
import type { TarsTraceInput, TarsTraceUsage, TarsTurnFile } from './trace';
import type { TarsPluginHistorySource } from './plugins/context';
import {
  createTarsMessage,
  buildTarsTurnFields,
  loadTarsMirrorHistory,
  createTarsConversation,
  syncTarsConversationName,
  resolveTarsMessageOutcome,
} from './mirror';
import { isTemporaryChat, getTarsMemoryAudit, scheduleTarsMemoryUpdate } from './memory';
import { reportTarsUsage, savedTarsAgentId, takeTarsTurnToolUsage } from './usageReport';
import { sumTarsUsage, resolveTarsUsage, buildTarsMirrorTrace } from './trace';
import { getTarsToolAuditTrace } from './tools/auditTrace';
import { withTarsVertexUsageModel } from './vertex';
import { takeTarsFailedToolCalls } from './failure';
import { getTarsTurnFiles } from './files/turn';
import { isTarsConfigured } from './client';
import { deferTarsWrite } from './outbox';

/** A string field, or '' when the caller handed anything else. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A list field, or none when the caller handed anything else. */
const listOf = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

/** The request fields a mirrored turn reads. */
export interface TarsMirrorRequest extends TarsTemporaryTurnFields {
  user?: TarsMemoryUser | null;
  /** The resolved app config, for `tars.memoryAssist` and the retention mode. */
  config?:
    | (NonNullable<TarsTemporaryTurnFields['config']> & {
        config?: { tars?: { memoryAssist?: Partial<TTarsMemoryAssistConfig> } };
      })
    | null;
  body?: {
    isTemporary?: boolean;
    compact?: boolean;
    model?: string | null;
    files?: TarsTurnFile[] | null;
    promptPrefix?: string | null;
    endpoint?: string | null;
    agent_id?: string | null;
    ephemeralAgent?: TEphemeralAgent | null;
    isRegenerate?: boolean;
    parentMessageId?: string;
  } | null;
  ip?: string;
  /** Epoch ms the turn started; set by the chat controllers. */
  turnStartedAt?: number;
}

/** The agent the turn ran, as `client.options.agent` holds it. */
export interface TarsMirrorAgent {
  id?: string | null;
  model?: string | null;
  model_parameters?: Record<string, unknown> | null;
  tools?: TarsTraceInput['availableTools'];
}

export interface TarsChatMirrorInput {
  conversationId?: string | null;
  /** The link captured before generation; the agent's own convo save wipes it. */
  existingTarsConversationId?: string | null;
  title?: string | null;
  model?: string | null;
  domainId?: string | null;
  query?: string | null;
  messageId?: string | null;
  /** The message the query follows, whose branch is the turn's history; the request's own when absent. */
  parentMessageId?: string | null;
  turn?: TarsTurnSource;
  /** LibreChat's own token count, used when the provider reported no usage. */
  tokenEstimate?: { promptTokens?: number | null; completionTokens?: number | null } | null;
  /**
   * The turn's usage already reached pwc_tars segment by segment (a turn that paused for
   * human review, see `reportTarsCollectedUsage`), so the message carries none of its own.
   */
  usageReported?: boolean;
  agent?: TarsMirrorAgent | null;
  attachments?: TarsTraceInput['attachments'];
  outcome?: TarsTurnOutcome | null;
}

/** The LibreChat storage a mirrored turn reads and writes. */
export interface TarsChatMirrorDeps {
  getConvo: (
    userId: string,
    conversationId: string,
  ) => Promise<{ tarsConversationId?: string | null } | null>;
  /** Resolves null when `noUpsert` finds no conversation to update. */
  saveConvo: (
    ctx: { userId: string },
    data: { conversationId: string; tarsConversationId: string },
    options: { context: string; noUpsert?: boolean },
  ) => Promise<unknown>;
  getMessages: TarsPluginHistorySource['getMessages'];
  /** Resolves the role that decides whether this user's memory may be updated. */
  getRoleByName?: TarsMemoryAccessDeps['getRoleByName'];
}

/**
 * Conversation fields a turn save must keep although the turn's options do not
 * carry them. Each save unsets every stored field its options leave out, and the
 * pwc_tars link is not an option: when that save landed after the mirror
 * re-asserted the link, the conversation lost it, so its next turn opened a
 * second pwc_tars conversation and deleting it no longer reached pwc_tars.
 */
export const TARS_PRESERVED_CONVERSATION_FIELDS: readonly string[] = ['tarsConversationId'];

/**
 * A mirrored turn as it is sent to pwc_tars, and kept for a retry when sending fails:
 * plain data, everything already worked out but the pwc_tars conversation it joins.
 */
export interface TarsMirrorDelivery {
  tarsId: string;
  userId: string;
  /** LibreChat's conversation id. */
  conversationId: string;
  /** The link captured before generation; the agent's own convo save wipes it. */
  existingTarsConversationId?: string | null;
  title?: string | null;
  /** For the pwc_tars conversation a conversation's first turn creates. */
  newConversation: {
    domainId?: string | null;
    modelName: string | null;
    systemInstruction: string | null;
  };
  message: Omit<TarsMessageInput, 'conversationId'>;
}

/** The linked pwc_tars conversation, created on the first turn; null when pwc_tars gave no id. */
async function linkTarsConversation(
  deps: Pick<TarsChatMirrorDeps, 'getConvo'>,
  delivery: TarsMirrorDelivery,
): Promise<string | null> {
  const { tarsId, userId, conversationId, title } = delivery;
  const tarsConversationId =
    delivery.existingTarsConversationId ||
    (await deps.getConvo(userId, conversationId))?.tarsConversationId;
  if (tarsConversationId) {
    // An adopted conversation was named by whoever created it — a long-term-memory
    // upload names it `長期記憶對話_MMDD` — so push LibreChat's title once it exists.
    // Deduplicated inside, so this is one request per conversation, not per turn.
    if (title) {
      await syncTarsConversationName(tarsId, tarsConversationId, title);
    }
    return tarsConversationId;
  }
  return createTarsConversation(tarsId, {
    name: title || 'New Chat',
    ...delivery.newConversation,
  });
}

/**
 * Reports the usage of a mirror dropped because its conversation was deleted, so its tokens
 * still reach pwc_tars. Sent under the mirror's own key: when an earlier attempt landed after
 * all, pwc_tars already holds that key and counts nothing twice.
 */
function reportDroppedMirrorUsage({
  tarsId,
  conversationId,
  newConversation,
  message,
}: TarsMirrorDelivery): Promise<void> {
  return reportTarsUsage(tarsId, {
    refType: 'chat',
    requestId: message.requestId,
    messageId: message.messageId,
    conversationId,
    model: message.modelName,
    domainId: newConversation.domainId,
    agentId: message.agentId,
    usage: [{ input_tokens: message.messageTokens, output_tokens: message.responseTokens }],
  });
}

/**
 * Sends a mirrored turn: links (or creates) its pwc_tars conversation, keeps the link on
 * the LibreChat conversation and posts the message. Throws as the calls do; returns false
 * when pwc_tars gave no conversation id, or the conversation was deleted meanwhile (its
 * usage is then reported alone).
 */
export async function deliverTarsMirror(
  deps: Pick<TarsChatMirrorDeps, 'getConvo' | 'saveConvo'>,
  delivery: TarsMirrorDelivery,
): Promise<boolean> {
  const tarsConversationId = await linkTarsConversation(deps, delivery);
  if (!tarsConversationId) {
    return false;
  }
  // Always re-assert the mapping: the agent's per-turn convo save wipes it, so without
  // re-saving each turn the next turn would create a duplicate pwc_tars conversation.
  // Never an upsert: a conversation deleted while the turn waited (a kept mirror waits
  // minutes) would come back as an empty chat holding only the link.
  const linked = await deps.saveConvo(
    { userId: delivery.userId },
    { conversationId: delivery.conversationId, tarsConversationId },
    {
      context: 'api/server/services/Tars/mirror.js - link pwc_tars conversation',
      noUpsert: true,
    },
  );
  if (linked === null) {
    logger.info(
      `[mirrorChatToTars] Conversation ${delivery.conversationId} was deleted; its turn is not mirrored`,
    );
    await reportDroppedMirrorUsage(delivery);
    return false;
  }
  await createTarsMessage(delivery.tarsId, {
    ...delivery.message,
    conversationId: tarsConversationId,
  });
  return true;
}

/**
 * Sends a kept mirror again (the outbox's `mirror` handler). The user may have deleted the
 * conversation while it waited, so it is read first: a deleted one drops the write rather
 * than being brought back here, and in pwc_tars, by the link save, and only its usage is
 * reported. Returns false then.
 */
export async function redeliverTarsMirror(
  deps: Pick<TarsChatMirrorDeps, 'getConvo' | 'saveConvo'>,
  delivery: TarsMirrorDelivery,
): Promise<boolean> {
  const convo = await deps.getConvo(delivery.userId, delivery.conversationId);
  if (convo == null) {
    logger.info(
      `[tars-outbox] Dropped a kept mirror of conversation ${delivery.conversationId}, deleted since`,
    );
    await reportDroppedMirrorUsage(delivery);
    return false;
  }
  return deliverTarsMirror(deps, {
    ...delivery,
    existingTarsConversationId: convo.tarsConversationId || delivery.existingTarsConversationId,
  });
}

/** What the resume route holds once it finishes a turn that paused for human review. */
export interface TarsResumedTurn {
  conversationId?: string | null;
  conversation?: {
    title?: string | null;
    model?: string | null;
    domain_id?: string | null;
    tarsConversationId?: string | null;
  } | null;
  userMessage?: {
    text?: string | null;
    files?: TarsTurnSource['files'];
    parentMessageId?: string | null;
  } | null;
  responseMessage?:
    | (NonNullable<TarsTurnSource['response']> & {
        messageId?: string | null;
        model?: string | null;
        unfinished?: boolean;
        attachments?: TarsTraceInput['attachments'];
      })
    | null;
  client?: { options?: { agent?: TarsMirrorAgent | null } | null } | null;
  isTemporary?: boolean;
  outcome?: TarsTurnOutcome | null;
}

/**
 * The mirror of a turn that paused for human review, which the paused request never sent;
 * null for a temporary chat or a response without an id. Its usage already reached pwc_tars
 * segment by segment (`reportTarsCollectedUsage`), so the message carries none of its own.
 * Never throws: the resume route calls it inline while finishing the turn.
 */
export function toTarsResumedTurnMirror(
  finished: TarsResumedTurn | null | undefined,
): TarsChatMirrorInput | null {
  try {
    const response = finished?.responseMessage;
    if (finished == null || finished.isTemporary === true || !response?.messageId) {
      return null;
    }
    const { conversation, userMessage } = finished;
    return {
      conversationId: finished.conversationId,
      existingTarsConversationId: conversation?.tarsConversationId,
      title: conversation?.title,
      model: conversation?.model ?? response.model,
      domainId: conversation?.domain_id,
      query: userMessage?.text,
      messageId: response.messageId,
      parentMessageId: userMessage?.parentMessageId,
      turn: { response, files: userMessage?.files, unfinished: response.unfinished === true },
      usageReported: true,
      agent: finished.client?.options?.agent,
      attachments: response.attachments,
      outcome: finished.outcome,
    };
  } catch (error) {
    logger.error('[mirrorChatToTars] Could not read the resumed turn to mirror', error);
    return null;
  }
}

/**
 * Best-effort, one-way mirror of a finished, stopped or failed LibreChat chat turn into
 * the pwc_tars DB (LibreChat → pwc_tars). Lazily creates the linked pwc_tars conversation
 * on the first turn and stores the mapping (`tarsConversationId`) on the LibreChat
 * conversation, then appends the query/response as a pwc_tars message. Keeps the
 * pwc_tars-side conversation name in step with LibreChat's generated title.
 * The turn's execution trace (tool calls, model text, usage) rides along so the
 * pwc_tars audit report can show its timeline; `outcome` refines the status and
 * error message pwc_tars records (see `resolveTarsMessageOutcome`).
 *
 * The returned function never throws — any failure is logged and swallowed so chat
 * is unaffected, which is what lets callers fire it without awaiting.
 */
export function createTarsChatMirror(deps: TarsChatMirrorDeps) {
  /** The earlier turns of the thread; a failed read only loses the history. */
  const loadHistory = async (
    req: TarsMirrorRequest,
    conversationId: string,
    parentMessageId: string | undefined,
  ) => {
    try {
      return await loadTarsMirrorHistory({
        conversationId,
        parentMessageId,
        userId: req.user?.id,
        isRegenerate: req.body?.isRegenerate === true,
        getMessages: deps.getMessages,
      });
    } catch (error) {
      logger.warn('[mirrorChatToTars] Failed to read the conversation history', error);
      return [];
    }
  };

  return async function mirrorChatToTars(
    req: TarsMirrorRequest,
    input: TarsChatMirrorInput,
  ): Promise<void> {
    const finishedAt = Date.now();
    try {
      const { conversationId, turn = {}, agent, outcome } = input;
      /** Taken before any early return, so a turn that is not mirrored still clears them. */
      const failedToolCalls = takeTarsFailedToolCalls(textOf(req.user?.id), conversationId);
      // A saved agent's conversation may carry no model of its own; the agent ran one.
      const modelParameters = isRecord(agent?.model_parameters) ? agent.model_parameters : null;
      const model =
        textOf(input.model) ||
        textOf(
          modelParameters && withTarsVertexUsageModel(modelParameters as { model?: string }).model,
        ) ||
        textOf(agent?.model) ||
        textOf(req.body?.model) ||
        null;
      const tarsId = textOf(req.user?.tarsId);
      const userId = textOf(req.user?.id);
      const content = turn.response?.content;
      const { status, errorMessage } = resolveTarsMessageOutcome(
        { error: turn.errorText, incomplete: turn.unfinished, ...outcome },
        content,
      );
      const turnFiles = listOf(turn.files ?? req.body?.files);
      const fileNames = turnFiles.map((file) => textOf(file?.filename)).filter(Boolean);
      // A message of attachments alone has no text; pwc_tars needs a query, so it
      // is named by its files, as LibreChat titles such a conversation.
      const query = textOf(input.query) || fileNames.join(', ');
      // A manual compaction (no query of its own) and a temporary chat are not mirrored;
      // `reportTarsCollectedUsage` reports their usage, judged by the same tests.
      const unmirrored = req.body?.compact === true || isTemporaryChat(req);
      if (!isTarsConfigured() || !tarsId || !userId || !conversationId || !query || unmirrored) {
        return;
      }

      const startedAt =
        typeof req.turnStartedAt === 'number' && Number.isFinite(req.turnStartedAt)
          ? req.turnStartedAt
          : undefined;
      // A failed turn the provider reported no usage for was refused before any
      // output (a 400 on a bad parameter or input), so it billed nothing: no
      // estimate stands in, as pwc_tars records 0 for its own such messages.
      const turnUsage = input.usageReported
        ? []
        : resolveTarsUsage(
            turn.usage,
            status === TARS_MESSAGE_STATUS.failed ? null : input.tokenEstimate,
          );
      const agentId = savedTarsAgentId(agent?.id, textOf(req.body?.agent_id));
      const toolUsage = input.usageReported
        ? new Map<string, TarsTraceUsage>()
        : takeTarsTurnToolUsage(req, tarsId, {
            messageId: input.messageId,
            conversationId,
            model,
            domainId: input.domainId,
            agentId,
          });
      const turnFields = buildTarsTurnFields(turn);
      const history = await loadHistory(
        req,
        conversationId,
        textOf(input.parentMessageId) || req.body?.parentMessageId,
      );
      const message: TarsMirrorDelivery['message'] = {
        requestId: randomUUID(),
        agentId,
        messageId: input.messageId,
        query,
        modelName: model,
        ipAddr: req.ip,
        ...turnFields,
        ...sumTarsUsage([...turnUsage, ...toolUsage.values()]),
        responseLatency: startedAt ? (finishedAt - startedAt) / 1000 : undefined,
        history,
        status,
        errorMessage,
        trace: buildTarsMirrorTrace({
          query,
          content,
          startedAt,
          finishedAt,
          model,
          endpoint: req.body?.endpoint,
          agentId: req.body?.agent_id,
          domainId: input.domainId,
          ephemeralAgent: req.body?.ephemeralAgent,
          isRegenerate: req.body?.isRegenerate,
          turnFiles,
          modelParameters,
          availableTools: agent?.tools,
          usage: turnUsage,
          threadFiles: getTarsTurnFiles(req),
          memoryContext: await getTarsMemoryAudit(req),
          toolAuditTrace: getTarsToolAuditTrace(req),
          failedToolCalls,
          toolUsage,
          attachments: input.attachments,
        }),
      };
      const delivery: TarsMirrorDelivery = {
        tarsId,
        userId,
        conversationId,
        existingTarsConversationId: input.existingTarsConversationId,
        title: input.title,
        newConversation: {
          domainId: input.domainId,
          modelName: model,
          systemInstruction: req.body?.promptPrefix ?? null,
        },
        message,
      };
      let delivered: boolean;
      try {
        delivered = await deliverTarsMirror(deps, delivery);
      } catch (error) {
        // pwc_tars down or slow: keep the turn and send it again later.
        if (await deferTarsWrite('mirror', delivery, error)) {
          return;
        }
        throw error;
      }
      if (!delivered) {
        return;
      }
      /** Only a finished turn teaches anything; a stopped or failed one may be half an answer. */
      if (status === TARS_MESSAGE_STATUS.success && req.body?.compact !== true) {
        await scheduleTarsMemoryUpdate(req, {
          conversationId,
          query: textOf(input.query),
          response: turnFields.response,
          history,
          model,
          messageId: input.messageId,
          domainId: input.domainId,
          config: req.config?.config?.tars?.memoryAssist,
          getRoleByName: deps.getRoleByName,
        });
      }
    } catch (error) {
      logger.error('[mirrorChatToTars] Failed to mirror conversation to pwc_tars', error);
    }
  };
}
