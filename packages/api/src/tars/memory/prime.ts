import { logger } from '@librechat/data-schemas';
import type { TarsMemoryDocument } from './client';
import { listTarsMemoryDocuments } from './client';
import { isTarsConfigured } from '~/tars/client';

/**
 * Mirrors pwc_tars's own chat behavior: only `status=1` rows participate, the
 * whole extracted text of non-structured files goes into the prompt, and
 * structured files (csv/xlsx/xls) are exposed through the data tools instead.
 * The char cap is a safety valve — pwc_tars already enforces its ~192k-token
 * memory budget at upload time, but its model pool is narrower than LibreChat's.
 */
const DEFAULT_CONTEXT_MAX_CHARS = 400_000;
/** Priming must never hold up the turn; the memory block is best-effort. */
const PRIME_TIMEOUT_MS = 10_000;
/**
 * Share of the turn's context window the memory block may occupy, and the
 * conservative chars-per-token ratio used to convert it. CJK runs near 1
 * char/token, so 2 keeps the estimate on the safe side of a hard 400 from a
 * small local model.
 */
const CONTEXT_WINDOW_FRACTION = 0.5;
const CHARS_PER_TOKEN = 2;

export interface TarsMemorySnapshot {
  tarsConversationId: string;
  /** status=1 documents, structured and not. */
  activeDocuments: TarsMemoryDocument[];
  /** The subset the data/table-task tools may query. */
  structuredDocuments: TarsMemoryDocument[];
}

export interface TarsMemoryContext {
  /** System-prompt block carrying the non-structured files' extracted text. */
  contextText: string | null;
  /** Runtime-context block listing the structured files for the data tools. */
  dataContextText: string | null;
}

interface MemoryPrimeRequest {
  user?: { tarsId?: string | null };
  tarsConversationId?: string;
}

const snapshotByRequest = new WeakMap<object, TarsMemorySnapshot>();
const primeByRequest = new WeakMap<object, Promise<TarsMemorySnapshot | null>>();

/** The snapshot `primeTarsMemory` stashed for this request, if any. */
export function getTarsMemorySnapshot(req: object): TarsMemorySnapshot | undefined {
  return snapshotByRequest.get(req);
}

/**
 * Char budget for the injected memory block: the configured ceiling, further
 * clamped to a fraction of the model's own context window. The unclamped
 * default is far larger than a 32k local model can accept, and the block is
 * part of the system prompt, so LibreChat's message-level truncation never
 * gets a chance to rescue it.
 */
function contextMaxChars(maxContextTokens?: number): number {
  const raw = Number(process.env.TARS_MEMORY_CONTEXT_MAX_CHARS);
  const configured = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONTEXT_MAX_CHARS;
  if (maxContextTokens == null || !Number.isFinite(maxContextTokens) || maxContextTokens <= 0) {
    return configured;
  }
  return Math.min(
    configured,
    Math.floor(maxContextTokens * CONTEXT_WINDOW_FRACTION * CHARS_PER_TOKEN),
  );
}

/**
 * Proportional truncation: every file keeps the same fraction of its text so a
 * single huge file cannot evict the others entirely.
 */
function buildContextText(documents: TarsMemoryDocument[], maxChars: number): string | null {
  const textual = documents.filter((doc) => !doc.structured && (doc.summary ?? '').trim() !== '');
  if (!textual.length) {
    return null;
  }
  const totalChars = textual.reduce((sum, doc) => sum + (doc.summary as string).length, 0);
  const ratio = totalChars > maxChars ? maxChars / totalChars : 1;
  const sections = textual.map((doc) => {
    const summary = doc.summary as string;
    const body =
      ratio < 1
        ? `${summary.slice(0, Math.max(1, Math.floor(summary.length * ratio)))}\n[truncated]`
        : summary;
    return `## ${doc.filename}\n${body}`;
  });
  return (
    '# 長期記憶 (Long-term Memory)\n' +
    'The user attached these files to this conversation. Their extracted contents follow — ' +
    'treat them as part of the conversation context and answer from them when relevant.\n\n' +
    sections.join('\n\n')
  );
}

function buildDataContextText(documents: TarsMemoryDocument[]): string | null {
  if (!documents.length) {
    return null;
  }
  const lines = documents.map((doc) => `- ${doc.filename} (document_id: ${doc.id})`);
  return (
    '# `data_query` / `table_task` Runtime Context\n' +
    'Structured spreadsheet files attached to this conversation. Ask ad-hoc questions about ' +
    'their contents with `data_query`; apply an instruction to every row with `table_task`. ' +
    'By default both tools read all of the files below:\n' +
    lines.join('\n')
  );
}

/**
 * The system-prompt blocks for a primed snapshot. Split from `primeTarsMemory`
 * because the truncation budget depends on the model's context window, which is
 * only resolved after the agent's provider config is built.
 */
export function buildTarsMemoryContext(
  snapshot: TarsMemorySnapshot | null | undefined,
  maxContextTokens?: number,
): TarsMemoryContext {
  if (snapshot == null) {
    return { contextText: null, dataContextText: null };
  }
  return {
    contextText: buildContextText(snapshot.activeDocuments, contextMaxChars(maxContextTokens)),
    dataContextText: buildDataContextText(snapshot.structuredDocuments),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function loadTarsMemory(req: MemoryPrimeRequest): Promise<TarsMemorySnapshot | null> {
  const tarsUserId = req.user?.tarsId;
  const tarsConversationId = req.tarsConversationId;
  if (!isTarsConfigured() || !tarsUserId || !tarsConversationId) {
    return null;
  }
  try {
    const list = await withTimeout(
      listTarsMemoryDocuments(tarsUserId, tarsConversationId),
      PRIME_TIMEOUT_MS,
    );
    const activeDocuments = list.documents.filter((doc) => doc.status === 1);
    const snapshot: TarsMemorySnapshot = {
      tarsConversationId,
      activeDocuments,
      structuredDocuments: activeDocuments.filter((doc) => doc.structured),
    };
    snapshotByRequest.set(req, snapshot);
    return snapshot;
  } catch (error) {
    logger.warn(
      `[tars-memory] Failed to prime long-term memory for tars conversation ${tarsConversationId}`,
      error,
    );
    return null;
  }
}

/**
 * Loads the conversation's active long-term memory once per turn. Fail-soft by
 * design: pwc_tars being slow or down degrades to "no memory this turn", never
 * to a failed chat request. The snapshot is stashed on the request so the tool
 * factories reuse it without a second round trip.
 *
 * The in-flight promise is memoized on the request too: one turn initializes an
 * agent per node of a handoff/subagent graph, and each would otherwise re-fetch
 * the same listing.
 *
 * The conversation id is read only from `req.tarsConversationId`, which the
 * controllers set from the verified mapping — never from the request body,
 * which is client-supplied.
 */
export function primeTarsMemory(req: MemoryPrimeRequest): Promise<TarsMemorySnapshot | null> {
  const inflight = primeByRequest.get(req);
  if (inflight != null) {
    return inflight;
  }
  const promise = loadTarsMemory(req);
  primeByRequest.set(req, promise);
  return promise;
}
