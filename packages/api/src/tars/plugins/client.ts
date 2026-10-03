import { logger } from '@librechat/data-schemas';
import type { JsonSchemaType } from '@librechat/data-schemas';
import type { TarsHistoryMessage } from './context';
import {
  langflowTimeoutMs,
  langflowServiceFetch,
  resolveLangflowModelName,
  TARS_CAPABILITY_DEFAULT_TIMEOUT_MS,
} from '~/tars/langflow/client';
import { runTarsServiceTool } from '~/tars/tools/client';
import { tarsFetch } from '~/tars/client';

const PLUGIN_TOOLS_PATH = '/api/domain_settings/plugin_tools';
const PLUGIN_TOOLS_RELOAD_PATH = '/api/domain_settings/plugin_tools/reload';
const SERVICE_TOOLS_PATH = '/api/langflow-service/tools';
const PLUGIN_KIND = 'plugin';
const BUILTIN_KIND = 'builtin';

const LISTING_TIMEOUT_MS = 15_000;
/**
 * The manifest listing also health-checks pwc_tars' model profiles, so it is
 * cached rather than fetched per turn; an admin "rescan" drops the cache.
 */
const MANIFESTS_TTL_MS = 5 * 60_000;

/**
 * A plugin tool as the admin listing reports it (`GET /plugin_tools`): every
 * file the loader saw, conformant or not, with the reasons a rejected one
 * cannot be enabled.
 */
export interface TarsPluginTool {
  name: string;
  function_key: string;
  display_name: string;
  description: string;
  version: string;
  requires: string[];
  source: string;
  ok: boolean;
  problems: string[];
}

export interface TarsPluginToolsListing {
  plugin_tools: TarsPluginTool[];
  plugin_dirs: string[];
  errors: string[];
}

interface PluginToolsPayload {
  plugin_tools?: TarsPluginTool[];
  plugin_dirs?: string[];
  errors?: string[];
}

const toListing = (payload: PluginToolsPayload | undefined): TarsPluginToolsListing => ({
  plugin_tools: payload?.plugin_tools ?? [],
  plugin_dirs: payload?.plugin_dirs ?? [],
  errors: payload?.errors ?? [],
});

/** The plugin folders' contents with each tool's conformance result. */
export async function fetchTarsPluginTools(baseUrl?: string): Promise<TarsPluginToolsListing> {
  const payload = await tarsFetch<PluginToolsPayload>(PLUGIN_TOOLS_PATH, {
    baseUrl,
    timeoutMs: LISTING_TIMEOUT_MS,
  });
  return toListing(payload);
}

/**
 * Re-scans the plugin folders. pwc_tars gates this on an admin `user_id`
 * because loading a plugin executes its module code; LibreChat gates the route
 * with `requireTarsAdmin` on top. The manifests are dropped so the next chat
 * turn sees the new files too.
 */
