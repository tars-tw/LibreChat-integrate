import { randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import { isEphemeralAgentId, stripAgentIdSuffix } from 'librechat-data-provider';
import type { UsageMetadata } from '~/stream/interfaces/IJobStore';
import type { TarsTemporaryTurnFields } from './memory';
import type { TarsTraceUsage } from './trace';
import { hasRecordedPrimaryUsage, hasRecordedProviderUsage } from '~/agents/usage';
import { isTarsConfigured, tarsFetch } from './client';
import { withTarsVertexUsageModel } from './vertex';
import { takeTarsToolUsage } from './tools/usage';
import { isTemporaryChat } from './memory';
import { deferTarsWrite } from './outbox';
import { sumTarsUsage } from './trace';

/** pwc_tars `token_usage_log.ref_type` of a usage report. */
export type TarsUsageRefType = 'chat' | 'title' | 'activity_label' | 'subagent' | 'compaction';

/**
 * `AgentClient.recordCollectedUsage` contexts the chat mirror never carries, by the `ref_type`
 * pwc_tars logs them under. They are billed apart from the turn's `collectedUsage`, often after
 * it was mirrored. Detached subagents bill elsewhere (see {@link withTarsDetachedUsageReport}).
 */
const SIDE_REF_TYPES: Readonly<Record<string, TarsUsageRefType>> = {
  title: 'title',
  'activity-label': 'activity_label',
  'activity-phase': 'activity_label',
  'reasoning-label': 'activity_label',
};

/**
 * The LibreChat agent pwc_tars records usage under (`token_usage_log.agent_id`), now that
 * agents stand in for 專用腦; null for an agent that was never saved. Strips parallel-run
 * suffixes (`____N`) and skips ephemeral placeholders so a later saved candidate still matches.
 */
export function savedTarsAgentId(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') {
      continue;
    }
    const baseId = stripAgentIdSuffix(candidate);
    if (!isEphemeralAgentId(baseId)) {
      return baseId;
    }
  }
  return null;
}

export interface TarsUsageReport {
  refType: TarsUsageRefType;
  /** The saved LibreChat agent the usage ran for. */
  agentId?: string | null;
  /** The response message the usage belongs to (the mirrored message's id). */
  messageId?: string | null;
  /** LibreChat's conversation id; pwc_tars swaps in its own once the message exists. */
  conversationId?: string | null;
  model?: string | null;
  domainId?: string | null;
  /** The report's idempotency key; a new one when absent. */
  requestId?: string | null;
  usage: TarsTraceUsage[];
}

/** The body of pwc_tars `POST /api/message/record_usage`. */
export interface TarsUsageReportBody {
  ref_type: TarsUsageRefType;
  message_id: string;
  conversation_id: string | null;
  model_name: string | null;
  domain_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  /** Idempotency key: a retry that already landed changes nothing in pwc_tars. */
  request_id: string;
  agent_id?: string;
}

/** One usage report as it is sent, and kept for a retry when sending fails. */
export interface TarsUsageDelivery {
  tarsId: string;
  body: TarsUsageReportBody;
}

/** Sends one usage report; throws as `tarsFetch` does. */
export async function deliverTarsUsageReport(
  delivery: TarsUsageDelivery,
  baseUrl?: string,
): Promise<void> {
  await tarsFetch('/api/message/record_usage', {
    method: 'POST',
    body: delivery.body,
    asUser: delivery.tarsId,
    baseUrl,
  });
}

/**
 * Logs usage the chat mirror does not carry in pwc_tars (`POST /api/message/record_usage`), as
 * the user `tarsId` names, and adds it to the message's totals. pwc_tars accepts a report from
 * before the message is mirrored and adds it when the message is created. A report that fails
 * for a reason worth retrying is kept and sent again later; its `request_id` keeps pwc_tars
 * from counting it twice. Never throws.
 */
