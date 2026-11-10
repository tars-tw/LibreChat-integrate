import { logger } from '@librechat/data-schemas';
import {
  Tools,
  Constants,
  Permissions,
  PermissionTypes,
  tarsConfigSchema,
} from 'librechat-data-provider';
import type {
  TAttachment,
  TTarsMemory,
  TTarsMemoryRecall,
  TTarsMemoryAssistConfig,
} from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { TurnConversationRequest } from '~/conversations/save';
import type { CheckAccessParams } from '~/middleware/access';
import type { TarsHistoryMessage } from './plugins/context';
import { TarsRequestError, isTarsConfigured, tarsErrorReply, tarsFetch } from './client';
import { resolveLangflowModelName } from './langflow/client';
import { isTemporaryTurn } from '~/conversations/retention';
import { getTarsSysConfigValue } from './sysconfig';
import { checkAccess } from '~/middleware/access';

const MEMORY_DEFAULTS: TTarsMemoryAssistConfig = tarsConfigSchema.parse({}).memoryAssist;

/** A memory record's id: pwc_tars's 64-bit Milvus primary key, as a decimal string. */
const MEMORY_ID_PATTERN = /^\d+$/;

/** pwc_tars's `X-TARS-Domain-Id`: the brain a memory call's embedding usage counts for. */
const DOMAIN_HEADER = 'X-TARS-Domain-Id';

/** Where the recalled memory sits in the agent's per-turn instructions. */
const MEMORY_CONTEXT_KEY = 'tars_user_memory';

interface TarsEnvelope<T> {
  data?: T;
}

const domainHeaders = (domainId?: string | null): Record<string, string> | undefined =>
  domainId ? { [DOMAIN_HEADER]: domainId } : undefined;

/** Whether pwc_tars serves this deployment's personal memory (`tars.memoryAssist.enabled`). */
export function isTarsMemoryEnabled(tarsConfig?: {
  memoryAssist?: Partial<TTarsMemoryAssistConfig>;
}): boolean {
  return isTarsConfigured() && (tarsConfig?.memoryAssist?.enabled ?? MEMORY_DEFAULTS.enabled);
}

/** pwc_tars's own kill switch; empty or unreadable leaves the decision to its built-in default. */
const MEMORY_DISABLED_VALUES = new Set(['false', '0', 'no', 'off']);

async function isTarsMemoryDisabledByAdmin(): Promise<boolean> {
  const value = await getTarsSysConfigValue('MEMORY_ASSIST_ENABLED');
  return MEMORY_DISABLED_VALUES.has((value ?? '').trim().toLowerCase());
}

/** How often an open memory panel re-reads the list (`tars.memoryAssist.panelRefreshMs`). */
export function getTarsMemoryRefreshMs(tarsConfig?: {
  memoryAssist?: Partial<TTarsMemoryAssistConfig>;
}): number {
  return tarsConfig?.memoryAssist?.panelRefreshMs ?? MEMORY_DEFAULTS.panelRefreshMs;
}

/** Lists a user's memories, newest first. A store failure throws rather than reading as empty. */
async function listTarsMemories(tarsId: string): Promise<TTarsMemory[]> {
  const reply = await tarsFetch<TarsEnvelope<TTarsMemory[]>>('/api/memory/memories', {
    asUser: tarsId,
  });
  return reply.data ?? [];
}

/** Deletes all of the user's memory, their profile included. */
async function clearTarsMemories(tarsId: string): Promise<void> {
  await tarsFetch('/api/memory/memories', { method: 'DELETE', asUser: tarsId });
}

/** Adds the user's own lines to their profile, creating it when they have none. */
async function createTarsMemory(tarsId: string, content: string): Promise<TTarsMemory | undefined> {
  const reply = await tarsFetch<TarsEnvelope<TTarsMemory>>('/api/memory/memories', {
    method: 'POST',
    body: { content },
    asUser: tarsId,
  });
  return reply.data;
}

/** Edits one record. pwc_tars re-embeds it under a new id, which the returned record carries. */
async function updateTarsMemory(
  tarsId: string,
  id: string,
  content: string,
): Promise<TTarsMemory | undefined> {
  const reply = await tarsFetch<TarsEnvelope<TTarsMemory>>(`/api/memory/memories/${id}`, {
    method: 'PUT',
    body: { content },
    asUser: tarsId,
  });
  return reply.data;
}

