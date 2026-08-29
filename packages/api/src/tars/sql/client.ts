import { logger } from '@librechat/data-schemas';
import type { TarsKnowledgeBase } from '~/tars/knowledge';
import {
  langflowTimeoutMs,
  runLangflowCapability,
  resolveLangflowModelName,
} from '~/tars/langflow/client';
import { fetchTarsDomainKnowledgeBases } from '~/tars/prompts';
import { fetchTarsKnowledgeBases } from '~/tars/knowledge';

const SQL_AGENT_PATH = '/api/langflow-service/sql';
/**
 * pwc_tars caps one synchronous SQL-agent turn at 300s, so LibreChat waits a
 * little less and surfaces its own timeout first. Override with
 * `TARS_SQL_AGENT_TIMEOUT_MS`.
 */
const DEFAULT_TIMEOUT_MS = 240_000;
const DATABASES_CACHE_TTL_MS = 30_000;

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
}

interface DatabasesCacheEntry {
  databases: TarsSqlDatabase[];
  cachedAt: number;
}

const databasesCache = new Map<string, DatabasesCacheEntry>();

/** Drops the cached per-user database lists so the next call re-reads pwc_tars. */
export function invalidateTarsSqlDatabasesCache(): void {
  databasesCache.clear();
}

const toSqlDatabase = (base: TarsKnowledgeBase): TarsSqlDatabase => ({
  knowledge_base_id: base.id,
  name: base.name,
  description: base.description ?? '',
});

/**
 * The databases one turn may query: the knowledge bases carrying a bound SQL
 * database (`has_sql_database`), narrowed to those the active 專用腦 binds.
 * This mirrors pwc_tars's own chat path, which resolves a database from the
 * domain's `knowledge_base_ids` rather than from everything the user can see —
 * a brain answers out of its own data, not the whole platform's.
 *
 * Both listings are already scoped by pwc_tars to the user's grants, so this
 * doubles as the authorization set for {@link runTarsSqlAgent}. Without a
 * domain (a caller outside the chat path) it falls back to every knowledge base
 * the user may access.
 */
export async function listTarsSqlDatabases(
  tarsUserId: string,
  domainId?: string | number | null,
): Promise<TarsSqlDatabase[]> {
  if (!tarsUserId) {
    return [];
  }
  const scope = domainId == null || domainId === '' ? '' : String(domainId);
  const cacheKey = `${tarsUserId}\u0000${scope}`;
  const cached = databasesCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < DATABASES_CACHE_TTL_MS) {
    return cached.databases;
  }

  const [bases, domainBases] = await Promise.all([
    fetchTarsKnowledgeBases(tarsUserId),
    scope ? fetchTarsDomainKnowledgeBases(tarsUserId, scope) : Promise.resolve(null),
  ]);
  const inDomain = domainBases && new Set(domainBases.map((base) => base.id));
  const databases = bases
    .filter((base) => base.has_sql_database === true && (!inDomain || inDomain.has(base.id)))
    .map(toSqlDatabase);
  databasesCache.set(cacheKey, { databases, cachedAt: Date.now() });
  return databases;
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
  return {
    answer: answer || '(pwc_tars returned no answer.)',
    modelName: data?.model_name ?? '',
    totalTokens: data?.tokens?.total ?? 0,
  };
}
