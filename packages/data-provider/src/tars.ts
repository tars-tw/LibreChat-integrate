import type {
  TTarsTraceRow,
  TTarsJsonField,
  TTarsMessageTrace,
  TTarsTracePayload,
  TTarsTokenReportRange,
  TTarsEmbeddingSplitBy,
  TTarsEmbeddingGroupBy,
} from './types/tars';
import { Tools } from './types/tools';

/**
 * Shared pwc_tars data-source facts. Both the form in the browser and the
 * proxy in `packages/api` validate against these, so the two can never drift.
 */

/**
 * The application-database kinds the admin page offers.
 *
 * pwc_tars' own dropdown also lists CSV, but no CSV row can be stored:
 * `create_dataset_sql` requires host/port/username/password and
 * `test_connection` has no CSV handler. Oracle has a Service Name / SID toggle
 * upstream, yet neither create nor update reads those columns and every
 * consumer builds `oracle+oracledb://…?service_name={database_name}`, so
 * Oracle is Service-Name-only here.
 */
export const TARS_DATABASE_TYPES = ['PostgreSQL', 'MySQL', 'MSSQL', 'Oracle', 'SQLite'] as const;

export type TTarsDatabaseType = (typeof TARS_DATABASE_TYPES)[number];

/** Ports pwc_tars' form pre-fills. SQLite is file-backed and stores port 1. */
export const TARS_DEFAULT_PORTS: Partial<Record<TTarsDatabaseType, number>> = {
  PostgreSQL: 5432,
  MySQL: 3306,
  MSSQL: 1433,
  Oracle: 1521,
};

export const isTarsDatabaseType = (value: unknown): value is TTarsDatabaseType =>
  TARS_DATABASE_TYPES.includes(value as TTarsDatabaseType);

/** A file-backed connection is defined by its uploaded file, not by a host. */
export const isTarsFileDatabase = (dbType: string | null | undefined): boolean =>
  dbType === 'SQLite';

/** Extensions pwc_tars accepts for a SQLite upload (`ALLOWED_SQLITE_EXTENSIONS`). */
export const TARS_SQLITE_EXTENSIONS = ['.sqlite', '.db', '.sqlite3', '.s3db', '.sl3'];

/**
 * The file-server protocols the document-group page offers
 * (`dataset_file_system.mount_type`). pwc_tars' `test_connection` implements
 * exactly these four and rejects anything else.
 */
export const TARS_FILE_PROTOCOLS = ['SMB', 'FTP', 'SFTP', 'NFS'] as const;

export type TTarsFileProtocol = (typeof TARS_FILE_PROTOCOLS)[number];

/**
 * Ports pwc_tars' own form pre-fills. SFTP is 2022 rather than 22 because the
 * deployment maps the container's SSH port; every value stays editable.
 */
export const TARS_PROTOCOL_DEFAULT_PORTS: Record<TTarsFileProtocol, number> = {
  SMB: 445,
  FTP: 21,
  SFTP: 2022,
  NFS: 2049,
};

export const isTarsFileProtocol = (value: unknown): value is TTarsFileProtocol =>
  TARS_FILE_PROTOCOLS.includes(value as TTarsFileProtocol);

/** NFS authenticates by host export, so it takes no account or password. */
export const tarsProtocolNeedsCredentials = (protocol: string | null | undefined): boolean =>
  protocol === 'SMB' || protocol === 'FTP' || protocol === 'SFTP';

/** Only SMB sends a NetBIOS server name (`host_name`) alongside the address. */
export const tarsProtocolUsesHostName = (protocol: string | null | undefined): boolean =>
  protocol === 'SMB';

/**
 * The `model_profile.type` values the model admin page offers. pwc_tars has
 * normalised every row to CLOUD (provider-hosted) or VLLM (on-premises) — see
 * its `fix_model_profile.sql` — and seeds GOOGLE_VERTEX, which it hides while no
 * Vertex AI key is configured. Older type names still classify there, so a row
 * carrying one keeps it until an admin picks one of these.
 */