async function deleteTarsMemory(tarsId: string, id: string): Promise<void> {
  await tarsFetch(`/api/memory/memories/${id}`, { method: 'DELETE', asUser: tarsId });
}

/** pwc_tars's cap on one `delete_by_conversation` request. */
const MEMORY_DELETE_BATCH = 200;

/**
 * Deletes what deleted conversations left in the user's semantic memory, in any memory
 * mode: the user asked for the conversation to be gone, and turning memory off does not
 * withdraw that. Their profile is user-level, so it stays. Best-effort like the mirror's
 * own delete, so the conversation is gone either way; never rejects.
 */
export async function deleteTarsConversationMemories(
  tarsId: string | null | undefined,
  conversationIds: readonly string[] | null | undefined,
): Promise<void> {
  try {
    const ids = [...new Set((conversationIds ?? []).filter(Boolean))];
    if (!isTarsConfigured() || !tarsId || ids.length === 0) {
      return;
    }
    for (let start = 0; start < ids.length; start += MEMORY_DELETE_BATCH) {
      await tarsFetch('/api/memory/memories/delete_by_conversation', {
        method: 'POST',
        body: { conversation_ids: ids.slice(start, start + MEMORY_DELETE_BATCH) },
        asUser: tarsId,
      });
    }
  } catch (error) {
    logger.warn('[tars-memory] Could not delete the memories of deleted conversations', error);
  }
}

/** The user fields that decide whether their memory takes part in a turn. */
export interface TarsMemoryUser {
  id?: string;
  tarsId?: string | null;
  role?: string | null;
  personalization?: { memories?: boolean; memoryAutoUpdate?: boolean } | null;
}

export interface TarsMemoryAccessDeps {
  getRoleByName?: CheckAccessParams['getRoleByName'];
}

/** The request fields that tell a temporary chat apart (see `isTemporaryTurn`). */
export interface TarsTemporaryTurnFields
  extends Pick<TurnConversationRequest, 'resolvedConversation' | '_agentEventBindingRetention'> {
  body?: { isTemporary?: boolean } | null;
  config?: TurnConversationRequest['config'] | null;
}

/**
 * A temporary chat never reaches memory. Judged like the conversation writes are, from the
 * stored conversation and a forced retention as well as the client's flag, so a stored
 * temporary chat continued without the flag still stays out.
 */
function isTemporaryChat(req: TarsTemporaryTurnFields): boolean {
  return isTemporaryTurn({
    body: { isTemporary: req.body?.isTemporary },
    config: req.config ?? undefined,
    resolvedConversation: req.resolvedConversation,
    _agentEventBindingRetention: req._agentEventBindingRetention,
  });
}

export interface TarsMemoryRequest extends TarsTemporaryTurnFields {
  user?: TarsMemoryUser | null;
  body?: {
    text?: unknown;
    domain_id?: string | null;
    isTemporary?: boolean;
    compact?: boolean;
  } | null;
}

/**
 * Whether this user's memory takes part: linked to pwc_tars, not opted out in their
 * preferences (`personalization.memories`), and holding the role's `MEMORIES.USE`.
 * With no role lookup to consult, the answer is no.
 */
async function canUseTarsMemory(
  user: TarsMemoryUser | null | undefined,
  config: Partial<TTarsMemoryAssistConfig> | undefined,
  { getRoleByName }: TarsMemoryAccessDeps,
): Promise<boolean> {
  const enabled = isTarsMemoryEnabled({ memoryAssist: config });
  if (!enabled || !user?.tarsId || user.personalization?.memories === false || !getRoleByName) {
    return false;
  }
  return checkAccess({
    user: user as CheckAccessParams['user'],
    permissionType: PermissionTypes.MEMORIES,
    permissions: [Permissions.USE],
    getRoleByName,
  });
}

export interface TarsMemoryContextSource extends TarsMemoryAccessDeps {
  conversationId?: string | null;
  config?: Partial<TTarsMemoryAssistConfig>;
}

/**
 * Told to the model in manual upkeep, so it does not answer "I'll remember that" for
 * something nothing will save.
 */
const MANUAL_UPKEEP_NOTE =
  'The user maintains this memory by hand, so nothing said in chat is saved to it. If they ' +
  'ask you to remember or forget something, tell them and point them to the Personal memory ' +
  'panel instead of claiming it was done.';