export async function reportTarsUsage(
  tarsId: string | null | undefined,
  report: TarsUsageReport | null | undefined,
  baseUrl?: string,
): Promise<void> {
  try {
    if (!report || !isTarsConfigured(baseUrl) || !tarsId || !report.messageId) {
      return;
    }
    const { messageTokens, responseTokens } = sumTarsUsage(report.usage);
    if (messageTokens <= 0 && responseTokens <= 0) {
      return;
    }
    const delivery: TarsUsageDelivery = {
      tarsId,
      body: {
        ref_type: report.refType,
        message_id: report.messageId,
        conversation_id: report.conversationId ?? null,
        model_name: report.model || null,
        domain_id: report.domainId ?? null,
        prompt_tokens: messageTokens,
        completion_tokens: responseTokens,
        request_id: report.requestId || randomUUID(),
        ...(report.agentId && { agent_id: report.agentId }),
      },
    };
    try {
      await deliverTarsUsageReport(delivery, baseUrl);
    } catch (error) {
      if (!(await deferTarsWrite('usage', delivery, error))) {
        logger.warn(
          `[tars-usage] Could not report ${report.refType} usage of message ${report.messageId} to pwc_tars`,
          error,
        );
      }
    }
  } catch (error) {
    logger.warn('[tars-usage] Could not prepare usage report for pwc_tars', error);
  }
}

/**
 * The pwc_tars tool usage of the turn `turn` names, for the mirror or report that carries it.
 * A tool still running then (a background call, a detached subagent's) records its tokens
 * afterwards; each is reported on its own as the turn's `chat` usage, since pwc_tars, told
 * LibreChat records them (`X-TARS-Usage-Owner: caller`), logs none of them itself.
 */
export function takeTarsTurnToolUsage(
  req: object | null | undefined,
  tarsId: string,
  turn: Omit<TarsUsageReport, 'refType' | 'usage' | 'requestId'>,
): Map<string, TarsTraceUsage> {
  return takeTarsToolUsage(req, (usage) => {
    void reportTarsUsage(tarsId, { ...turn, refType: 'chat', usage: [usage] });
  });
}

/** The request fields a usage report reads. */
export interface TarsUsageRequest extends TarsTemporaryTurnFields {
  user?: { tarsId?: string | null } | null;
  body?: {
    isTemporary?: boolean;
    compact?: boolean;
    domain_id?: string | null;
    agent_id?: string | null;
  } | null;
  /** Resume requests restore the conversation here rather than carrying `domain_id` in `body`. */
  resolvedConversation?:
    | (TarsTemporaryTurnFields['resolvedConversation'] & {
        domain_id?: string | null;
      })
    | null;
}

/** The agent a usage report names, as `client.options.agent` holds it. */
export interface TarsUsageAgent {
  id?: string | null;
  model_parameters?: Record<string, unknown> | null;
}

/** The `AgentClient` fields a usage report reads. */
export interface TarsUsageClient {
  options?: {
    req?: TarsUsageRequest | null;
    agent?: TarsUsageAgent | null;
  } | null;
  conversationId?: string | null;
  responseMessageId?: string | null;
  model?: string | null;
  /** Set when the run paused for human review (see `AgentClient.handleRunInterrupt`). */
  pendingApproval?: unknown;
  /** Set when an Event Actor run staged a pause before `publishStagedApproval` sets `pendingApproval`. */
  stagedApproval?: unknown;
  /** Non-null during an Event Actor invocation, which delays `pendingApproval` past `chatCompletion`. */
  eventActorInvocationId?: string | null;
  /** Set by the resume route on the client that continues a paused turn. */
  tarsResumedSegment?: boolean;
}

/** The model under its pwc_tars profile name, as the chat mirror records it. */
function profileModel(
  agent: TarsUsageAgent | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const parameters = agent?.model_parameters;
  const model =
    parameters != null ? withTarsVertexUsageModel(parameters as { model?: string }).model : null;
  return (typeof model === 'string' && model) || fallback || null;
}