export const TARS_MODEL_TYPES = ['CLOUD', 'VLLM', 'GOOGLE_VERTEX'] as const;

export type TTarsModelType = (typeof TARS_MODEL_TYPES)[number];

export const isTarsModelType = (value: unknown): value is TTarsModelType =>
  TARS_MODEL_TYPES.includes(value as TTarsModelType);

/** pwc_tars calls a model's endpoint as an OpenAI-compatible base URL, so it must be absolute http(s). */
export const isTarsModelEndpoint = (value: string | null | undefined): boolean => {
  try {
    const url = new URL((value ?? '').trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
};

/**
 * The native tools that run a whole pwc_tars agent loop per call
 * (`/api/langflow-service/*`). Their replies carry that run's trace, which the
 * chat shows under the tool call the way pwc_tars's own chat does.
 */
export const TARS_CAPABILITY_TOOLS: ReadonlySet<string> = new Set([
  Tools.sql_agent,
  Tools.rag_agent,
  Tools.tars_agent,
  Tools.chart_agent,
  Tools.data_query,
  Tools.table_task,
]);

export const isTarsCapabilityToolName = (toolName: string | undefined | null): boolean =>
  typeof toolName === 'string' && TARS_CAPABILITY_TOOLS.has(toolName);

/**
 * pwc_tars's built-in agent tools, called one at a time
 * (`POST /api/langflow-service/tools/<name>`) so the chat model here runs the
 * loop pwc_tars's own chat would, instead of handing the question to a nested
 * pwc_tars loop. LibreChat tool name → pwc_tars tool name.
 */
export const TARS_BUILTIN_TOOLS = {
  tars_knowledge_search: 'knowledge_search',
  tars_sql_schema: 'sql_schema',
  tars_sql_query: 'sql_query',
  tars_data_schema: 'data_schema',
  tars_data_query: 'data_query',
  tars_create_chart: 'create_chart',
  tars_generate_file: 'generate_file',
  tars_table_task: 'run_table_task',
} as const;

export type TTarsBuiltinToolName = keyof typeof TARS_BUILTIN_TOOLS;

export type TTarsBuiltinTool = (typeof TARS_BUILTIN_TOOLS)[TTarsBuiltinToolName];

export const isTarsBuiltinToolName = (
  toolName: string | undefined | null,
): toolName is TTarsBuiltinToolName =>
  typeof toolName === 'string' &&
  Object.prototype.hasOwnProperty.call(TARS_BUILTIN_TOOLS, toolName);

/** The pwc_tars tool behind a LibreChat tool name; undefined for other tools. */
export const tarsBuiltinToolOf = (
  toolName: string | undefined | null,
): TTarsBuiltinTool | undefined =>
  isTarsBuiltinToolName(toolName) ? TARS_BUILTIN_TOOLS[toolName] : undefined;

/**
 * The switches that mount pwc_tars's built-in tools, named like their
 * `ephemeralAgent` flags. The chat sets them per turn; a saved agent persists
 * the tools themselves in `agent.tools`, so both read this one table. Each
 * switch is independent: file generation is its own switch, not a companion.
 */
export type TTarsToolSwitch = 'rag_agent' | 'sql_agent' | 'chart_agent' | 'file_agent';

export const TARS_SWITCH_TOOLS: Readonly<Record<TTarsToolSwitch, readonly TTarsBuiltinToolName[]>> =
  {
    rag_agent: ['tars_knowledge_search'],
    sql_agent: ['tars_sql_schema', 'tars_sql_query'],
    chart_agent: ['tars_create_chart'],
    file_agent: ['tars_generate_file'],
  };

export const TARS_TOOL_SWITCHES = Object.keys(TARS_SWITCH_TOOLS) as TTarsToolSwitch[];

/**
 * pwc_tars plugin tools (`tars_tool_sdk`). An admin switches each plugin on per
 * brain inside `sys_domain.domain_functions` under `plugin:<name>`, next to the
 * built-in features; the chat only offers what that block enables. The helpers
 * below are shared by the browser (dropdown, brain editor) and `packages/api`
 * (tool naming, server-side allowlist) so the two never disagree on a key.
 */

/** LibreChat tool-name prefix; the pwc_tars plugin name follows it verbatim. */
export const TARS_PLUGIN_TOOL_PREFIX = 'tars_plugin_';

/** `domain_functions` key prefix pwc_tars uses (`SysConst.DOMAIN_FUNCTION_PLUGIN_PREFIX`). */
export const TARS_PLUGIN_FUNCTION_PREFIX = 'plugin:';

/** Marker pwc_tars' own editor writes so its chat can recognise plugin entries. */
export const TARS_PLUGIN_FUNCTION_KIND = 'plugin';

/** The two switches a brain carries for one plugin tool. */
export type TTarsPluginFunctionState = {
  enabled: boolean;
  default_value: boolean;
};

/** One `plugin:<name>` entry of `domain_functions`, as pwc_tars' editor stores it. */
export type TTarsPluginFunction = TTarsPluginFunctionState & {
  kind: typeof TARS_PLUGIN_FUNCTION_KIND;
  name: string;
  display_name: string;
  description: string;
};

/** The LibreChat tool name of a pwc_tars plugin. */
export const tarsPluginToolName = (pluginName: string): string =>
  `${TARS_PLUGIN_TOOL_PREFIX}${pluginName}`;

export const isTarsPluginToolName = (toolName: string | undefined | null): boolean =>
  typeof toolName === 'string' &&
  toolName.length > TARS_PLUGIN_TOOL_PREFIX.length &&
  toolName.startsWith(TARS_PLUGIN_TOOL_PREFIX);

/** The pwc_tars plugin name behind a LibreChat tool name; undefined for other tools. */
export const tarsPluginNameFromToolName = (toolName: string): string | undefined =>
  isTarsPluginToolName(toolName) ? toolName.slice(TARS_PLUGIN_TOOL_PREFIX.length) : undefined;

export const tarsPluginFunctionKey = (pluginName: string): string =>
  `${TARS_PLUGIN_FUNCTION_PREFIX}${pluginName}`;

/** Plugin names out of an untrusted `ephemeralAgent.tars_plugins`: strings only, trimmed, deduped. */
export const tarsPluginNamesOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const name = item.trim();
    if (name) {
      names.add(name);
    }
  }
  return Array.from(names);
};

