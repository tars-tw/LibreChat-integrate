import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import {
  TARS_BUILTIN_TOOLS,
  tarsBuiltinToolOf,
  isTarsBuiltinToolName,
} from 'librechat-data-provider';
import type {
  AgentCapabilities,
  TTarsToolStep,
  TTarsToolSource,
  TTarsBuiltinTool,
} from 'librechat-data-provider';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { JsonSchemaType } from '@librechat/data-schemas';
import type { TarsBuiltinToolContext, TarsBuiltinToolResult } from './client';
import type { TarsProgressReporter, TarsToolRunConfig } from './progress';
import type { TarsBuiltinManifest } from '~/tars/plugins/client';
import type { LangflowToolResult } from '~/tars/langflow/client';
import type { TarsMemoryDocument } from '~/tars/memory/client';
import {
  langflowToolResult,
  resolveLangflowModelName,
  LANGFLOW_TOOL_RESPONSE_FORMAT,
} from '~/tars/langflow/client';
import { listTarsRagKnowledgeBases, resolveTarsKnowledgeBaseIds } from '~/tars/rag/client';
import { getTarsBuiltinManifest, primeTarsBuiltinManifests } from '~/tars/plugins/client';
import { TARS_DATABASE_SWITCH_TOOL, tarsBuiltinToolCapability } from './names';
import { normalizeJsonSchema, resolveJsonSchemaRefs } from '~/mcp/zod';
import { TarsRequestError, isTarsConfigured } from '~/tars/client';
import { resolveTarsDatabaseId } from '~/tars/agent/client';
import { listTarsSqlDatabases } from '~/tars/sql/client';
import { rewriteTarsAssetLinks } from '~/tars/assets';
import { runTarsBuiltinTool } from './client';

/** LibreChat-side arguments that narrow what a call reaches; never forwarded as tool inputs. */
const KNOWLEDGE_ARG = 'knowledge_base_ids';
const DATABASE_ARG = 'database_knowledge_base_id';

/** How pwc_tars's `build_sources` joins the chunks one file contributed. */
const CHUNK_SEPARATOR = '\n\n---\n\n';
const SOURCE_EXCERPT_CHARS = 280;
/** A result table or schema listing is shown on the card; anything longer is cut there only. */
const OUTPUT_DISPLAY_CHARS = 6_000;

const NOT_LINKED = 'This LibreChat account is not linked to pwc_tars, so TARS tools cannot run.';

/** Registry entry for the definition-only (deferred) load path. */
export interface TarsBuiltinToolDefinition {
  name: string;
  description: string;
  schema: JsonSchemaType;
  toolType: 'builtin';
  responseFormat: typeof LANGFLOW_TOOL_RESPONSE_FORMAT;
}

const needsContext = (manifest: TarsBuiltinManifest, field: keyof TarsBuiltinToolContext) =>
  manifest.context_fields.some((entry) => entry.name === field);

const requiresContext = (manifest: TarsBuiltinManifest, field: keyof TarsBuiltinToolContext) =>
  manifest.context_fields.some((entry) => entry.name === field && entry.required === true);

/**
 * pwc_tars's own argument schema, plus the LibreChat arguments that choose
 * among what the active 專用腦 binds. pwc_tars binds that scope per call from
 * `context`, so the choice has to come from the model here.
 */
function toParameters(manifest: TarsBuiltinManifest): JsonSchemaType {
  const base = normalizeJsonSchema(resolveJsonSchemaRefs(manifest.input_schema));
  const properties: Record<string, JsonSchemaType> = { ...(base.properties ?? {}) };
  if (needsContext(manifest, 'knowledge_base_ids')) {
    properties[KNOWLEDGE_ARG] = {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional subset of the knowledge bases listed under "TARS tools", by knowledge_base_id. ' +
        'Omit to use all of them.',
    };
  }
  if (needsContext(manifest, 'knowledge_base_id')) {
    properties[DATABASE_ARG] = {
      type: 'string',
      description:
        'Which database to use, by the knowledge_base_id listed under "TARS tools". ' +
        'Only needed when more than one database is listed.',
    };
  }
  return { ...base, type: 'object', properties };
}