export async function reloadTarsPluginTools(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsPluginToolsListing> {
  const payload = await tarsFetch<PluginToolsPayload>(PLUGIN_TOOLS_RELOAD_PATH, {
    method: 'POST',
    body: { user_id: tarsId },
    baseUrl,
    timeoutMs: LISTING_TIMEOUT_MS,
  });
  invalidateTarsPluginManifestsCache();
  return toListing(payload);
}

/** What the model needs to call a plugin: its `ToolManifest` as pwc_tars serializes it. */
export interface TarsPluginManifest {
  name: string;
  description: string;
  display_name: string;
  version: string;
  input_schema: JsonSchemaType;
  requires: string[];
  read_only: boolean;
  ends_turn: boolean;
}

/** One `context_fields` entry: what a built-in tool needs bound before it can run. */
export interface TarsToolContextField {
  name: string;
  required?: boolean;
}

/** A pwc_tars built-in agent tool as `GET /api/langflow-service/tools` lists it. */
export interface TarsBuiltinManifest extends TarsPluginManifest {
  context_fields: TarsToolContextField[];
  long_running: boolean;
  /**
   * When-and-how guidance for the calling model — the body of pwc_tars's own
   * chat tool guide. Tools sharing one guide carry the same text; empty when
   * the description suffices (or on a pwc_tars that predates the field).
   */
  guide: string;
}

interface ServiceToolEntry extends Partial<TarsBuiltinManifest> {
  name?: string;
  kind?: string;
}

interface ServiceToolsPayload {
  tools?: ServiceToolEntry[];
  plugin_errors?: string[];
}

const EMPTY_SCHEMA: JsonSchemaType = { type: 'object', properties: {} };

const toManifest = (entry: ServiceToolEntry): TarsPluginManifest | undefined => {
  if (!entry.name) {
    return undefined;
  }
  return {
    name: entry.name,
    description: entry.description ?? '',
    display_name: entry.display_name || entry.name,
    version: entry.version ?? '',
    input_schema: entry.input_schema ?? EMPTY_SCHEMA,
    requires: entry.requires ?? [],
    read_only: entry.read_only !== false,
    ends_turn: entry.ends_turn === true,
  };
};

const toBuiltinManifest = (entry: ServiceToolEntry): TarsBuiltinManifest | undefined => {
  const manifest = toManifest(entry);
  if (!manifest) {
    return undefined;
  }
  return {
    ...manifest,
    context_fields: entry.context_fields ?? [],
    long_running: entry.long_running === true,
    guide: typeof entry.guide === 'string' ? entry.guide.trim() : '',
  };
};

/** Both kinds of directly callable tool, from the one listing that reports them. */
interface ServiceManifests {
  plugins: Map<string, TarsPluginManifest>;
  builtins: Map<string, TarsBuiltinManifest>;
}

interface ManifestsCache extends ServiceManifests {
  cachedAt: number;
}

let manifestsCache: ManifestsCache | null = null;
let manifestsInflight: Promise<ServiceManifests> | null = null;

export function invalidateTarsPluginManifestsCache(): void {
  manifestsCache = null;
  manifestsInflight = null;
}

async function fetchTarsServiceManifests(): Promise<ServiceManifests> {
  const payload = await langflowServiceFetch<ServiceToolsPayload>(SERVICE_TOOLS_PATH, {
    method: 'GET',
    timeoutMs: LISTING_TIMEOUT_MS,
  });
  const plugins = new Map<string, TarsPluginManifest>();
  const builtins = new Map<string, TarsBuiltinManifest>();
  for (const entry of payload?.tools ?? []) {
    if (entry.kind === PLUGIN_KIND) {
      const manifest = toManifest(entry);
      if (manifest) {
        plugins.set(manifest.name, manifest);
      }
    } else if (entry.kind === BUILTIN_KIND) {
      const manifest = toBuiltinManifest(entry);
      if (manifest) {
        builtins.set(manifest.name, manifest);
      }
    }
  }
  for (const problem of payload?.plugin_errors ?? []) {
    logger.warn(`[tars-plugins] pwc_tars rejected a plugin: ${problem}`);
  }
  return { plugins, builtins };
}

async function primeTarsServiceManifests(): Promise<ServiceManifests> {
  const now = Date.now();
  if (manifestsCache && now - manifestsCache.cachedAt < MANIFESTS_TTL_MS) {
    return manifestsCache;
  }
  if (manifestsInflight) {
    return manifestsInflight;
  }
  manifestsInflight = fetchTarsServiceManifests()
    .then((manifests) => {
      manifestsCache = { ...manifests, cachedAt: Date.now() };
      return manifests;
    })
    .finally(() => {
      manifestsInflight = null;
    });
  return manifestsInflight;
}

/**
 * The loaded plugin manifests, fetched once per TTL and shared by every turn.
 * Call before {@link getTarsPluginManifest}, which is synchronous so the
 * definition registry can consult it without becoming async.
 */
export async function primeTarsPluginManifests(): Promise<Map<string, TarsPluginManifest>> {
  return (await primeTarsServiceManifests()).plugins;
}

/** A primed manifest by plugin name; undefined when unknown or not yet primed. */
export function getTarsPluginManifest(pluginName: string): TarsPluginManifest | undefined {
  return manifestsCache?.plugins.get(pluginName);
}

/**
 * pwc_tars's built-in tool manifests, from the same cached listing as the
 * plugins. Call before {@link getTarsBuiltinManifest} for the same reason.
 */
export async function primeTarsBuiltinManifests(): Promise<Map<string, TarsBuiltinManifest>> {
  return (await primeTarsServiceManifests()).builtins;
}

/** A primed built-in manifest by pwc_tars tool name; undefined when unknown or not yet primed. */
export function getTarsBuiltinManifest(toolName: string): TarsBuiltinManifest | undefined {
  return manifestsCache?.builtins.get(toolName);
}

export interface TarsPluginRunInput {
  inputs: Record<string, unknown>;
  /** The user's current message — plugins read it as `ctx.question`. */
  question?: string;
  /** pwc_tars user the call runs as (`ctx.settings.user_id`). */
  tarsUserId?: string;
  /** The active 專用腦 (`ctx.settings.domain_id`). */
  domainId?: string | number | null;
  /** The model the chat turn runs on, as LibreChat names it. */
  model?: string;
  /**
   * JSON `TarsDataFileRef[]` for the thread's spreadsheets; pwc_tars downloads
   * them and hands the plugin the local paths as `ctx.settings.data_files`.
   */
  dataFileRefs?: string;
  /** Parsed text of the conversation's other attached files (`ctx.settings.file_input`). */
  fileInput?: string;
  /** Prior turns, oldest first (`ctx.history`). */
  history?: TarsHistoryMessage[];
  /** The account the LLM gateway resolves models and quota for. */
  librechatUserId?: string;
  /** Receives each progress line the plugin reports (`ctx.progress`) while it runs. */
  onProgress?: (message: string) => void;
  /** Stops the plugin, e.g. when the chat run that called it is stopped. */
  signal?: AbortSignal;
}

/** `ToolOutput.to_dict()` plus the run metadata `run_standard_tool` adds. */
export interface TarsPluginRunResult {
  content: string;
  is_error: boolean;
  artifacts: Record<string, unknown>;
  summary: string;
  final_text: string;
  end_turn: boolean;
  tool?: string;
  title?: string;
  tokens?: { total?: number; prompt?: number; completion?: number };
  model_name?: string;
}

const toDomainId = (domainId: string | number | null | undefined): number | string | undefined => {
  if (domainId == null || domainId === '') {
    return undefined;
  }
  const numeric = Number(domainId);
  return Number.isInteger(numeric) ? numeric : String(domainId);
};

/**
 * Runs one plugin directly (`POST /api/langflow-service/tools/<name>`) — no
 * agent loop on the pwc_tars side, the chat model here is the one deciding.
 * The settings mirror what pwc_tars' own chat hands a plugin so a tool written
 * against `ctx.settings` sees the same keys from either host. That includes
 * `direct_call: false`: pwc_tars marks service-key calls as direct by default,
 * which plugins read as "trust whatever the caller names", but the arguments
 * here come from a chat model acting for an end user.
 */
export async function runTarsPluginTool(
  pluginName: string,
  input: TarsPluginRunInput,
): Promise<TarsPluginRunResult> {
  const requestedModel = await resolveLangflowModelName(input.model, 'tars-plugins');
  const settings: Record<string, unknown> = {
    direct_call: false,
    plugin_tool_names: [pluginName],
  };
  if (input.dataFileRefs) {
    settings.data_file_refs = input.dataFileRefs;
  }
  if (input.fileInput) {
    settings.file_input = input.fileInput;
  }
  if (input.question) {
    settings.question = input.question;
  }
  if (input.tarsUserId) {
    settings.user_id = input.tarsUserId;
  }
  const domainId = toDomainId(input.domainId);
  if (domainId !== undefined) {
    settings.domain_id = domainId;
  }

  const data = await runTarsServiceTool<TarsPluginRunResult>(
    pluginName,
    {
      inputs: input.inputs,
      context: requestedModel ? { model_name: requestedModel } : {},
      settings,
      ...(input.history?.length ? { history: input.history } : {}),
    },
    {
      timeoutMs: langflowTimeoutMs(
        'TARS_PLUGIN_TOOL_TIMEOUT_MS',
        TARS_CAPABILITY_DEFAULT_TIMEOUT_MS,
      ),
      librechatUserId: input.librechatUserId,
      tarsUserId: input.tarsUserId,
      onProgress: input.onProgress,
      signal: input.signal,
    },
  );
  const result: TarsPluginRunResult = {
    content: data?.content ?? '',
    is_error: data?.is_error === true,
    artifacts: data?.artifacts ?? {},
    summary: data?.summary ?? '',
    final_text: data?.final_text ?? '',
    end_turn: data?.end_turn === true,
    tool: data?.tool,
    title: data?.title,
    tokens: data?.tokens,
    model_name: data?.model_name,
  };
  logger.debug(
    `[tars-plugins] tool=${pluginName} requested=${requestedModel ?? '(pwc_tars default)'} ` +
      `used=${result.model_name || '(none)'} tokens=${result.tokens?.total ?? 0} ` +
      `error=${result.is_error ? 'yes' : 'no'} gateway=requested`,
  );
  return result;
}
