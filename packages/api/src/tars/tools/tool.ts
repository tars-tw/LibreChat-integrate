import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import {
  TARS_BUILTIN_TOOLS,
  tarsToolSwitchOf,
  tarsBuiltinToolOf,
  isTarsBuiltinToolName,
  isTarsSourceDownloadEnabled,
} from 'librechat-data-provider';
import type {
  AgentCapabilities,
  TTarsToolStep,
  TTarsToolSource,
  TTarsToolSwitch,
  TTarsBuiltinTool,
  TTarsAgentKnowledgeBases,
} from 'librechat-data-provider';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { JsonSchemaType } from '@librechat/data-schemas';
import type { TarsBuiltinToolContext, TarsBuiltinToolResult } from './client';
import type { TarsProgressReporter, TarsToolRunConfig } from './progress';
import type { TarsBuiltinManifest } from '~/tars/plugins/client';
import type { LangflowToolResult } from '~/tars/langflow/client';
import type { TarsRagKnowledgeBase } from '~/tars/rag/client';
import type { TarsSqlDatabase } from '~/tars/sql/client';
import type { TarsKnowledgeScope } from '~/tars/scope';
import type { TarsDataFile } from '~/tars/files/sign';
import {
  langflowToolResult,
  tarsUsageAttribution,
  resolveLangflowModelName,
  LANGFLOW_TOOL_RESPONSE_FORMAT,
} from '~/tars/langflow/client';
import { listTarsRagKnowledgeBases, resolveTarsKnowledgeBaseIds } from '~/tars/rag/client';
import { getTarsBuiltinManifest, primeTarsBuiltinManifests } from '~/tars/plugins/client';
import { TARS_DATABASE_SWITCH_TOOL, tarsBuiltinToolCapability } from './names';
import { TARS_NOT_LINKED, tarsBuiltinToolFailureText } from '~/tars/failure';
import { normalizeJsonSchema, resolveJsonSchemaRefs } from '~/mcp/zod';
import { TarsRequestError, isTarsConfigured } from '~/tars/client';
import { toTarsDataFileRefsContext } from '~/tars/files/sign';
import { resolveTarsDatabaseId } from '~/tars/agent/client';
import { listTarsSqlDatabases } from '~/tars/sql/client';
import { resolveTarsSourceLinks } from '~/tars/sources';
import { recordTarsToolAuditTrace } from './auditTrace';
import { rewriteTarsAssetLinks } from '~/tars/assets';
import { tarsSwitchScope } from '~/tars/scope';
import { recordTarsCallUsage } from './usage';
import { runTarsBuiltinTool } from './client';

/** LibreChat-side arguments that narrow what a call reaches; never forwarded as tool inputs. */
const KNOWLEDGE_ARG = 'knowledge_base_ids';
const DATABASE_ARG = 'database_knowledge_base_id';

/** How pwc_tars's `build_sources` joins the chunks one file contributed. */
const CHUNK_SEPARATOR = '\n\n---\n\n';
const SOURCE_EXCERPT_CHARS = 280;
/** A result table or schema listing is shown on the card; anything longer is cut there only. */
const OUTPUT_DISPLAY_CHARS = 6_000;

const NOT_LINKED = `${TARS_NOT_LINKED}, so TARS tools cannot run.`;

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
  /**
   * Active 專用腦. Narrows knowledge bases and databases only without a saved agent, and
   * always for the tools no switch mounts (the table task, the spreadsheet tools).
   */
  domainId?: string | number | null;
  /**
   * A saved agent's picks per switch; each switch's tool reaches its own picks, never the
   * brain. Undefined for a chat without a saved agent.
   */
  agentKnowledgeBases?: TTarsAgentKnowledgeBases;
  /** The turn's tools; without a saved agent, charts and files reach the database only while it is switched on. */
  agentTools?: readonly string[];
  /** The saved agent the turn runs; the download links of cited files name it. */
  agentId?: string;
  /** The agent's 參考資料下載 switch (`tars_source_download`). */
  sourceDownload?: boolean;
  /** The thread's spreadsheets (csv / xlsx / xls LibreChat uploads). */
  dataFiles?: TarsDataFile[] | null;
  /** Model the chat turn runs on; a tool that calls a model itself inherits it. */
  model?: string;
  librechatUserId?: string;
  /** The user's current message, offered to the tool as `ctx.question`. */
  question?: string;
  /** Relays the progress the tool reports to its card while it runs (host-bound). */
  reportProgress?: TarsProgressReporter;
  /**
   * The request the turn's audit-only trace records are kept on, for the mirror
   * to add to its execution trace; without it they are not asked for.
   */
  auditTraceOwner?: object;
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

