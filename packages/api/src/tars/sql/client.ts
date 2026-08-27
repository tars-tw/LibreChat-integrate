import { logger } from '@librechat/data-schemas';
import type { TarsKnowledgeBase } from '~/tars/knowledge';
import { fetchTarsDomainKnowledgeBases } from '~/tars/prompts';
import { fetchTarsKnowledgeBases } from '~/tars/knowledge';
import { getTarsModelProfileNames } from '~/tars/models';
import { getTarsSysConfigValue } from '~/tars/sysconfig';
import { tarsFetch } from '~/tars/client';

/** pwc_tars sys_config key holding the shared secret for `/api/langflow-service/*`. */
const SERVICE_KEY_CONFIG = 'KEY_LANGFLOW_API_KEY';
const SERVICE_KEY_HEADER = 'X-TARS-Service-Key';
/** Opt-in headers that make pwc_tars drive the SQL agent's LLM through LibreChat's gateway. */
const GATEWAY_HEADER = 'X-Use-Librechat-Gateway';
const GATEWAY_USER_HEADER = 'X-Librechat-User-Id';

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
  /** The account the LLM gateway resolves API keys for, when gateway routing is on. */
  librechatUserId?: string;
}

export interface TarsSqlAgentResult {
  answer: string;
  modelName: string;
  totalTokens: number;
}

interface SqlServiceEnvelope {
  data?: {
    answer?: string;
    model_name?: string;
    tokens?: { total?: number };
  };
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

function timeoutMs(): number {
  const raw = Number(process.env.TARS_SQL_AGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** Whether pwc_tars should run the SQL agent's LLM through LibreChat's gateway. */
function usesLlmGateway(): boolean {
  return process.env.TARS_SQL_AGENT_USE_GATEWAY?.trim().toLowerCase() === 'true';
}

/**
 * The pwc_tars model the nested SQL-agent loop runs on. Precedence:
 * `TARS_SQL_AGENT_MODEL` (explicit pin) > the model this user's current chat
 * turn resolved to > undefined, which lets pwc_tars pick its default sys_model.
 *
 * The chat model is matched against pwc_tars's `model_profile` names — the same
 * list the model selector is filtered by, so the normal picker can only produce
 * a match — and the canonical spelling is what gets sent. Saved agents and
 * assistants bypass that selector filter, and the filter fails open while
 * pwc_tars is unreachable, so an unmatched model falls back to the default
 * rather than letting pwc_tars reject the whole call.
 */
async function resolveModelName(chatModel?: string): Promise<string | undefined> {
  const override = process.env.TARS_SQL_AGENT_MODEL?.trim();
  if (override) {
    return override;
  }
  if (!chatModel) {
    return undefined;
  }
  const profiles = await getTarsModelProfileNames();
  const match = profiles?.find((name) => name.toLowerCase() === chatModel.toLowerCase());
  if (!match) {
    logger.debug(
      `[tars-sql] Chat model "${chatModel}" is not a pwc_tars model_profile; falling back to the pwc_tars default`,
    );
  }
  return match;
}

/**
 * The `/api/langflow-service` service key: the `TARS_SQL_SERVICE_KEY` env
 * override first, otherwise the `KEY_LANGFLOW_API_KEY` sys_config row pwc_tars
 * already validates that endpoint against — so a single pwc_tars-side setting
 * configures both callers.
 */
async function serviceKey(): Promise<string | undefined> {
  const override = process.env.TARS_SQL_SERVICE_KEY?.trim();
  if (override) {
    return override;
  }
  return getTarsSysConfigValue(SERVICE_KEY_CONFIG);
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
  const key = await serviceKey();
  if (!key) {
    throw new Error(
      'The pwc_tars service key is not configured (sys_config KEY_LANGFLOW_API_KEY / TARS_SQL_SERVICE_KEY).',
    );
  }

  const databases = await listTarsSqlDatabases(tarsUserId, input.domainId);
  if (!databases.some((database) => database.knowledge_base_id === input.knowledgeBaseId)) {
    throw new Error(
      `Knowledge base "${input.knowledgeBaseId}" is not one of the databases bound to the active brain, ` +
        'or this user cannot access it.',
    );
  }

  const gateway = usesLlmGateway();
  const headers: Record<string, string> = { [SERVICE_KEY_HEADER]: key };
  if (gateway) {
    headers[GATEWAY_HEADER] = 'true';
    if (input.librechatUserId) {
      headers[GATEWAY_USER_HEADER] = input.librechatUserId;
    }
  }

  const requestedModel = await resolveModelName(input.model);
  const data = await tarsFetch<SqlServiceEnvelope>(SQL_AGENT_PATH, {
    method: 'POST',
    timeoutMs: timeoutMs(),
    headers,
    body: {
      query: input.question,
      knowledge_base_id: input.knowledgeBaseId,
      model_name: requestedModel,
    },
  });

  const answer = data?.data?.answer?.trim();
  if (!answer) {
    logger.warn('[tars-sql] pwc_tars returned an empty SQL-agent answer');
  }
  /** The audit trail for "which model actually ran the nested loop": what the
   *  chat turn asked for, what pwc_tars reports it used, and whether the call
   *  was served through LibreChat's own gateway. */
  logger.debug(
    `[tars-sql] kb=${input.knowledgeBaseId} requested=${requestedModel ?? '(pwc_tars default)'} ` +
      `used=${data?.data?.model_name ?? '(unreported)'} tokens=${data?.data?.tokens?.total ?? 0} ` +
      `via=${gateway ? 'librechat-gateway' : 'pwc_tars-direct'}`,
  );
  return {
    answer: answer || '(pwc_tars returned no answer.)',
    modelName: data?.data?.model_name ?? '',
    totalTokens: data?.data?.tokens?.total ?? 0,
  };
}