type DomainFunctionsBlock = Record<string, unknown>;

const parseDomainFunctionsBlock = (raw: string | null | undefined): DomainFunctionsBlock => {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as DomainFunctionsBlock)
      : {};
  } catch {
    return {};
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

/**
 * The plugin entries of a brain's `domain_functions`, keyed off the `plugin:`
 * prefix rather than the `kind` marker so an entry written back by a tool
 * that only knows the key (e.g. the embedded-site disable pass) still parses.
 */
export const parseTarsPluginFunctions = (
  domainFunctions: string | null | undefined,
): TTarsPluginFunction[] => {
  const block = parseDomainFunctionsBlock(domainFunctions);
  const entries: TTarsPluginFunction[] = [];
  for (const [key, value] of Object.entries(block)) {
    if (!key.startsWith(TARS_PLUGIN_FUNCTION_PREFIX) || !isRecord(value)) {
      continue;
    }
    const name =
      typeof value.name === 'string' && value.name
        ? value.name
        : key.slice(TARS_PLUGIN_FUNCTION_PREFIX.length);
    if (!name) {
      continue;
    }
    const enabled = value.enabled === true;
    entries.push({
      kind: TARS_PLUGIN_FUNCTION_KIND,
      name,
      enabled,
      default_value: enabled && value.default_value === true,
      display_name:
        typeof value.display_name === 'string' && value.display_name ? value.display_name : name,
      description: typeof value.description === 'string' ? value.description : '',
    });
  }
  return entries;
};

/** Plugin tools a brain offers in chat (switched on by the admin). */
export const enabledTarsPluginFunctions = (
  domainFunctions: string | null | undefined,
): TTarsPluginFunction[] =>
  parseTarsPluginFunctions(domainFunctions).filter((entry) => entry.enabled);

/** What a plugin entry needs from the scanned tool listing to be written. */
export type TTarsPluginFunctionSource = {
  name: string;
  display_name?: string;
  description?: string;
  /** Tools that failed pwc_tars' conformance check are never written. */
  ok?: boolean;
};

/**
 * Writes the plugin switches into a brain's `domain_functions`, replacing every
 * existing `plugin:*` entry (so a plugin removed from the folder drops out) and
 * leaving the built-in feature keys untouched. Mirrors pwc_tars'
 * `pluginFunctionEntries`: only conformant tools are written, and a plugin that
 * is not shown cannot be on by default.
 */
export const mergeTarsPluginFunctions = (
  domainFunctions: string | null | undefined,
  tools: TTarsPluginFunctionSource[],
  states: Record<string, Partial<TTarsPluginFunctionState> | undefined>,
): string => {
  const block = parseDomainFunctionsBlock(domainFunctions);
  const next: DomainFunctionsBlock = {};
  for (const [key, value] of Object.entries(block)) {
    if (!key.startsWith(TARS_PLUGIN_FUNCTION_PREFIX)) {
      next[key] = value;
    }
  }
  for (const tool of tools) {
    if (tool.ok === false || !tool.name) {
      continue;
    }
    const state = states[tool.name];
    const enabled = state?.enabled === true;
    const entry: TTarsPluginFunction = {
      kind: TARS_PLUGIN_FUNCTION_KIND,
      name: tool.name,
      enabled,
      default_value: enabled && state?.default_value === true,
      display_name: tool.display_name || tool.name,
      description: tool.description ?? '',
    };
    next[tarsPluginFunctionKey(tool.name)] = entry;
  }
  return JSON.stringify(next);
};

/**
 * pwc_tars reserves `sys_domain` id 100 for the general brain (通用腦) in its seed data
 * (`sql/2_insert_values/sys_domain.sql`: 150+ is agent-specific, 201+ is custom), so the
 * id is the reliable identifier — admins rename the domain freely.
 */
export const TARS_GENERAL_DOMAIN_ID = 100;

/**
 * Name of the custom endpoint serving pwc_tars local (vLLM) models — the one whose
 * `baseURL` is `tars://local` in librechat.yaml. The client never sees the base URL,
 * so it identifies the endpoint by this name; keep the two in step.
 */
export const TARS_LOCAL_ENDPOINT_NAME = 'vLLM';

/** Whether an endpoint name is the pwc_tars local (vLLM) endpoint. */
export const isTarsLocalEndpointName = (endpoint: string | null | undefined): boolean =>
  endpoint === TARS_LOCAL_ENDPOINT_NAME;

/**
 * The librechat.yaml `mcpServers` key the Langflow flows are published under. It is
 * product-facing: the agent builder's tool library and every chat tool-call card show it, and
 * it suffixes each flow's tool name (`<flow>_mcp_workflow`), so it carries the Workflow name
 * rather than the Langflow brand.
 */
export const TARS_WORKFLOW_MCP_SERVER_NAME = 'workflow';

/** Langflow flows are mirrored into agents under this id prefix (`packages/api/src/langflow/sync.ts`). */
export const TARS_LANGFLOW_AGENT_ID_PREFIX = 'agent_langflow_';

/** Whether an agent id names a Workflow agent mirrored from a Langflow flow. */
export const isTarsLangflowAgentId = (agentId: string | null | undefined): boolean =>
  agentId?.startsWith(TARS_LANGFLOW_AGENT_ID_PREFIX) === true;

/**
 * pwc_tars `SysConst` message statuses: how a message ended. LibreChat writes them
 * when it mirrors a turn and the audit report reads them back.
 */
export const TARS_MESSAGE_STATUS = { success: 1, failed: 2, interrupted: 3 } as const;

/**
 * `message_execution_trace.event_type` values (pwc_tars `agent_core/events.py`).
 * LibreChat builds these rows for the chats it mirrors and the audit timeline
 * reads them, so both sides name them from here.
 */
export const TARS_TRACE_EVENT = {
  request: 'request',
  requestRaw: 'request_raw',
  provenance: 'provenance',
  memoryContext: 'memory_context',
  longTermMemory: 'long_term_memory',
  toolContextReplay: 'tool_context_replay',
  turn: 'turn',
  thinking: 'thinking',
  text: 'text',
  toolCall: 'tool_call',
  toolResult: 'tool_result',
  usage: 'usage',
  messageStop: 'message_stop',
  status: 'status',
  error: 'error',
  langflowRoute: 'langflow_route',
  ragRetrieval: 'rag_retrieval',
  plan: 'plan',
  clarification: 'clarification',
  suggestedQuestions: 'suggested_questions',
  regenerateNotApplied: 'regenerate_not_applied',
} as const;

/**
 * How a trace field is read: `text` takes a string (a number is stringified,
 * as ids may be numeric), `scalar` a string or number, `texts` a list of
 * those, `object` any plain object as-is, `json` any value, `list` / `item`
 * plain objects read by their own fields. A value of the wrong kind is dropped.
 */
type TraceFieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'scalar'
  | 'texts'
  | 'object'
  | 'json'
  | { list: TraceSchema }
  | { item: TraceSchema };

type TraceSchema = { readonly [key: string]: TraceFieldKind };

type PlainObject = { [key: string]: TTarsJsonField };

const isPlainObject = (value: unknown): value is PlainObject =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const traceText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
};

const traceNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function readTraceField(kind: TraceFieldKind, value: unknown): TTarsJsonField | undefined {
  if (value === undefined) {
    return undefined;
  }
  switch (kind) {
    case 'text':
      return traceText(value);
    case 'number':
      return traceNumber(value);
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'scalar':
      return typeof value === 'string' ? value : traceNumber(value);
    case 'texts':
      return Array.isArray(value)
        ? value.map(traceText).filter((item): item is string => item !== undefined)
        : undefined;
    case 'object':
      return isPlainObject(value) ? (value as TTarsJsonField) : undefined;
    case 'json':
      return value as TTarsJsonField;
    default:
      if ('list' in kind) {
        return Array.isArray(value)
          ? value.filter(isPlainObject).map((item) => readTraceFields(item, kind.list))
          : undefined;
      }
      return isPlainObject(value) ? readTraceFields(value, kind.item) : undefined;
  }
}

/** A copy of `source` whose schema fields have the kind the schema names; other keys pass through. */
function readTraceFields(
  source: PlainObject,
  schema: TraceSchema,
): { [key: string]: TTarsJsonField } {
  const result: { [key: string]: TTarsJsonField } = {};
  for (const [key, value] of Object.entries(source)) {
    const kind = schema[key];
    const read =
      kind && Object.prototype.hasOwnProperty.call(schema, key)
        ? readTraceField(kind, value)
        : value;
    if (read !== undefined && read !== null) {
      result[key] = read;
    }
  }
  return result;
}