interface TarsRecallRecord {
  id?: string;
  item_count?: number;
  memory_type?: string | null;
  score?: number | string | null;
  content?: string | null;
  created_at?: string | null;
}

/** pwc_tars's `memory_context` audit row, which its audit report shows as 使用者記憶. */
export interface TarsMemoryAudit {
  context_available: boolean;
  retrieval_ms: number | null;
  records: Pick<TarsRecallRecord, 'memory_type' | 'score' | 'content' | 'created_at'>[];
}

interface TarsMemoryRecallResult {
  context: string | null;
  recall: TTarsMemoryRecall | null;
  /** Null when no recall was tried, so the audit report reads "not triggered". */
  audit: TarsMemoryAudit | null;
}

const NO_RECALL: TarsMemoryRecallResult = { context: null, recall: null, audit: null };

function toRecall(records: TarsRecallRecord[]): TTarsMemoryRecall | null {
  const known = records.filter((record) => record?.id);
  if (known.length === 0) {
    return null;
  }
  return {
    ids: known.map((record) => String(record.id)),
    count: known.reduce((sum, record) => sum + (record.item_count ?? 1), 0),
  };
}

async function fetchTarsMemoryRecall(
  req: TarsMemoryRequest,
  { conversationId, config, getRoleByName }: TarsMemoryContextSource,
): Promise<TarsMemoryRecallResult> {
  const query = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  /** No `text` is an API caller (the LLM gateway, `/v1`), which runs on someone else's prompt. */
  if (!query || req.body?.compact === true || isTemporaryChat(req)) {
    return NO_RECALL;
  }
  const note = req.user?.personalization?.memoryAutoUpdate === false ? MANUAL_UPKEEP_NOTE : null;
  try {
    if (!(await canUseTarsMemory(req.user, config, { getRoleByName }))) {
      return NO_RECALL;
    }
    const reply = await tarsFetch<
      TarsEnvelope<{
        memory_context?: string;
        records?: TarsRecallRecord[];
        retrieval_ms?: number | null;
      }>
    >('/api/memory/context', {
      method: 'POST',
      body: {
        query,
        conversation_id:
          conversationId && conversationId !== Constants.NEW_CONVO ? conversationId : undefined,
      },
      headers: domainHeaders(req.body?.domain_id),
      timeoutMs: config?.contextTimeoutMs ?? MEMORY_DEFAULTS.contextTimeoutMs,
      asUser: req.user?.tarsId ?? undefined,
    });
    const recalled = reply.data?.memory_context?.trim() || null;
    /** A malformed `records` costs the reply its recall line, never the context itself. */
    const records = Array.isArray(reply.data?.records) ? reply.data.records : [];
    return {
      context: [recalled, note].filter(Boolean).join('\n\n') || null,
      recall: recalled ? toRecall(records) : null,
      audit: {
        context_available: recalled != null,
        retrieval_ms: reply.data?.retrieval_ms ?? null,
        records: records.map(({ memory_type, score, content, created_at }) => ({
          memory_type,
          score,
          content,
          created_at,
        })),
      },
    };
  } catch (error) {
    logger.warn('[tars-memory] Recall failed; the turn goes on without memory', error);
    return {
      context: note,
      recall: null,
      audit: { context_available: false, retrieval_ms: null, records: [] },
    };
  }
}

const recallByRequest = new WeakMap<object, Promise<TarsMemoryRecallResult>>();

/**
 * Recalls the user's memory for this turn, once per request (handoff agents share it).
 * Memory only assists a turn, so any failure leaves the turn without it.
 */
export async function primeTarsMemoryContext(
  req: TarsMemoryRequest,
  source: TarsMemoryContextSource,
): Promise<string | null> {
  const recall = recallByRequest.get(req) ?? fetchTarsMemoryRecall(req, source);
  recallByRequest.set(req, recall);
  return (await recall).context;
}

/**
 * The attachment recording what this reply could refer to, for the message it answers
 * with; null on a turn that recalled nothing. Does not start a recall of its own.
 */
