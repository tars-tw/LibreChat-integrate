import { logger } from '@librechat/data-schemas';
import type { TTarsTraceArtifact } from 'librechat-data-provider';
import type { TarsKnowledgeBase } from '~/tars/knowledge';
import {
  langflowTimeoutMs,
  toTarsTraceArtifact,
  runLangflowCapability,
  resolveLangflowModelName,
} from '~/tars/langflow/client';
import {
  listTarsScopedKnowledgeBases,
  invalidateTarsScopedKnowledgeBasesCache,
} from '~/tars/scope';

const RAG_AGENT_PATH = '/api/langflow-service/rag';
/**
 * pwc_tars caps one synchronous RAG turn at 300s, so LibreChat waits a little
 * less and surfaces its own timeout first. Override with
 * `TARS_RAG_AGENT_TIMEOUT_MS`.
 */
const DEFAULT_TIMEOUT_MS = 240_000;

/** A knowledge base the RAG agent may retrieve from. */
export interface TarsRagKnowledgeBase {
  knowledge_base_id: string;
  name: string;
  description: string;
}

export interface TarsRagAgentInput {
  question: string;
  /** Subset of the reachable knowledge bases; empty means all of them. */
  knowledgeBaseIds?: string[];
  /** The active 專用腦, which bounds the knowledge bases this call may reach. */
  domainId?: string | number | null;
  /** The model the chat turn runs on, as LibreChat names it. */
  model?: string;
  /** The account the LLM gateway resolves models and quota for. */
  librechatUserId?: string;
}

export interface TarsRagAgentResult {
  answer: string;
  modelName: string;
  totalTokens: number;
  /** The knowledge bases the run actually searched. */
  knowledgeBaseIds: string[];
  /** The nested run, for the chat to show; absent when pwc_tars sent no trace. */
  trace?: TTarsTraceArtifact;
}

/** Drops the cached per-user knowledge-base scopes so the next call re-reads pwc_tars. */
export function invalidateTarsRagKnowledgeBasesCache(): void {
  invalidateTarsScopedKnowledgeBasesCache();
}

const toRagKnowledgeBase = (base: TarsKnowledgeBase): TarsRagKnowledgeBase => ({
  knowledge_base_id: base.id,
  name: base.name,
  description: base.description ?? '',
});

/**
 * The knowledge bases one turn may retrieve from: what the active 專用腦 binds
 * ({@link listTarsScopedKnowledgeBases}), which is also the authorization set
 * for {@link runTarsRagAgent}. pwc_tars's own chat searches exactly this set.
 */
export async function listTarsRagKnowledgeBases(
  tarsUserId: string,
  domainId?: string | number | null,
): Promise<TarsRagKnowledgeBase[]> {
  const bases = await listTarsScopedKnowledgeBases(tarsUserId, domainId);
  return bases.map(toRagKnowledgeBase);
}

/**
 * The knowledge bases a call may search: the requested subset when every id
 * is reachable, all reachable ones when nothing was requested. A request that
 * names a knowledge base outside the scope is refused as a whole rather than
 * silently narrowed, so the model learns which id was wrong.
 */
export function resolveTarsKnowledgeBaseIds(
  reachable: TarsRagKnowledgeBase[],
  requested: string[] | undefined,
): string[] {
  const ids = (requested ?? []).map((id) => id.trim()).filter(Boolean);
  if (!ids.length) {
    return reachable.map((base) => base.knowledge_base_id);
  }
  const known = new Set(reachable.map((base) => base.knowledge_base_id));
  const foreign = ids.filter((id) => !known.has(id));
  if (foreign.length) {
    throw new Error(
      `Knowledge base "${foreign[0]}" is not bound to the active brain, or this user cannot access it.`,
    );
  }
  return Array.from(new Set(ids));
}

/**
 * Runs one pwc_tars RAG turn over the given knowledge bases
 * (`POST /api/langflow-service/rag`). pwc_tars owns retrieval, reranking and
 * the answer with its source citations; LibreChat only bounds which knowledge
 * bases may be searched and relays the answer.
 */
export async function runTarsRagAgent(
  tarsUserId: string,
  input: TarsRagAgentInput,
): Promise<TarsRagAgentResult> {
  const reachable = await listTarsRagKnowledgeBases(tarsUserId, input.domainId);
  if (!reachable.length) {
    throw new Error('The active brain binds no knowledge base, so there is nothing to search.');
  }
  const knowledgeBaseIds = resolveTarsKnowledgeBaseIds(reachable, input.knowledgeBaseIds);
  const requestedModel = await resolveLangflowModelName(input.model, 'tars-rag');
  const data = await runLangflowCapability(
    RAG_AGENT_PATH,
    {
      query: input.question,
      knowledge_base_ids: knowledgeBaseIds.join(','),
      model_name: requestedModel,
    },
    {
      timeoutMs: langflowTimeoutMs('TARS_RAG_AGENT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
      librechatUserId: input.librechatUserId,
    },
  );

  const answer = data?.answer?.trim();
  if (!answer) {
    logger.warn('[tars-rag] pwc_tars returned an empty RAG answer');
  }
  logger.debug(
    `[tars-rag] kbs=${knowledgeBaseIds.length} requested=${requestedModel ?? '(pwc_tars default)'} ` +
      `used=${data?.model_name ?? '(unreported)'} tokens=${data?.tokens?.total ?? 0} ` +
      'gateway=requested',
  );
  const trace = toTarsTraceArtifact(data);
  return {
    answer: answer || '(pwc_tars returned no answer.)',
    modelName: data?.model_name ?? '',
    totalTokens: data?.tokens?.total ?? 0,
    knowledgeBaseIds,
    ...(trace ? { trace } : {}),
  };
}