/** The brain and the saved agent a report names, read off the request and its agent. */
function reportScope(
  req: TarsUsageRequest,
  agent: TarsUsageAgent | null | undefined,
): Pick<TarsUsageReport, 'domainId' | 'agentId'> {
  return {
    domainId: req.body?.domain_id ?? req.resolvedConversation?.domain_id,
    agentId: savedTarsAgentId(agent?.id, req.body?.agent_id),
  };
}

/** What a report on the client's turn names, all but its `ref_type` and usage. */
function turnReport(
  client: TarsUsageClient,
  req: TarsUsageRequest,
): Omit<TarsUsageReport, 'refType' | 'usage'> {
  return {
    messageId: client.responseMessageId,
    conversationId: client.conversationId,
    model: profileModel(client.options?.agent, client.model),
    ...reportScope(req, client.options?.agent),
  };
}

/**
 * The `ref_type` of a turn's own usage when no mirrored message carries it; null when one does.
 *
 * - A manual compaction has no query, so it is never mirrored.
 * - A temporary chat is never mirrored, but its tokens are spent all the same.
 * - A turn that paused for human review is not mirrored when it pauses (including an Event Actor
 *   pause whose `stagedApproval` is only promoted to `pendingApproval` after `chatCompletion`),
 *   and its resumed segments run on new clients, so each segment reports its own usage and the
 *   turn is mirrored once, without usage, when it finishes.
 */
function unmirroredRefType(
  client: TarsUsageClient,
  req: TarsUsageRequest,
): TarsUsageRefType | null {
  if (req.body?.compact === true) {
    return 'compaction';
  }
  const eventActorPaused = client.stagedApproval != null && client.eventActorInvocationId != null;
  const pausedSegment =
    client.pendingApproval != null || eventActorPaused || client.tarsResumedSegment === true;
  return pausedSegment || isTemporaryChat(req) ? 'chat' : null;
}

/**
 * Reports what `AgentClient.recordCollectedUsage` just billed when the chat mirror does not
 * carry it: the title, activity and reasoning labels, and the whole of a turn no mirrored
 * message carries (see `unmirroredRefType`), with the pwc_tars tool usage of its request.
 * A mirrored turn's own usage reaches pwc_tars with its message and is skipped. Never throws.
 */
export function reportTarsCollectedUsage(
  client: TarsUsageClient | null | undefined,
  input: {
    context?: string | null;
    collectedUsage?: TarsTraceUsage[] | null;
    model?: string | null;
  },
): Promise<void> | undefined {
  try {
    const req = client?.options?.req;
    if (!client || !req?.user?.tarsId) {
      return undefined;
    }
    const sideRefType = SIDE_REF_TYPES[input.context ?? ''];
    const refType = sideRefType ?? unmirroredRefType(client, req);
    if (refType == null) {
      return undefined;
    }
    const report = turnReport(client, req);
    const usage = [...(input.collectedUsage ?? [])];
    if (sideRefType == null) {
      usage.push(...takeTarsTurnToolUsage(req, req.user.tarsId, report).values());
    }
    return reportTarsUsage(req.user.tarsId, {
      ...report,
      refType,
      model: input.model || report.model,
      usage,
    });
  } catch (error) {
    logger.warn('[tars-usage] Could not report collected usage to pwc_tars', error);
    return undefined;
  }
}

const positive = (value: unknown): number => Math.max(Number(value) || 0, 0);

/**
 * Reports LibreChat's text-count estimate (`AgentClient.recordTokenUsage`) for a turn no mirrored
 * message carries, when its provider reported no usage (e.g. vLLM without
 * `stream_options.include_usage`). It applies upstream's own test (`hasRecordedPrimaryUsage`,
 * `hasRecordedProviderUsage`), so pwc_tars gets an estimate exactly when LibreChat bills one. The
 * request's pwc_tars tool usage already went with `reportTarsCollectedUsage`. A mirrored turn
 * carries its estimate itself (`tokenEstimate`). Never throws.
 */