/**
 * The definition of a primed built-in, shared by the registry and the tool
 * instance so the model sees the same schema on either load path. Undefined
 * for other names and for tools pwc_tars does not currently list.
 */
export function getTarsBuiltinDefinition(toolName: string): TarsBuiltinToolDefinition | undefined {
  const builtin = tarsBuiltinToolOf(toolName);
  const manifest = builtin ? getTarsBuiltinManifest(builtin) : undefined;
  if (!manifest) {
    return undefined;
  }
  return {
    name: toolName,
    description: manifest.description,
    schema: toParameters(manifest),
    toolType: 'builtin',
    responseFormat: LANGFLOW_TOOL_RESPONSE_FORMAT,
  };
}

/**
 * The requested tools the turn may equip: pwc_tars currently offers them, and
 * the librechat.yaml capability of their chat switch is on. Resolving primes
 * the manifest cache, which the definition registry reads synchronously, so
 * this must run before the definitions are loaded. Empty when TARS is
 * unreachable: the chat then runs without these tools rather than with broken ones.
 */
export async function resolveTarsBuiltinTools(
  tools: readonly string[],
  isCapabilityEnabled: (capability: AgentCapabilities) => boolean = () => true,
): Promise<Set<string>> {
  const requested = tools.filter((name) => {
    if (!isTarsBuiltinToolName(name)) {
      return false;
    }
    const capability = tarsBuiltinToolCapability(name);
    return capability == null || isCapabilityEnabled(capability);
  });
  if (requested.length === 0 || !isTarsConfigured()) {
    return new Set();
  }
  try {
    const manifests = await primeTarsBuiltinManifests();
    return new Set(requested.filter((name) => manifests.has(tarsBuiltinToolOf(name) ?? '')));
  } catch (error) {
    logger.warn('[tars-tools] Could not list pwc_tars built-in tools; not equipping them', error);
    return new Set();
  }
}