const TRACE_REQUEST_BODY_SCHEMA: TraceSchema = {
  reasoning_effort: 'text',
  upload_filename: 'text',
  upload_files: { list: { file_id: 'text', filename: 'text' } },
  is_database_bound: 'boolean',
  is_enable_web_search: 'boolean',
  is_file_generate_active: 'boolean',
  file_generate_type: 'text',
  file_generate_extra_prompt: 'text',
  file_generate_footer_text: 'text',
  file_generate_style_spec: 'json',
  is_enable_suggested_questions: 'boolean',
  is_mcp_enabled: 'boolean',
  is_enable_langflow: 'boolean',
  is_regenerate: 'boolean',
};

/** Every `TTarsTracePayload` field the audit panel reads, by the kind its type declares. */
const TRACE_PAYLOAD_SCHEMA: TraceSchema = {
  ...Object.fromEntries(
    [
      'type',
      'source',
      'timing',
      'text',
      'output',
      'summary',
      'error_message',
      'query',
      'domain_name',
      'system_version',
      'sql_schema_injected',
      'model_name',
      'model_endpoint',
      'milvus_url',
      'rerank_backend',
      'rerank_model_name',
      'question',
      'finish_reason',
      'error_code',
      'message',
      'kind',
    ].map((key) => [key, 'text']),
  ),
  ...Object.fromEntries(
    [
      'model_output_limit',
      'output_len_chars',
      'status',
      'input_tokens',
      'output_tokens',
      'payload_original_chars',
      'temperature',
      'image_input_count',
      'retrieval_ms',
      'entry_count',
      'total_documents',
      'count',
      'wait_ms',
      'invoke_ms',
      'total_ms',
      'join_ms',
      'turn',
      'turn_index',
    ].map((key) => [key, 'number']),
  ),
  ...Object.fromEntries(
    ['truncated', 'aborted', 'payload_truncated', 'native_tool_calling', 'context_available'].map(
      (key) => [key, 'boolean'],
    ),
  ),
  ...Object.fromEntries(
    [
      'sources',
      'database_names',
      'knowledge_base_names',
      'langflow_names',
      'available_tools',
      'data_files',
      'degradation_notes',
    ].map((key) => [key, 'texts']),
  ),
  input: 'json',
  milvus_port: 'scalar',
  model_kwargs: 'object',
  channel_weights: 'object',
  payload: { item: TRACE_REQUEST_BODY_SCHEMA },
  retrieval_params: {
    item: { rerank_floor_ratio: 'number', score_threshold: 'number', default_limit: 'number' },
  },
  floor_filter: { item: { threshold: 'scalar' } },
  mcp_servers: { list: { name: 'text' } },
  embedding_profiles: {
    list: {
      kb_id: 'text',
      kb_name: 'text',
      embedding_model_name: 'text',
      embedding_dims: 'number',
    },
  },
  records: {
    list: { memory_type: 'text', score: 'scalar', content: 'text', created_at: 'text' },
  },
  documents: {
    list: {
      id: 'text',
      file_id: 'text',
      filename: 'text',
      injected_as: 'text',
      milvus_pk: 'scalar',
    },
  },
  websites: { list: { name: 'text' } },
  rerank_by_kb: { list: { candidates_in: 'number', backend: 'text' } },
  channel_hits: { list: { milvus_pk: 'scalar' } },
  options: { list: { label: 'text' } },
  items: { list: { status: 'text', content: 'text' } },
};

