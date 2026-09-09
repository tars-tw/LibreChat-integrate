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