export async function getTarsMemoryAttachment(
  req: object,
  ids: { messageId?: string; conversationId?: string | null },
): Promise<Partial<TAttachment> | null> {
  const recall = (await recallByRequest.get(req))?.recall;
  if (!recall) {
    return null;
  }
  return {
    type: Tools.tars_memory,
    messageId: ids.messageId,
    conversationId: ids.conversationId ?? undefined,
    [Tools.tars_memory]: recall,
  } as Partial<TAttachment>;
}

/**
 * What this turn recalled, for the mirrored audit trace. Unlike the message's attachment
 * this holds the text: the audit report records what the model was given, as pwc_tars
 * does for its own chat, and is only open to those who may read audits.
 */
export async function getTarsMemoryAudit(req: object): Promise<TarsMemoryAudit | null> {
  return (await recallByRequest.get(req))?.audit ?? null;
}

/**
 * Puts the recalled memory into the agent's per-turn instructions
 * (`dynamicToolContextMap`, which summarization never compacts). pwc_tars's text
 * already tells the model how far to trust it.
 */
export function addTarsMemoryContext(
  agent: { dynamicToolContextMap?: Record<string, unknown> },
  context: string | null | undefined,
): void {
  if (!context) {
    return;
  }
  agent.dynamicToolContextMap ??= {};
  agent.dynamicToolContextMap[MEMORY_CONTEXT_KEY] = `# User memory Runtime Context\n${context}`;
}

/**
 * Holds the recalled memory to the deployment's memory content policy (`filters.memories`),
 * as native memory is held. A refused memory is dropped rather than failing the turn: memory
 * only assists, and a refused line would otherwise fail every turn that recalls it. Only the
 * error's name is logged, since the finding can quote the refused text.
 */
export function enforceTarsMemoryPolicy(
  agent: { dynamicToolContextMap?: Record<string, unknown> },
  inspectMemories: (memories: string[]) => void,
): void {
  const contextMap = agent.dynamicToolContextMap;
  const context = contextMap?.[MEMORY_CONTEXT_KEY];
  if (!contextMap || typeof context !== 'string') {
    return;
  }
  try {
    inspectMemories([context]);
  } catch (error) {
    delete contextMap[MEMORY_CONTEXT_KEY];
    logger.warn(
      `[tars-memory] The content policy refused the recalled memory (${
        error instanceof Error ? error.name : 'unknown'
      }); the turn goes on without it`,
    );
  }
}

export interface TarsMemoryUpdateInput extends TarsMemoryAccessDeps {
  conversationId: string;
  query: string;
  response: string;
  history: TarsHistoryMessage[];
  model?: string | null;
  messageId?: string | null;
  domainId?: string | null;
  config?: Partial<TTarsMemoryAssistConfig>;
}

/**
 * Asks pwc_tars to learn from a finished turn. It extracts in the background and may
 * skip the work under load, so this only hands the turn over. Never rejects.
 */
export async function scheduleTarsMemoryUpdate(
  req: TarsTemporaryTurnFields & { user?: TarsMemoryUser | null },
  input: TarsMemoryUpdateInput,
): Promise<void> {
  try {
    const { conversationId, query, response, config, getRoleByName } = input;
    /** Manual upkeep: pwc_tars is never asked, so the AI cannot add to or rewrite the memory. */
    if (!query || !response.trim() || req.user?.personalization?.memoryAutoUpdate === false) {
      return;
    }
    if (isTemporaryChat(req)) {
      return;
    }
    if (!(await canUseTarsMemory(req.user, config, { getRoleByName }))) {
      return;
    }
    await tarsFetch('/api/memory/update', {
      method: 'POST',
      body: {
        conversation_id: conversationId,
        query,
        response,
        history: input.history,
        message_id: input.messageId ?? undefined,
        /** An unmatched model is left out, so pwc_tars extracts on its default. */
        model_name: await resolveLangflowModelName(input.model ?? undefined, 'tars-memory'),
      },
      headers: domainHeaders(input.domainId),
      asUser: req.user?.tarsId ?? undefined,
    });
  } catch (error) {
    logger.warn('[tars-memory] Could not schedule the memory update', error);
  }
}

/**
 * The status a route answers a memory failure with. A 404 means the record's id is
 * stale, since each edit and each background profile rewrite replaces it; a 503 means
 * the store is warming up, busy or down, which the panel tells apart from a bug.
 */
function replyWithError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof TarsRequestError && error.status === 503) {
    res.status(503).json({ error: error.serverMessage ?? fallback });
    return;
  }
  const { status, error: message } = tarsErrorReply(error, fallback);
  res.status(status).json({ error: message });
}