const nullableText = (value: unknown): string | null => traceText(value) ?? null;

/** One trace row, or null when it is not an object; a missing id or order falls back to its position. */
function normalizeTraceRow(raw: unknown, index: number): TTarsTraceRow | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const row: TTarsTraceRow = {
    id: traceText(raw.id) ?? `row-${index}`,
    seq: traceNumber(raw.seq) ?? index,
    message_id: traceText(raw.message_id) ?? '',
    event_type: traceText(raw.event_type) ?? '',
    turn: traceNumber(raw.turn) ?? null,
    tool_name: nullableText(raw.tool_name),
    tool_use_id: nullableText(raw.tool_use_id),
    parent_id: nullableText(raw.parent_id),
    attempt: traceNumber(raw.attempt) ?? 1,
    retry_of: nullableText(raw.retry_of),
    started_at: nullableText(raw.started_at),
    ended_at: nullableText(raw.ended_at),
    duration_ms: traceNumber(raw.duration_ms) ?? null,
    ok: typeof raw.ok === 'boolean' ? raw.ok : null,
    payload: isPlainObject(raw.payload)
      ? (readTraceFields(raw.payload, TRACE_PAYLOAD_SCHEMA) as TTarsTracePayload)
      : null,
  };
  for (const key of ['created_at', 'user_id', 'conversation_id', 'domain_id'] as const) {
    if (raw[key] !== undefined) {
      row[key] = nullableText(raw[key]);
    }
  }
  return row;
}