export function reportTarsFallbackUsage(
  client: TarsUsageClient | null | undefined,
  input: {
    context?: string | null;
    usage?:
      | (Pick<UsageMetadata, 'input_tokens' | 'output_tokens'> & { reasoning_tokens?: number })
      | null;
    collectedUsage?: ReadonlyArray<UsageMetadata | null | undefined> | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
  },
): Promise<void> | undefined {
  try {
    const req = client?.options?.req;
    if (!client || !req?.user?.tarsId) {
      return undefined;
    }
    const refType = SIDE_REF_TYPES[input.context ?? ''] ?? unmirroredRefType(client, req);
    if (
      refType == null ||
      hasRecordedPrimaryUsage(input.collectedUsage) ||
      hasRecordedProviderUsage(input.usage)
    ) {
      return undefined;
    }
    return reportTarsUsage(req.user.tarsId, {
      ...turnReport(client, req),
      refType,
      usage: [
        {
          input_tokens: positive(input.promptTokens),
          output_tokens: positive(input.completionTokens) + positive(input.usage?.reasoning_tokens),
          estimated: true,
        },
      ],
    });
  } catch (error) {
    logger.warn('[tars-usage] Could not report fallback usage to pwc_tars', error);
    return undefined;
  }
}

/**
 * Reports a remote agent API run (`/api/agents/v1/chat/completions`, the Responses API), which
 * no chat mirror carries, as `chat` usage with the tokens its pwc_tars tools returned: LibreChat
 * sends `X-TARS-Usage-Owner: caller` on every tool call, so pwc_tars logs none of them itself.
 * Not for the LLM gateway (`/v1m`), whose calls pwc_tars makes and meters. Never throws.
 */
export function reportTarsApiUsage(
  req: TarsUsageRequest | null | undefined,
  input: {
    messageId?: string | null;
    conversationId?: string | null;
    model?: string | null;
    agent?: TarsUsageAgent | null;
    collectedUsage?: TarsTraceUsage[] | null;
  },
): Promise<void> | undefined {
  try {
    const tarsId = req?.user?.tarsId;
    if (!req || !tarsId) {
      return undefined;
    }
    const turn = {
      messageId: input.messageId,
      conversationId: input.conversationId,
      model: profileModel(input.agent, input.model),
      ...reportScope(req, input.agent),
    };
    return reportTarsUsage(tarsId, {
      ...turn,
      refType: 'chat',
      usage: [
        ...(input.collectedUsage ?? []),
        ...takeTarsTurnToolUsage(req, tarsId, turn).values(),
      ],
    });
  } catch (error) {
    logger.warn('[tars-usage] Could not report API usage to pwc_tars', error);
    return undefined;
  }
}

/**
 * Wraps the billing callback of detached subagent calls so each call is also reported to
 * pwc_tars. Detached children may outlive the turn and its request, so who and what they run
 * for is read now. Returns `record` unchanged when the user is not linked to pwc_tars.
 */
export function withTarsDetachedUsageReport<T extends TarsTraceUsage>(
  client: TarsUsageClient | null | undefined,
  record: (usage: T) => Promise<void>,
): (usage: T) => Promise<void> {
  try {
    const req = client?.options?.req;
    const tarsId = req?.user?.tarsId;
    if (!client || !tarsId) {
      return record;
    }
    const report = turnReport(client, req);
    return (usage) => {
      try {
        void reportTarsUsage(tarsId, {
          ...report,
          refType: 'subagent',
          model: usage?.model || report.model,
          // The child agent's own id when the SDK names it.
          agentId:
            savedTarsAgentId((usage as { agentId?: string | null })?.agentId) ?? report.agentId,
          usage: [usage],
        });
      } catch (error) {
        logger.warn(
          '[tars-usage] Could not prepare detached subagent usage report for pwc_tars',
          error,
        );
      }
      return record(usage);
    };
  } catch (error) {
    logger.warn('[tars-usage] Could not wrap detached subagent usage report for pwc_tars', error);
    return record;
  }
}
