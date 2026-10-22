import { logger } from '@librechat/data-schemas';
import { TARS_MESSAGE_STATUS } from 'librechat-data-provider';
import type { TEphemeralAgent } from 'librechat-data-provider';
import type { TarsPluginHistorySource } from './plugins/context';
import type { TarsTurnSource, TarsTurnOutcome } from './mirror';
import type { TarsTraceInput, TarsTurnFile } from './trace';
import {
  createTarsMessage,
  buildTarsTurnFields,
  loadTarsMirrorHistory,
  createTarsConversation,
  syncTarsConversationName,
  resolveTarsMessageOutcome,
} from './mirror';
import { sumTarsUsage, resolveTarsUsage, buildTarsMirrorTrace } from './trace';
import { getTarsToolAuditTrace } from './tools/auditTrace';
import { takeTarsFailedToolCalls } from './failure';
import { getTarsToolUsage } from './tools/usage';
import { getTarsTurnFiles } from './files/turn';
import { isTarsConfigured } from './client';

/** A string field, or '' when the caller handed anything else. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A list field, or none when the caller handed anything else. */
const listOf = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

/** The request fields a mirrored turn reads. */
export interface TarsMirrorRequest {
  user?: { id?: string; tarsId?: string | null } | null;
  body?: {
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
  turn?: TarsTurnSource;
  /** LibreChat's own token count, used when the provider reported no usage. */
  tokenEstimate?: { promptTokens?: number | null; completionTokens?: number | null } | null;
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
  saveConvo: (
    ctx: { userId: string },
    data: { conversationId: string; tarsConversationId: string },
    options: { context: string },
  ) => Promise<unknown>;
  getMessages: TarsPluginHistorySource['getMessages'];
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
  const loadHistory = async (req: TarsMirrorRequest, conversationId: string) => {
    try {
      return await loadTarsMirrorHistory({
        conversationId,
        parentMessageId: req.body?.parentMessageId,
        userId: req.user?.id,
        isRegenerate: req.body?.isRegenerate === true,
        getMessages: deps.getMessages,
      });
    } catch (error) {
      logger.warn('[mirrorChatToTars] Failed to read the conversation history', error);
      return [];
    }
  };

  /** The linked pwc_tars conversation, created on the first turn. */
  const linkConversation = async (
    req: TarsMirrorRequest,
    tarsId: string,
    userId: string,
    conversationId: string,
    input: TarsChatMirrorInput & { model: string | null },
  ): Promise<string | null> => {
    const tarsConversationId =
      input.existingTarsConversationId ||
      (await deps.getConvo(userId, conversationId))?.tarsConversationId;
    if (tarsConversationId) {
      // An adopted conversation was named by whoever created it — a long-term-memory
      // upload names it `長期記憶對話_MMDD` — so push LibreChat's title once it exists.
      // Deduplicated inside, so this is one request per conversation, not per turn.
      if (input.title) {
        await syncTarsConversationName(tarsId, tarsConversationId, input.title);
      }
      return tarsConversationId;
    }
    return createTarsConversation(tarsId, {
      name: input.title || 'New Chat',
      domainId: input.domainId,
      modelName: input.model,
      systemInstruction: req.body?.promptPrefix ?? null,
    });
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
        textOf(modelParameters?.model) ||
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
      if (!isTarsConfigured() || !tarsId || !userId || !conversationId || !query) {
        return;
      }

      const tarsConversationId = await linkConversation(req, tarsId, userId, conversationId, {
        ...input,
        model,
      });
      if (!tarsConversationId) {
        return;
      }
      // Always re-assert the mapping: the agent's per-turn convo save wipes it, so without
      // re-saving each turn the next turn would create a duplicate pwc_tars conversation.
      await deps.saveConvo(
        { userId },
        { conversationId, tarsConversationId },
        { context: 'api/server/services/Tars/mirror.js - link pwc_tars conversation' },
      );

      const startedAt =
        typeof req.turnStartedAt === 'number' && Number.isFinite(req.turnStartedAt)
          ? req.turnStartedAt
          : undefined;
      // A failed turn the provider reported no usage for was refused before any
      // output (a 400 on a bad parameter or input), so it billed nothing: no
      // estimate stands in, as pwc_tars records 0 for its own such messages.
      const turnUsage = resolveTarsUsage(
        turn.usage,
        status === TARS_MESSAGE_STATUS.failed ? null : input.tokenEstimate,
      );
      const toolUsage = getTarsToolUsage(req);
      await createTarsMessage(tarsId, {
        conversationId: tarsConversationId,
        messageId: input.messageId,
        query,
        modelName: model,
        ipAddr: req.ip,
        ...buildTarsTurnFields(turn),
        ...sumTarsUsage([...turnUsage, ...toolUsage.values()]),
        responseLatency: startedAt ? (finishedAt - startedAt) / 1000 : undefined,
        history: await loadHistory(req, conversationId),
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
          toolAuditTrace: getTarsToolAuditTrace(req),
          failedToolCalls,
          toolUsage,
          attachments: input.attachments,
        }),
      });
    } catch (error) {
      logger.error('[mirrorChatToTars] Failed to mirror conversation to pwc_tars', error);
    }
  };
}
