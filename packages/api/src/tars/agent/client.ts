import { logger } from '@librechat/data-schemas';
import type { TTarsTraceArtifact } from 'librechat-data-provider';
import type { LangflowCapabilityData } from '~/tars/langflow/client';
import type { TarsMemoryDocument } from '~/tars/memory/client';
import type { TarsRagKnowledgeBase } from '~/tars/rag/client';
import type { TarsSqlDatabase } from '~/tars/sql/client';
import type { TarsAgentBindings } from './bindings';
import {
  langflowTimeoutMs,
  toTarsTraceArtifact,
  runLangflowCapability,
  resolveLangflowModelName,
} from '~/tars/langflow/client';
import { listTarsRagKnowledgeBases, resolveTarsKnowledgeBaseIds } from '~/tars/rag/client';
import { listTarsSqlDatabases } from '~/tars/sql/client';

const AGENT_PATH = '/api/langflow-service/agent';
/**
 * pwc_tars caps one synchronous turn at 300s, so LibreChat waits a little less
 * and surfaces its own timeout first. Override with `TARS_AGENT_TIMEOUT_MS`.
 */
const DEFAULT_TIMEOUT_MS = 240_000;
/** A table task (one job per spreadsheet row) gets pwc_tars's 1800s budget instead. */
const TABLE_TASK_TIMEOUT_MS = 1_740_000;

/** What one combined turn may reach, after the bindings and the brain have had their say. */
export interface TarsAgentScope {
  knowledgeBases: TarsRagKnowledgeBase[];
  databases: TarsSqlDatabase[];
  documents: TarsMemoryDocument[];
  chart: boolean;
}

export interface TarsAgentInput {
  question: string;
  bindings: TarsAgentBindings;
  /** Subset of the reachable knowledge bases; empty means all of them. */
  knowledgeBaseIds?: string[];
  /** The knowledge base whose database to bind; defaults to the only one when there is one. */
  databaseKnowledgeBaseId?: string;
  /** Subset of the attached spreadsheets; empty means all of them. */
  documentIds?: string[];
  /** The active 專用腦, which bounds everything this call may reach. */
  domainId?: string | number | null;
  /** The model the chat turn runs on, as LibreChat names it. */
  model?: string;
  /** The account the LLM gateway resolves models and quota for. */
  librechatUserId?: string;
}

export interface TarsAgentResult {
  answer: string;
  modelName: string;
  totalTokens: number;
  knowledgeBaseIds: string[];
  databaseKnowledgeBaseId?: string;
  documentIds: string[];
  /** The nested run, for the chat to show; absent when pwc_tars sent no trace. */
  trace?: TTarsTraceArtifact;
}

const EMPTY_LIST: never[] = [];

/**
 * The brain's knowledge bases and databases come off one cached scope, so a
 * turn costs one pwc_tars round trip per user and brain however many of them
 * are bound; unbound halves are simply left empty.
 */
export async function listTarsAgentScope(
  tarsUserId: string,
  domainId: string | number | null | undefined,
  bindings: TarsAgentBindings,
): Promise<TarsAgentScope> {
  const [knowledgeBases, databases] = await Promise.all([
    bindings.knowledgeBases ? listTarsRagKnowledgeBases(tarsUserId, domainId) : EMPTY_LIST,
    bindings.database ? listTarsSqlDatabases(tarsUserId, domainId) : EMPTY_LIST,
  ]);
  return { knowledgeBases, databases, documents: bindings.documents, chart: bindings.chart };
}

/**
 * The database one call binds: the one the model named when it is reachable,
 * the brain's only database when it named none, and none at all when the
 * brain has several and the model did not choose — pwc_tars's own chat runs
 * without SQL in that case too, rather than guessing a database.
 */
function resolveDatabase(
  databases: TarsSqlDatabase[],
  requested: string | undefined,
): string | undefined {
  const id = requested?.trim();
  if (id) {
    if (!databases.some((database) => database.knowledge_base_id === id)) {
      throw new Error(
        `Knowledge base "${id}" has no database bound in the active brain, or this user cannot access it.`,
      );
    }
    return id;
  }
  return databases.length === 1 ? databases[0].knowledge_base_id : undefined;
}