type ScopeOptions = Pick<TarsBuiltinToolOptions, 'toolName' | 'agentKnowledgeBases' | 'domainId'>;

/** The switch whose picks a tool reaches on a saved agent; undefined when the brain decides. */
const pickedSwitchOf = (options: ScopeOptions): TTarsToolSwitch | undefined =>
  options.agentKnowledgeBases ? tarsToolSwitchOf(options.toolName) : undefined;

/** Where a tool's knowledge bases and databases come from: its switch's picks, else the brain. */
const scopeOf = (options: ScopeOptions): TarsKnowledgeScope => {
  const toolSwitch = pickedSwitchOf(options);
  return toolSwitch
    ? tarsSwitchScope(options.agentKnowledgeBases, toolSwitch, options.domainId)
    : options.domainId;
};

const NO_PICKED_KNOWLEDGE =
  'This agent picked no knowledge base for this tool that this user may use in chat, so there is nothing to search.';
const NO_PICKED_DATABASE =
  'This agent picked no database for this tool that this user may use in chat, so there is nothing to query.';

async function bindKnowledgeBases(
  manifest: TarsBuiltinManifest,
  options: TarsBuiltinToolOptions & { tarsUserId: string },
  requested: unknown,
): Promise<string | undefined> {
  if (!needsContext(manifest, 'knowledge_base_ids')) {
    return undefined;
  }
  const bases = await listTarsRagKnowledgeBases(options.tarsUserId, scopeOf(options));
  const ids = resolveTarsKnowledgeBaseIds(bases, asStrings(requested));
  if (!ids.length && requiresContext(manifest, 'knowledge_base_ids')) {
    throw new Error(
      pickedSwitchOf(options)
        ? NO_PICKED_KNOWLEDGE
        : 'The active brain binds no knowledge base this user may use in chat (none is bound, or the user is on none of their chat lists), so there is nothing to search.',
    );
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
  const picked = pickedSwitchOf(options) != null;
  /** On a saved agent each tool has its own picks; without one, charts and files follow 資料庫查詢. */
  const switchedOn =
    required || picked || options.agentTools?.includes(TARS_DATABASE_SWITCH_TOOL) === true;
  if (!switchedOn) {
    if (requestedId) {
      throw new Error('No database is switched on for this turn, so none can be queried.');
    }
    return undefined;
  }
  const databases = await listTarsSqlDatabases(options.tarsUserId, scopeOf(options));
  if (!databases.length && !required) {
    if (requestedId) {
      throw new Error(NO_PICKED_DATABASE);
    }
    return undefined;
  }
  const id = resolveTarsDatabaseId(databases, requestedId);
  if (id || !required) {
    return id;
  }
  if (databases.length > 1) {
    throw new Error(`Several databases are available; name one as \`${DATABASE_ARG}\`.`);
  }
  throw new Error(
    picked
      ? NO_PICKED_DATABASE
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
  const dataFileRefs = needsContext(manifest, 'data_file_refs')
    ? toTarsDataFileRefsContext(options.dataFiles, options.librechatUserId)
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
  if (dataFileRefs) {
    context.data_file_refs = dataFileRefs;
  }
  return { inputs, context };
}

/**
 * Asks for the cited names verbatim: the chat turns the names after 資料來源
 * into download links by matching them, so the model never handles the links.
 */
function sourceNamesNote(links: ReadonlyMap<string, string>): string | undefined {
  if (links.size === 0) {
    return undefined;
  }
  const names = [...links.keys()].map((name) => `- ${name}`).join('\n');
  return (
    '以下來源檔案可供使用者下載。回覆最後請以「資料來源：」列出引用的檔案，' +
    `檔名照下列寫法一字不差（副檔名可省略），系統會自動加上下載連結：\n${names}`
  );
}

/**
 * What the model reads. pwc_tars usually embeds the links to what it
 * generated; one it left out is appended so the model can still pass it on,
 * and every link is routed through LibreChat's relay.
 */
function toModelText(
  result: TarsBuiltinToolResult,
  sourceLinks: ReadonlyMap<string, string>,
): string {
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
  const note = result.is_error ? undefined : sourceNamesNote(sourceLinks);
  if (note) {
    parts.push(note);
  }
  const body = parts.join('\n\n') || '(the tool returned no output)';
  return rewriteTarsAssetLinks(result.is_error ? `The tool reported an error: ${body}` : body);
}

function toSources(
  result: TarsBuiltinToolResult,
  sourceLinks: ReadonlyMap<string, string>,
): TTarsToolSource[] {
  const sources: TTarsToolSource[] = [];
  for (const source of result.sources) {
    if (!source.filename || source.type === 'web') {
      continue;
    }
    const content = source.content ?? '';
    const url = sourceLinks.get(source.filename);
    sources.push({
      filename: source.filename,
      chunks: content ? content.split(CHUNK_SEPARATOR).length : 0,
      ...(content ? { excerpt: content.slice(0, SOURCE_EXCERPT_CHARS) } : {}),
      ...(url ? { url } : {}),
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
  sourceLinks: ReadonlyMap<string, string>,
): TTarsToolStep {
  const sources = toSources(result, sourceLinks);
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

/**
 * Download links for the files a knowledge search cited, by file name. Only
 * for a saved agent whose 參考資料下載 switch is on; empty otherwise, which
 * leaves the answer exactly as it was without the switch.
 */
function sourceLinksFor(
  builtin: TTarsBuiltinTool,
  result: TarsBuiltinToolResult,
  context: TarsBuiltinToolContext,
  options: TarsBuiltinToolOptions,
): Promise<Map<string, string>> {
  const enabled =
    builtin === TARS_BUILTIN_TOOLS.tars_knowledge_search &&
    !result.is_error &&
    isTarsSourceDownloadEnabled({
      tools: options.agentTools,
      tars_source_download: options.sourceDownload,
    });
  if (!enabled || !options.agentId || !context.knowledge_base_ids) {
    return Promise.resolve(new Map());
  }
  return resolveTarsSourceLinks({
    agentId: options.agentId,
    knowledgeBaseIds: context.knowledge_base_ids.split(','),
    filenames: result.sources
      .filter((source) => source.type !== 'web')
      .map((source) => source.filename ?? ''),
  });
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
          usage: tarsUsageAttribution(options.domainId, config),
          onProgress: (message) => options.reportProgress?.(message, config),
          signal: config?.signal,
          auditTrace: options.auditTraceOwner != null,
        });
        const toolCallId = config?.toolCall?.id;
        if (options.auditTraceOwner && toolCallId) {
          recordTarsToolAuditTrace(options.auditTraceOwner, toolCallId, result.audit_trace ?? []);
        }
        recordTarsCallUsage(options.auditTraceOwner, config, result.tokens);
        const sourceLinks = await sourceLinksFor(builtin, result, context, options);
        const text = toModelText(result, sourceLinks);
        return langflowToolResult(text, {
          trace: [],
          step: toStep(builtin, result, text, sourceLinks),
        });
      } catch (error) {
        const message = toErrorMessage(error);
        return langflowToolResult(tarsBuiltinToolFailureText(options.toolName, message), {
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
  /** A saved agent's picks per switch; undefined for a chat without one. */
  agentKnowledgeBases?: TTarsAgentKnowledgeBases;
  /** The turn's tools after gating; only the `tars_*` built-ins among them count. */
  tools: readonly string[];
}

/** The database switches, with the tools each mounts as the context names them. */
const DATABASE_TOOLS: ReadonlyArray<[TTarsToolSwitch, string, string]> = [
  ['sql_agent', TARS_DATABASE_SWITCH_TOOL, 'tars_sql_schema / tars_sql_query'],
  ['chart_agent', 'tars_create_chart', 'tars_create_chart'],
  ['file_agent', 'tars_generate_file', 'tars_generate_file'],
];

const knowledgeLine = (base: TarsRagKnowledgeBase) =>
  base.description
    ? `- ${base.name}（knowledge_base_id: ${base.knowledge_base_id}）— ${base.description}`
    : `- ${base.name}（knowledge_base_id: ${base.knowledge_base_id}）`;

const databaseLine = (db: TarsSqlDatabase) =>
  `- ${db.name}（knowledge_base_id: ${db.knowledge_base_id}）`;

/** One saved-agent tool's databases: picked, and on the acting user's chat list. */
function pickedDatabaseLines(names: string, databases: TarsSqlDatabase[]): string[] {
  if (databases.length === 1) {
    return [`${names} 的資料庫：${databases[0].name}（自動使用，不必指定）。`];
  }
  if (databases.length > 1) {
    return [
      `${names} 可用的資料庫（呼叫時用 \`database_knowledge_base_id\` 指定要查哪一個）：`,
      ...databases.map(databaseLine),
    ];
  }
  return [`${names}：Agent 沒有選擇這位使用者可在聊天使用的資料庫。`];
}

/** What a saved agent's tools reach: each switch its own picks; the table task the brain's. */
async function listPickedScope(
  params: TarsToolsContextParams & { tarsUserId: string },
  picks: TTarsAgentKnowledgeBases,
  mounted: Set<string>,
): Promise<string[]> {
  const searches = mounted.has('tars_knowledge_search');
  const tableTask = mounted.has('tars_table_task');
  const databaseTools = DATABASE_TOOLS.filter(([, tool]) => mounted.has(tool));
  const [bases, tableBases, databases] = await Promise.all([
    searches
      ? listTarsRagKnowledgeBases(params.tarsUserId, tarsSwitchScope(picks, 'rag_agent', null))
      : [],
    tableTask ? listTarsRagKnowledgeBases(params.tarsUserId, params.domainId) : [],
    Promise.all(
      databaseTools.map(([toolSwitch]) =>
        listTarsSqlDatabases(params.tarsUserId, tarsSwitchScope(picks, toolSwitch, null)),
      ),
    ),
  ]);
  const lines: string[] = [];
  if (searches) {
    lines.push(
      bases.length
        ? '知識庫（預設全部搜尋，可用 `knowledge_base_ids` 縮小範圍）：'
        : 'Agent 沒有選擇這位使用者可在聊天使用的知識庫。',
      ...bases.map(knowledgeLine),
    );
  }
  if (tableTask) {
    lines.push(
      tableBases.length
        ? 'tars_table_task 使用的知識庫：'
        : 'tars_table_task：目前的專用腦沒有綁定知識庫。',
      ...tableBases.map(knowledgeLine),
    );
  }
  databaseTools.forEach(([, , names], index) => {
    lines.push(...pickedDatabaseLines(names, databases[index]));
  });
  return lines;
}

async function listScope(
  params: TarsToolsContextParams & { tarsUserId: string },
  mounted: Set<string>,
): Promise<string[]> {
  if (params.agentKnowledgeBases) {
    return listPickedScope(params, params.agentKnowledgeBases, mounted);
  }
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
      ...bases.map(knowledgeLine),
    );
  }
  if (wantsDatabases && databases.length === 1) {
    lines.push(`資料庫：${databases[0].name}（自動使用，不必指定）。`);
  } else if (wantsDatabases && databases.length > 1) {
    lines.push(
      '資料庫（呼叫時用 `database_knowledge_base_id` 指定要查哪一個）：',
      ...databases.map(databaseLine),
    );
  } else if (wantsDatabases) {
    lines.push('目前的專用腦沒有綁定資料庫。');
  }
  return lines;
}

/**
 * The runtime context for the turn's TARS tools: pwc_tars's usage guide for
 * the ones mounted, then what they reach — a saved agent's picks per tool, or
 * without one, what the active 專用腦 binds. Undefined
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