export interface TarsBuiltinToolOptions {
  /** The LibreChat tool name (`tars_knowledge_search`, ...). */
  toolName: string;
  /** pwc_tars user the call runs as; absent for an unlinked LibreChat account. */
  tarsUserId?: string;
  /** Active 專用腦 — knowledge bases and databases are narrowed to what it binds. */
  domainId?: string | number | null;
  /** The turn's tools; charts and files reach the database only when it is switched on. */
  agentTools?: readonly string[];
  /** The conversation's active spreadsheets (csv / xlsx memory files). */
  documents?: TarsMemoryDocument[] | null;
  /** Model the chat turn runs on; a tool that calls a model itself inherits it. */
  model?: string;
  librechatUserId?: string;
  /** The user's current message, offered to the tool as `ctx.question`. */
  question?: string;
  /** Relays the progress the tool reports to its card while it runs (host-bound). */
  reportProgress?: TarsProgressReporter;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asStrings = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;

interface BoundCall {
  inputs: Record<string, unknown>;
  context: TarsBuiltinToolContext;
}

async function bindKnowledgeBases(
  manifest: TarsBuiltinManifest,
  options: TarsBuiltinToolOptions & { tarsUserId: string },
  requested: unknown,
): Promise<string | undefined> {
  if (!needsContext(manifest, 'knowledge_base_ids')) {
    return undefined;
  }
  const bases = await listTarsRagKnowledgeBases(options.tarsUserId, options.domainId);
  const ids = resolveTarsKnowledgeBaseIds(bases, asStrings(requested));
  if (!ids.length && requiresContext(manifest, 'knowledge_base_ids')) {
    throw new Error('The active brain binds no knowledge base, so there is nothing to search.');
  }
  return ids.length ? ids.join(',') : undefined;
}

async function bindDatabase(
  manifest: TarsBuiltinManifest,
  options: TarsBuiltinToolOptions & { tarsUserId: string },
  requested: unknown,
): Promise<string | undefined> {
  const requestedId = asString(requested);
  if (!needsContext(manifest, 'knowledge_base_id')) {
    return undefined;
  }
  const required = requiresContext(manifest, 'knowledge_base_id');
  const switchedOn = required || options.agentTools?.includes(TARS_DATABASE_SWITCH_TOOL) === true;
  if (!switchedOn) {
    if (requestedId) {
      throw new Error('No database is switched on for this turn, so none can be queried.');
    }
    return undefined;
  }
  const databases = await listTarsSqlDatabases(options.tarsUserId, options.domainId);
  const id = resolveTarsDatabaseId(databases, requestedId);
  if (id || !required) {
    return id;
  }
  throw new Error(
    databases.length > 1
      ? `Several databases are bound; name one as \`${DATABASE_ARG}\`.`
      : 'The active brain binds no database, so there is nothing to query.',
  );
}

/**
 * Splits the model's arguments into the tool's own inputs and the scope
 * pwc_tars binds before building it. Every id is checked against the active
 * 專用腦 here: pwc_tars's direct tool route trusts whatever `context` names.
 */
async function bindCall(
  manifest: TarsBuiltinManifest,
  input: Record<string, unknown>,
  options: TarsBuiltinToolOptions & { tarsUserId: string },
): Promise<BoundCall> {
  const { [KNOWLEDGE_ARG]: requestedBases, [DATABASE_ARG]: requestedDatabase, ...inputs } = input;
  const [knowledgeBaseIds, databaseId, modelName] = await Promise.all([
    bindKnowledgeBases(manifest, options, requestedBases),
    bindDatabase(manifest, options, requestedDatabase),
    needsContext(manifest, 'model_name')
      ? resolveLangflowModelName(options.model, 'tars-tools')
      : Promise.resolve(undefined),
  ]);
  const documentIds = needsContext(manifest, 'document_ids')
    ? (options.documents ?? []).map((doc) => doc.id).join(',')
    : '';

  const context: TarsBuiltinToolContext = {};
  if (options.question) {
    context.question = options.question;
  }
  if (modelName) {
    context.model_name = modelName;
  }
  if (knowledgeBaseIds) {
    context.knowledge_base_ids = knowledgeBaseIds;
  }
  if (databaseId) {
    context.knowledge_base_id = databaseId;
  }
  if (documentIds) {
    context.document_ids = documentIds;
  }
  return { inputs, context };
}

/**
 * What the model reads. pwc_tars usually embeds the links to what it
 * generated; one it left out is appended so the model can still pass it on,
 * and every link is routed through LibreChat's relay.
 */
function toModelText(result: TarsBuiltinToolResult): string {
  const parts: string[] = [];
  const content = result.content.trim();
  const finalText = result.final_text.trim();
  if (content) {
    parts.push(content);
  }
  if (finalText && !content.includes(finalText)) {
    parts.push(finalText);
  }
  const text = parts.join('\n\n');
  for (const item of result.generated_urls) {
    if (!item.url || text.includes(item.url)) {
      continue;
    }
    parts.push(item.type === 'chart' ? `![chart](${item.url})` : `[下載檔案](${item.url})`);
  }
  const body = parts.join('\n\n') || '(the tool returned no output)';
  return rewriteTarsAssetLinks(result.is_error ? `The tool reported an error: ${body}` : body);
}

function toSources(result: TarsBuiltinToolResult): TTarsToolSource[] {
  const sources: TTarsToolSource[] = [];
  for (const source of result.sources) {
    if (!source.filename || source.type === 'web') {
      continue;
    }
    const content = source.content ?? '';
    sources.push({
      filename: source.filename,
      chunks: content ? content.split(CHUNK_SEPARATOR).length : 0,
      ...(content ? { excerpt: content.slice(0, SOURCE_EXCERPT_CHARS) } : {}),
    });
  }
  return sources;
}

/**
 * The card's view of the call. A search shows the files it read rather than
 * the chunks themselves; everything else shows its (capped) output, which is
 * a result table, a schema listing or a generated link.
 */
function toStep(
  builtin: TTarsBuiltinTool,
  result: TarsBuiltinToolResult,
  text: string,
): TTarsToolStep {
  const sources = toSources(result);
  const links = result.generated_urls
    .filter((item) => item.url)
    .map((item) => ({ type: item.type ?? 'file', url: rewriteTarsAssetLinks(item.url ?? '') }));
  const step: TTarsToolStep = { tool: builtin, ok: !result.is_error };
  if (result.summary) {
    step.summary = result.summary;
  }
  if (sources.length) {
    step.sources = sources;
  }
  if (links.length) {
    step.links = links;
  }
  if (!sources.length && text) {
    step.output = text.slice(0, OUTPUT_DISPLAY_CHARS);
    step.truncated = text.length > OUTPUT_DISPLAY_CHARS;
  }
  return step;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TarsRequestError && error.serverMessage) {
    return error.serverMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * One pwc_tars built-in agent tool as a native LibreChat tool. The chat model
 * here drives the loop — the way pwc_tars's own chat model drives it — and
 * pwc_tars runs just the tool, so each step streams into the chat as its own
 * tool call instead of disappearing into one nested pwc_tars run. Undefined
 * when pwc_tars does not list the tool; the caller skips it.
 */
export async function createTarsBuiltinTool(
  options: TarsBuiltinToolOptions,
): Promise<DynamicStructuredTool | undefined> {
  const builtin = tarsBuiltinToolOf(options.toolName);
  if (!builtin) {
    return undefined;
  }
  let manifest: TarsBuiltinManifest | undefined;
  try {
    manifest = (await primeTarsBuiltinManifests()).get(builtin);
  } catch (error) {
    logger.warn(`[tars-tools] Could not list pwc_tars tools; "${builtin}" not equipped`, error);
    return undefined;
  }
  if (!manifest) {
    logger.warn(`[tars-tools] pwc_tars does not list "${builtin}"; not equipped`);
    return undefined;
  }
  const { tarsUserId } = options;

  return tool(
    async (
      input: Record<string, unknown>,
      config?: TarsToolRunConfig,
    ): Promise<LangflowToolResult> => {
      if (!tarsUserId) {
        return langflowToolResult(NOT_LINKED);
      }
      try {
        const { inputs, context } = await bindCall(manifest, input, { ...options, tarsUserId });
        const result = await runTarsBuiltinTool(builtin, {
          inputs,
          context,
          longRunning: manifest.long_running,
          librechatUserId: options.librechatUserId,
          tarsUserId,
          onProgress: (message) => options.reportProgress?.(message, config),
          signal: config?.signal,
        });
        const text = toModelText(result);
        return langflowToolResult(text, { trace: [], step: toStep(builtin, result, text) });
      } catch (error) {
        const message = toErrorMessage(error);
        return langflowToolResult(`The tool "${options.toolName}" failed: ${message}`, {
          trace: [],
          step: { tool: builtin, ok: false, output: message },
        });
      }
    },
    {
      name: options.toolName,
      description: manifest.description,
      schema: toParameters(manifest),
      responseFormat: LANGFLOW_TOOL_RESPONSE_FORMAT,
    },
  ) as unknown as DynamicStructuredTool;
}

/** pwc_tars tool names as the guides spell them → the LibreChat names the model calls. */
const TOOL_NAME_IN_GUIDE = new RegExp(
  `\\b(${Object.values(TARS_BUILTIN_TOOLS).join('|')})\\b`,
  'g',
);
const LIBRECHAT_TOOL_NAME = new Map<string, string>(
  Object.entries(TARS_BUILTIN_TOOLS).map(([librechatName, builtin]) => [builtin, librechatName]),
);

/**
 * pwc_tars's own usage guide for the mounted tools, read off their manifests
 * (`guide`, the body of the guide pwc_tars's chat shows) so the wording stays
 * pwc_tars's. Tools sharing one guide are listed together, as pwc_tars does,
 * and the tool names inside it are renamed to the ones the model calls here.
 */
function toolGuides(mounted: ReadonlySet<string>): string[] {
  const namesByGuide = new Map<string, string[]>();
  for (const [librechatName, builtin] of Object.entries(TARS_BUILTIN_TOOLS)) {
    const guide = mounted.has(librechatName) ? getTarsBuiltinManifest(builtin)?.guide : undefined;
    if (guide) {
      namesByGuide.set(guide, [...(namesByGuide.get(guide) ?? []), librechatName]);
    }
  }
  return [...namesByGuide].map(([guide, names]) => {
    const body = guide.replace(TOOL_NAME_IN_GUIDE, (name) => LIBRECHAT_TOOL_NAME.get(name) ?? name);
    return `- ${names.join(' / ')}：${body}`;
  });
}

export interface TarsToolsContextParams {
  tarsUserId?: string;
  domainId?: string | number | null;
  /** The turn's tools after gating; only the `tars_*` built-ins among them count. */
  tools: readonly string[];
}

async function listScope(
  params: TarsToolsContextParams & { tarsUserId: string },
  mounted: Set<string>,
): Promise<string[]> {
  const wantsBases = mounted.has('tars_knowledge_search') || mounted.has('tars_table_task');
  const wantsDatabases = mounted.has(TARS_DATABASE_SWITCH_TOOL);
  const [bases, databases] = await Promise.all([
    wantsBases ? listTarsRagKnowledgeBases(params.tarsUserId, params.domainId) : [],
    wantsDatabases ? listTarsSqlDatabases(params.tarsUserId, params.domainId) : [],
  ]);
  const lines: string[] = [];
  if (wantsBases) {
    lines.push(
      bases.length
        ? '知識庫（預設全部搜尋，可用 `knowledge_base_ids` 縮小範圍）：'
        : '目前的專用腦沒有綁定知識庫。',
      ...bases.map((base) =>
        base.description
          ? `- ${base.name}（knowledge_base_id: ${base.knowledge_base_id}）— ${base.description}`
          : `- ${base.name}（knowledge_base_id: ${base.knowledge_base_id}）`,
      ),
    );
  }
  if (wantsDatabases && databases.length === 1) {
    lines.push(`資料庫：${databases[0].name}（自動使用，不必指定）。`);
  } else if (wantsDatabases && databases.length > 1) {
    lines.push(
      '資料庫（呼叫時用 `database_knowledge_base_id` 指定要查哪一個）：',
      ...databases.map((db) => `- ${db.name}（knowledge_base_id: ${db.knowledge_base_id}）`),
    );
  } else if (wantsDatabases) {
    lines.push('目前的專用腦沒有綁定資料庫。');
  }
  return lines;
}

/**
 * The runtime context for the turn's TARS tools: pwc_tars's usage guide for
 * the ones mounted, then what the active 專用腦 lets them reach. Undefined
 * when the turn carries none of them. Reads the primed manifests, so it runs
 * after {@link resolveTarsBuiltinTools}.
 */
export async function buildTarsToolsContext(
  params: TarsToolsContextParams,
): Promise<string | undefined> {
  const mounted = new Set(params.tools.filter(isTarsBuiltinToolName));
  if (mounted.size === 0) {
    return undefined;
  }
  if (!params.tarsUserId) {
    return `# TARS tools\n${NOT_LINKED}`;
  }
  const guides = toolGuides(mounted);
  const scope = await listScope({ ...params, tarsUserId: params.tarsUserId }, mounted);
  return ['# TARS tools', ...guides, '', ...scope].join('\n').trim();
}