/** Ids outside the conversation's own attachments are dropped, never forwarded. */
function resolveDocumentIds(documents: TarsMemoryDocument[], requested?: string[]): string[] {
  if (!requested?.length) {
    return documents.map((doc) => doc.id);
  }
  const known = new Set(documents.map((doc) => doc.id));
  return requested.filter((id) => known.has(id));
}

/**
 * pwc_tars usually embeds the links to what it generated in the answer; when
 * the model left one out, the link is appended so the user still gets the file.
 */
function withGeneratedLinks(answer: string, data: LangflowCapabilityData): string {
  const chartUrl = data.chart_url?.trim() ?? '';
  const fileUrl = data.file_url?.trim() ?? '';
  const extras: string[] = [];
  if (chartUrl && !answer.includes(chartUrl)) {
    extras.push(`![chart](${chartUrl})`);
  }
  if (fileUrl && !answer.includes(fileUrl)) {
    extras.push(`[下載檔案](${fileUrl})`);
  }
  return extras.length ? `${answer}\n\n${extras.join('\n\n')}`.trim() : answer;
}

/**
 * Runs one pwc_tars turn with the chat's own tool set, bound the way the
 * bindings say (`POST /api/langflow-service/agent`), so pwc_tars's model
 * decides per question which of them it needs. LibreChat only bounds what may
 * be reached and relays the answer.
 */
export async function runTarsAgent(
  tarsUserId: string,
  input: TarsAgentInput,
): Promise<TarsAgentResult> {
  const scope = await listTarsAgentScope(tarsUserId, input.domainId, input.bindings);
  if (input.knowledgeBaseIds?.length && !scope.knowledgeBases.length) {
    throw new Error('No knowledge base is bound for this turn, so none can be searched.');
  }
  const knowledgeBaseIds = scope.knowledgeBases.length
    ? resolveTarsKnowledgeBaseIds(scope.knowledgeBases, input.knowledgeBaseIds)
    : [];
  if (input.databaseKnowledgeBaseId && !scope.databases.length) {
    throw new Error('No database is bound for this turn, so none can be queried.');
  }
  const databaseKnowledgeBaseId = resolveDatabase(scope.databases, input.databaseKnowledgeBaseId);
  const documentIds = resolveDocumentIds(scope.documents, input.documentIds);

  const requestedModel = await resolveLangflowModelName(input.model, 'tars-agent');
  const tableTaskPossible = documentIds.length > 0 && knowledgeBaseIds.length > 0;
  const data = await runLangflowCapability(
    AGENT_PATH,
    {
      query: input.question,
      ...(knowledgeBaseIds.length ? { knowledge_base_ids: knowledgeBaseIds.join(',') } : {}),
      ...(databaseKnowledgeBaseId ? { database_knowledge_base_id: databaseKnowledgeBaseId } : {}),
      ...(documentIds.length ? { document_ids: documentIds.join(',') } : {}),
      model_name: requestedModel,
    },
    {
      timeoutMs: tableTaskPossible
        ? langflowTimeoutMs('TARS_TABLE_TASK_TIMEOUT_MS', TABLE_TASK_TIMEOUT_MS)
        : langflowTimeoutMs('TARS_AGENT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
      librechatUserId: input.librechatUserId,
    },
  );

  const answer = data?.answer?.trim() ?? '';
  if (!answer) {
    logger.warn('[tars-agent] pwc_tars returned an empty answer');
  }
  logger.debug(
    `[tars-agent] kbs=${knowledgeBaseIds.length} db=${databaseKnowledgeBaseId ?? '(none)'} ` +
      `docs=${documentIds.length} requested=${requestedModel ?? '(pwc_tars default)'} ` +
      `used=${data?.model_name ?? '(unreported)'} tokens=${data?.tokens?.total ?? 0} gateway=requested`,
  );
  const trace = toTarsTraceArtifact(data);
  return {
    answer: withGeneratedLinks(answer, data) || '(pwc_tars returned no answer.)',
    modelName: data?.model_name ?? '',
    totalTokens: data?.tokens?.total ?? 0,
    knowledgeBaseIds,
    documentIds,
    ...(databaseKnowledgeBaseId ? { databaseKnowledgeBaseId } : {}),
    ...(trace ? { trace } : {}),
  };
}