type MemoryRequest = Request & {
  user?: TarsMemoryUser;
  /** The resolved app config, for `tars.memoryAssist.enabled`; absent reads as the default. */
  config?: { config?: { tars?: { memoryAssist?: Partial<TTarsMemoryAssistConfig> } } };
};
type MemoryHandler = (req: MemoryRequest, res: Response) => Promise<void>;

/**
 * Runs a handler for a linked account where personal memory serves the deployment: with
 * `tars.memoryAssist.enabled` off the API is gone along with the panel. An unlinked account
 * has no memory to reach.
 */
const forLinkedUser =
  (
    fallback: string,
    run: (tarsId: string, req: MemoryRequest, res: Response) => Promise<void>,
  ): MemoryHandler =>
  async (req, res) => {
    if (!isTarsMemoryEnabled(req.config?.config?.tars)) {
      res.status(404).json({ error: 'Personal memory is not enabled.' });
      return;
    }
    const tarsId = req.user?.tarsId;
    if (!tarsId) {
      res.status(403).json({ error: 'This account is not linked to pwc_tars.' });
      return;
    }
    try {
      await run(tarsId, req, res);
    } catch (error) {
      logger.error(`[tars-memory] ${fallback}`, error);
      replyWithError(res, error, fallback);
    }
  };

const requiredContent = (req: MemoryRequest, res: Response): string | null => {
  const content: unknown = req.body?.content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }
  res.status(400).json({ error: 'content is required.' });
  return null;
};

const validId = (req: MemoryRequest, res: Response): string | null => {
  const { id } = req.params;
  if (MEMORY_ID_PATTERN.test(id)) {
    return id;
  }
  res.status(400).json({ error: 'Invalid memory id.' });
  return null;
};

export interface TarsMemoryHandlerDeps {
  /** Stores the user's choice; null when the user no longer exists. */
  updateMemoryAutoUpdate: (userId: string, autoUpdate: boolean) => Promise<object | null>;
}

/** The `/api/tars/memory` handlers. pwc_tars scopes every call to the signed user. */
export function createTarsMemoryHandlers({ updateMemoryAutoUpdate }: TarsMemoryHandlerDeps): {
  list: MemoryHandler;
  clear: MemoryHandler;
  create: MemoryHandler;
  update: MemoryHandler;
  remove: MemoryHandler;
  preferences: MemoryHandler;
} {
  return {
    preferences: forLinkedUser('Failed to update the preference', async (_tarsId, req, res) => {
      const autoUpdate: unknown = req.body?.memoryAutoUpdate;
      if (typeof autoUpdate !== 'boolean') {
        res.status(400).json({ error: 'memoryAutoUpdate must be a boolean.' });
        return;
      }
      const updated = await updateMemoryAutoUpdate(String(req.user?.id), autoUpdate);
      if (!updated) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      res.json({ preferences: { memoryAutoUpdate: autoUpdate } });
    }),
    list: forLinkedUser('Failed to list memories', async (tarsId, _req, res) => {
      if (await isTarsMemoryDisabledByAdmin()) {
        res.json({ memories: [], disabled: true });
        return;
      }
      res.json({ memories: await listTarsMemories(tarsId) });
    }),
    clear: forLinkedUser('Failed to clear the memories', async (tarsId, _req, res) => {
      await clearTarsMemories(tarsId);
      res.json({ cleared: true });
    }),
    create: forLinkedUser('Failed to add the memory', async (tarsId, req, res) => {
      const content = requiredContent(req, res);
      if (content == null) {
        return;
      }
      const memory = await createTarsMemory(tarsId, content);
      res.status(201).json({ memory });
    }),
    update: forLinkedUser('Failed to update the memory', async (tarsId, req, res) => {
      const id = validId(req, res);
      if (id == null) {
        return;
      }
      const content = requiredContent(req, res);
      if (content == null) {
        return;
      }
      res.json({ memory: await updateTarsMemory(tarsId, id, content) });
    }),
    remove: forLinkedUser('Failed to delete the memory', async (tarsId, req, res) => {
      const id = validId(req, res);
      if (id == null) {
        return;
      }
      await deleteTarsMemory(tarsId, id);
      res.json({ id });
    }),
  };
}