/**
 * A message trace as pwc_tars serves it (`get_message_execution_trace` → `data`),
 * with every field the audit panel reads held to the kind its type declares:
 * rows that are not objects are dropped, and a field of the wrong kind is
 * dropped or defaulted, so a reader can trust the types instead of re-checking
 * each value. Null when there is no message at all.
 */
export function normalizeTarsMessageTrace(raw: unknown): TTarsMessageTrace | null {
  if (!isPlainObject(raw) || !isPlainObject(raw.message)) {
    return null;
  }
  const message = raw.message;
  const user = raw.user;
  return {
    message: {
      id: traceText(message.id) ?? '',
      conversation_id: nullableText(message.conversation_id),
      model_name: nullableText(message.model_name),
      created_at: nullableText(message.created_at),
      ip_addr: nullableText(message.ip_addr),
      query: nullableText(message.query),
      response: nullableText(message.response),
      status: traceNumber(message.status) ?? null,
      error_message: nullableText(message.error_message),
      response_latency: traceNumber(message.response_latency) ?? null,
    },
    user: isPlainObject(user)
      ? {
          id: traceText(user.id) ?? '',
          username: nullableText(user.username),
          email: nullableText(user.email),
          user_groups: Array.isArray(user.user_groups)
            ? user.user_groups.filter(isPlainObject).map((group) => ({
                id: traceText(group.id) ?? '',
                name: traceText(group.name) ?? '',
              }))
            : [],
        }
      : null,
    trace: Array.isArray(raw.trace)
      ? raw.trace.map(normalizeTraceRow).filter((row): row is TTarsTraceRow => row !== null)
      : [],
    unapplied_regenerate_count: traceNumber(raw.unapplied_regenerate_count) ?? 0,
    conversation_history: Array.isArray(raw.conversation_history)
      ? raw.conversation_history
          .filter(isPlainObject)
          .map((entry) => ({ role: traceText(entry.role) ?? '', content: entry.content ?? null }))
      : [],
  };
}

/**
 * Embedding usage report facts (pwc_tars `embedding_usage_log`). The report page
 * and the admin proxy in `packages/api` validate against these.
 */

/** What a report can be broken down by, in the order the report page offers them. */
export const TARS_EMBEDDING_DIMENSIONS: readonly TTarsEmbeddingSplitBy[] = [
  'purpose',
  'domain',
  'knowledge_base',
  'model',
];

/** Every `group_by` pwc_tars accepts; only `day` can be split by a dimension. */
export const TARS_EMBEDDING_GROUP_BY: readonly TTarsEmbeddingGroupBy[] = [
  'day',
  ...TARS_EMBEDDING_DIMENSIONS,
];

/** The longest range pwc_tars summarizes (`MAX_RANGE_DAYS` in `embedding_usage_report.py`). */
export const TARS_EMBEDDING_MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;

export function isTarsEmbeddingGroupBy(value: unknown): value is TTarsEmbeddingGroupBy {
  return (
    typeof value === 'string' && (TARS_EMBEDDING_GROUP_BY as readonly string[]).includes(value)
  );
}

export function isTarsEmbeddingSplitBy(value: unknown): value is TTarsEmbeddingSplitBy {
  return (
    typeof value === 'string' && (TARS_EMBEDDING_DIMENSIONS as readonly string[]).includes(value)
  );
}

/** Whether a range covers more days than pwc_tars summarizes, counting both ends. */
export function isTarsEmbeddingRangeTooLong({ start_date, end_date }: TTarsTokenReportRange) {
  return (
    (Date.parse(end_date) - Date.parse(start_date)) / DAY_MS + 1 > TARS_EMBEDDING_MAX_RANGE_DAYS
  );
}
