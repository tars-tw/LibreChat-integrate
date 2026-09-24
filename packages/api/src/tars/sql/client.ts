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

const SQL_AGENT_PATH = '/api/langflow-service/sql';
/**
 * pwc_tars caps one synchronous SQL-agent turn at 300s, so LibreChat waits a
 * little less and surfaces its own timeout first. Override with
 * `TARS_SQL_AGENT_TIMEOUT_MS`.
 */
const DEFAULT_TIMEOUT_MS = 240_000;

/** A knowledge base whose bound SQL database the agent may query. */
export interface TarsSqlDatabase {
  knowledge_base_id: string;
  name: string;
  description: string;
}

export interface TarsSqlAgentInput {
  question: string;
  knowledgeBaseId: string;
  /** The active 專用腦, which bounds the databases this call may reach. */
  domainId?: string | number | null;
  /** The model the chat turn runs on, as LibreChat names it. */
  model?: string;
  /** The account the LLM gateway resolves models and quota for. */
  librechatUserId?: string;
}

export interface TarsSqlAgentResult {
  answer: string;
  modelName: string;
  totalTokens: number;
  /** The nested run, for the chat to show; absent when pwc_tars sent no trace. */
  trace?: TTarsTraceArtifact;
}

/** Drops the cached per-user knowledge-base scopes so the next call re-reads pwc_tars. */
export function invalidateTarsSqlDatabasesCache(): void {
  invalidateTarsScopedKnowledgeBasesCache();
}

const toSqlDatabase = (base: TarsKnowledgeBase): TarsSqlDatabase => ({
  knowledge_base_id: base.id,
  name: base.name,
  description: base.description ?? '',
});

/**
 * The databases one turn may query: the knowledge bases the active 專用腦
 * binds ({@link listTarsScopedKnowledgeBases}) that carry a bound SQL database
 * (`has_sql_database`). That scope is already the user's grants, so this
 * doubles as the authorization set for {@link runTarsSqlAgent}.
 */
export async function listTarsSqlDatabases(
  tarsUserId: string,
  domainId?: string | number | null,
): Promise<TarsSqlDatabase[]> {
  const bases = await listTarsScopedKnowledgeBases(tarsUserId, domainId);
  return bases.filter((base) => base.has_sql_database === true).map(toSqlDatabase);
}

/**
 * Runs one pwc_tars SQL-agent turn against the database bound to
 * `knowledgeBaseId` (`POST /api/langflow-service/sql`). pwc_tars owns the
 * text-to-SQL loop, the read-only guard and the schema prompt; LibreChat only
 * checks that the caller may reach that knowledge base and relays the answer.
 */
export async function runTarsSqlAgent(
  tarsUserId: string,
  input: TarsSqlAgentInput,
): Promise<TarsSqlAgentResult> {
  const databases = await listTarsSqlDatabases(tarsUserId, input.domainId);
  if (!databases.some((database) => database.knowledge_base_id === input.knowledgeBaseId)) {
    throw new Error(
      `Knowledge base "${input.knowledgeBaseId}" is not one of the databases bound to the active brain, ` +
        'or this user cannot access it.',
    );
  }
  const requestedModel = await resolveLangflowModelName(input.model, 'tars-sql');
  const data = await runLangflowCapability(
    SQL_AGENT_PATH,
    {
      query: input.question,
      knowledge_base_id: input.knowledgeBaseId,
      model_name: requestedModel,
    },
    {
      timeoutMs: langflowTimeoutMs('TARS_SQL_AGENT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
      librechatUserId: input.librechatUserId,
    },
  );

  const answer = data?.answer?.trim();
  if (!answer) {
    logger.warn('[tars-sql] pwc_tars returned an empty SQL-agent answer');
  }
  /** The audit trail for "which model actually ran the nested loop": what the
   *  chat turn asked for and what pwc_tars reports it used. `gateway=requested`
   *  records that we asked for LibreChat's gateway — pwc_tars's own
   *  `FLAG_USE_LIBRECHAT_LLM` switch decides whether it honored that. */
  logger.debug(
    `[tars-sql] kb=${input.knowledgeBaseId} requested=${requestedModel ?? '(pwc_tars default)'} ` +
      `used=${data?.model_name ?? '(unreported)'} tokens=${data?.tokens?.total ?? 0} ` +
      'gateway=requested',
  );
  const trace = toTarsTraceArtifact(data);
  return {
    answer: answer || '(pwc_tars returned no answer.)',
    modelName: data?.model_name ?? '',
    totalTokens: data?.tokens?.total ?? 0,
    ...(trace ? { trace } : {}),
  };
}
