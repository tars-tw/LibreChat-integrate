import type { TTarsDatabaseType, TTarsFileProtocol } from '../tars';

/**
 * A pwc_tars specialized brain ("專用腦") as surfaced to the LibreChat client.
 * Mirrors the backend `TarsDomain` (pwc_tars `SysDomain.to_dict()`):
 * `role_ids` / `knowledge_base_ids` are comma-separated id strings and
 * `domain_functions` is a JSON string of capability toggles.
 */
export type TTarsDomain = {
  id: number;
  name: string;
  description: string | null;
  role_ids: string | null;
  knowledge_base_ids: string | null;
  domain_functions: string | null;
  prompt_instruction: string | null;
  iframe_url: string | null;
  status: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  url?: string;
};

export type TTarsDomainsResponse = {
  domains: TTarsDomain[];
};

/** A pwc_tars role, for the domain editor's role multi-select. */
export type TTarsRole = {
  id: number;
  name: string;
  domain_ids?: string | null;
};

/** A pwc_tars knowledge base. `*_count` stats are present on the admin listing. */
export type TTarsKnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  data_source_type?: string | null;
  embedding_model?: string | null;
  rerank_model?: string | null;
  llm_model?: string | null;
  max_retrieve_count?: number | null;
  status?: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  document_count?: number;
  website_count?: number;
  api_count?: number;
  fs_count?: number;
  total_chunk_count?: number;
  total_token_count?: number;
  has_sql_database?: boolean;
  /** Ids allowed to use the KB. Empty means "everyone", matching pwc_tars. */
  allowed_user_ids?: string[];
  allowed_user_group_ids?: string[];
};

/** A person the knowledge-base access picker offers. */
export type TTarsKnowledgeBaseUser = {
  id: string;
  username: string | null;
  display_name: string | null;
};

/** A group the knowledge-base access picker offers. */
export type TTarsKnowledgeBaseGroup = {
  id: string;
  name: string;
};

export type TTarsDomainPrepareData = {
  sys_domains: TTarsDomain[];
  knowledge_bases: TTarsKnowledgeBase[];
  roles: TTarsRole[];
};

/** Create/update payload for a specialized brain. */
export type TTarsDomainInput = {
  name: string;
  description?: string;
  role_ids?: string;
  knowledge_base_ids?: string;
  domain_functions?: string;
  prompt_instruction?: string;
  iframe_url?: string;
  status?: number | boolean;
};

export type TTarsKnowledgeBasesResponse = {
  knowledgeBases: TTarsKnowledgeBase[];
  users: TTarsKnowledgeBaseUser[];
  userGroups: TTarsKnowledgeBaseGroup[];
};

/** One selectable model on the knowledge-base binding form. */
export type TTarsBindableModel = {
  id: string;
  name: string;
  note?: string;
};

/**
 * The models a knowledge base may bind to, with what it currently uses.
 * Narrower than the raw model lists: pwc_tars drops LLMs whose API key is
 * invalid or that its health checker cannot reach.
 */
export type TTarsKnowledgeBaseModelBindings = {
  embedding: { selected_id: string | null; options: TTarsBindableModel[] };
  rerank: { selected_id: string | null; options: TTarsBindableModel[] };
  llm: { selected_id: string | null; options: TTarsBindableModel[] };
};

/** Only rerank and LLM are rebindable — the stored vectors fix the embedding. */
export type TTarsKnowledgeBaseModelUpdate = {
  rerankModelId?: string;
  llmModelId?: string;
};

export type TTarsModelOption = {
  id: string;
  name: string;
};

export type TTarsModelOptions = {
  llm: TTarsModelOption[];
  embedding: TTarsModelOption[];
  rerank: TTarsModelOption[];
};

/** pwc_tars model_profile whitelist; `models: null` means no restriction. */
export type TTarsModelsResponse = {
  models: string[] | null;
};

export type TTarsKnowledgeBaseInput = {
  name: string;
  description?: string;
  data_source_type?: string;
  embedding_model?: string;
  collection_binding_name?: string;
};

export type TTarsKnowledgeBaseUpdate = {
  name?: string;
  description?: string;
  domain_ids?: string;
  new_max_retrieve_count?: number;
  /**
   * pwc_tars only touches these when the key is present, so omitting a list
   * leaves the stored permissions alone rather than clearing them.
   */
  allowed_user_ids?: string[];
  allowed_user_group_ids?: string[];
};

/** A website dataset bound to a knowledge base. */
export type TTarsDatasetWebsite = {
  id: string;
  name: string | null;
  description: string | null;
  url: string | null;
  status: number | null;
  size: number | null;
  word_count: number | null;
  tokens: number | null;
  chunk_size: number | null;
  tags: string | null;
  website_metatype: string | null;
  llm_model?: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

/**
 * A database connection. Every credential is stripped server-side — pwc_tars
 * serialises the whole row, password included, and none of it reaches here.
 */
export type TTarsDatasetDatabase = {
  id: string;
  name: string;
  description: string | null;
  db_type: string | null;
  host: string | null;
  port: number | null;
  database_name: string | null;
  schema: string | null;
  service_name: string | null;
  sid: string | null;
  status: number | null;
  allowed_km_ids: string[];
  llm_model?: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** Payload the application-database form submits. */
export type TTarsDatabaseInput = {
  name: string;
  description?: string;
  dbType: TTarsDatabaseType;
  host?: string;
  port?: number;
  /** For Oracle this is the Service Name; pwc_tars stores it in `database_name`. */
  databaseName?: string;
  username?: string;
  /** Blank on edit means "keep the stored password" — the browser never has it. */
  password?: string;
  enabled?: boolean;
  allowedKmIds?: string[];
};

export type TTarsDatabasesResponse = {
  databases: TTarsDatasetDatabase[];
};

/** What a connection test found on the far side. */
export type TTarsDatabaseConnectionTest = {
  tables: string[];
  views: string[];
};

/** A document-group link between a knowledge base and a file server. */
export type TTarsDatasetFileSystemLink = {
  id: string;
  knowledge_base_id: string;
  dataset_file_system_id: string;
  name: string | null;
  status: number | null;
  llm_model: string | null;
  schedule_id: string | null;
  is_sync_all: boolean | null;
  is_upload_only: boolean | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** A file server a document group can be imported from, without its password. */
export type TTarsFileSystemSource = {
  id: string;
  name: string;
  description: string | null;
  mount_type: string | null;
  host: string | null;
  port: number | null;
  path: string | null;
  host_name: string | null;
  status: number | null;
  allowed_km_ids: string[];
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TTarsFileSystemInput = {
  name: string;
  description?: string;
  protocol: TTarsFileProtocol;
  host: string;
  port?: number;
  /** For SMB the first segment is the share name, e.g. `public/reports`. */
  path?: string;
  /** NetBIOS name, SMB only. */
  hostName?: string;
  account?: string;
  /** Blank on edit means "keep the stored password" — the browser never has it. */
  password?: string;
  allowedKmIds?: string[];
};

/** A row of the 外部網站 master list, with the knowledge base it was imported into. */
export type TTarsWebsiteSource = TTarsDatasetWebsite & {
  knowledge_base_id: string | null;
  knowledge_base_name: string | null;
};

export type TTarsWebsitesResponse = {
  websites: TTarsWebsiteSource[];
  /** The enabled knowledge bases a website may be imported into. */
  knowledgeBases: { id: string; name: string }[];
};

export type TTarsWebsiteSourceInput = {
  knowledgeBaseId: string;
  name: string;
  url: string;
  description?: string;
  enabled?: boolean;
  chunkSize?: number;
};

export type TTarsFileSystemsResponse = {
  fileSystems: TTarsFileSystemSource[];
};

/** The paths a document group's share currently holds. */
export type TTarsFileSystemConnectionTest = {
  files: string[];
};

/** System-wide ceilings the upload forms must respect. */
export type TTarsDatasetLimits = {
  max_upload_counts: number;
  max_chunk_size: number;
  max_overlap: number;
};

export type TTarsDatasetStats = {
  document_count: number;
  total_word_count: number;
  total_token_count: number;
  /** API datasets have no tab, so the count is what keeps them visible. */
  api_count: number;
};

/** Everything the knowledge-base detail page reads, in one response. */
export type TTarsKnowledgeBaseDatasets = {
  knowledge_base: TTarsKnowledgeBase | null;
  documents: TTarsDocument[];
  websites: TTarsDatasetWebsite[];
  databases: TTarsDatasetDatabase[];
  file_systems: TTarsDatasetFileSystemLink[];
  available_databases: TTarsDatasetDatabase[];
  limits: TTarsDatasetLimits;
  stats: TTarsDatasetStats;
};

/** One crawled slice of a website dataset. */
export type TTarsWebsiteChunk = {
  id: string;
  website_id: string;
  url: string | null;
  position: number;
  content: string;
  word_count: number | null;
  tokens: number | null;
  keywords: string | null;
  hit_count: number | null;
  enabled: boolean | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TTarsWebsiteChunkPage = {
  website: TTarsDatasetWebsite | null;
  chunks: TTarsWebsiteChunk[];
  totalChunks: number;
};

export type TTarsWebsiteImportInput = {
  name: string;
  url: string;
  description?: string;
  enabled?: boolean;
  chunkSize?: number;
};

/** `bound` are the tables already attached to this knowledge base. */
export type TTarsDatabaseTables = {
  tables: string[];
  views: string[];
  bound: string[];
};

export type TTarsDatabasePrompt = {
  id: string;
  dataset_sql_id: string;
  knowledge_base_id: string;
  tables: string | null;
  llm_table_info: string | null;
  llm_model: string | null;
};

export type TTarsFileSystemImportInput = {
  name: string;
  syncAll?: boolean;
  uploadOnly?: boolean;
  fileSettings?: Record<string, { chunkSize?: number; overlap?: number }>;
  tags?: string;
};

/** Document groups are unlinked one at a time, so they have no id list. */
export type TTarsDatasetBatchDelete = {
  documentIds?: string[];
  websiteIds?: string[];
  databaseIds?: string[];
};

/** The dataset kinds pwc_tars can schedule. */
export type TTarsScheduleDatasetType = 'website' | 'file_system' | 'api';

/**
 * One recurring dataset refresh.
 *
 * `last_status` is the one to read — `status` is an unused integer flag, and
 * pwc_tars rewrites `last_status` to `stopped` in the response once `end_time`
 * has passed, so it does not always match what is stored.
 */
export type TTarsSchedule = {
  id: string;
  dataset_id: string;
  dataset_type: string;
  dataset_name: string;
  knowledge_base_id: string;
  knowledge_base_name: string;
  frequency: number;
  frequency_unit: string;
  start_time: string | null;
  end_time: string | null;
  last_execute_time: string | null;
  next_execute_time: string | null;
  execution_duration: number | null;
  execution_type: string | null;
  execution_count: number;
  retry_count: number;
  max_retry_count: number;
  last_status: string | null;
  description: string | null;
  message: string | null;
  /** Only meaningful for `file_system` schedules; it lives on the group link. */
  is_sync_all: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TTarsScheduleInput = {
  datasetId: string;
  datasetType: TTarsScheduleDatasetType;
  knowledgeBaseId: string;
  frequency: number;
  frequencyUnit: string;
  /** `YYYY-MM-DDTHH:MM`, as a `datetime-local` input produces. */
  startTime: string;
  endTime?: string;
};

export type TTarsScheduleUpdate = {
  frequency: number;
  frequencyUnit: string;
  startTime: string;
  endTime?: string;
};

/** A document inside a knowledge base (pwc_tars `Document.to_dict()`). */
export type TTarsDocument = {
  id: string;
  filename: string;
  knowledge_base_ids?: string | null;
  /** Set when the document came in through a document group. */
  dataset_file_system_id?: string | null;
  size?: number | null;
  extension?: string | null;
  mime_type?: string | null;
  status: number;
  hash?: string | null;
  word_count?: number | null;
  tokens?: number | null;
  tags?: string | null;
  file_path?: string | null;
  chunk_size?: number | null;
  overlap_size?: number | null;
  file_source?: string | null;
  llm_model?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TTarsDocumentsResponse = {
  documents: TTarsDocument[];
};

/** A chunk of a document (pwc_tars `ChunkFile.to_dict()`). */
export type TTarsChunk = {
  id: string;
  document_id: string;
  filename?: string | null;
  position: number;
  content: string;
  word_count?: number | null;
  tokens?: number | null;
  hit_count?: number | null;
  enabled?: boolean;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TTarsChunksResponse = {
  chunks: TTarsChunk[];
};

/** Per-file chunk override keyed by filename, matching pwc_tars `file_settings`. */
export type TTarsFileSetting = {
  chunkSize?: number;
  overlap?: number;
};

export type TTarsDocumentReprocess = {
  chunkSize?: number;
  overlap?: number;
};

/** Which pwc_tars table a "我的提示" lives in — its visibility tier. */
export type TTarsPromptScope = 'personal' | 'domain' | 'knowledge_base';

/**
 * A pwc_tars "我的提示" as surfaced to the client. Mirrors the backend
 * `TarsPrompt` (pwc_tars `Prompt.to_dict()`). `knowledge_base_name` is present
 * only on knowledge-base prompts; `scope` is tagged by the chat aggregator.
 */
export type TTarsPrompt = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  content: string;
  status: number;
  created_by: string;
  created_at: string;
  updated_by?: string | null;
  updated_at?: string | null;
  knowledge_base_name?: string | null;
  scope?: TTarsPromptScope;
};

/** A specialized brain's knowledge base, for the create form's scope picker. */
export type TTarsPromptKnowledgeBase = {
  id: string;
  name: string;
};

export type TTarsPromptsResponse = {
  prompts: TTarsPrompt[];
  knowledgeBases: TTarsPromptKnowledgeBase[];
};

/**
 * Create/update payload for a "我的提示". `command` is sent for the forthcoming
 * pwc_tars column and is ignored by the current backend.
 */
export type TTarsPromptInput = {
  name: string;
  content: string;
  category: string;
  description?: string;
  command?: string;
  status?: number;
  domain_id?: string | number;
  knowledge_base_id?: string;
};

/** A pwc_tars system parameter (系統參數設定). Mirrors `SysConfig.to_dict()`. */
export type TTarsSysConfig = {
  id: number;
  category: string | null;
  key: string;
  value: string | null;
  type: string;
  description: string | null;
  status: string;
  is_displayed: boolean;
  created_by: string;
  created_name: string;
  updated_by: string | null;
  updated_name: string | null;
  created_at: string;
  updated_at: string | null;
};

export type TTarsSysConfigsResponse = {
  sysConfigs: TTarsSysConfig[];
};

/** Update payload; key/category are immutable in the UI. */
export type TTarsSysConfigUpdate = {
  key: string;
  value?: string;
  description?: string;
  status?: 'active' | 'inactive';
};

/** A pwc_tars MCP tool row (`McpTool.to_dict()`); `input_schema` is JSON Schema. */
export type TTarsMcpTool = {
  id: string;
  mcp_server_id?: string;
  name: string;
  description?: string | null;
  input_schema?: Record<string, unknown> | null;
  is_enabled?: boolean;
};

/** Admin view of a pwc_tars MCP server (`McpServer.to_dict()` + injected fields). */
export type TTarsMcpServer = {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  type: 'openapi' | 'custom_api' | 'external' | 'builtin';
  is_enabled: boolean;
  priority?: number | null;
  tags?: string[] | null;
  connection_config?: Record<string, unknown> | null;
  tool_config?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  tool_count?: number;
  requires_user_credentials?: boolean;
  tools?: TTarsMcpTool[];
};

export type TTarsMcpServersResponse = { servers: TTarsMcpServer[] };

/** Create/update payload for a pwc_tars MCP server managed from LibreChat. */
export type TTarsMcpServerInput = {
  name: string;
  code?: string;
  description?: string;
  type: 'openapi' | 'custom_api' | 'external';
  is_enabled?: boolean;
  priority?: number;
  tags?: string[];
  connection_config: Record<string, unknown>;
  tool_config?: Record<string, unknown>;
  env_vars?: Record<string, string>;
};

/** Per-tool update payload (admin enable/disable or description/schema override). */
export type TTarsMcpToolUpdate = {
  is_enabled?: boolean;
  description?: string;
  input_schema?: Record<string, unknown>;
};

/** One `sys_domain_mcp` binding row (+ joined server) for the permissions tab. */
export type TTarsDomainMcpRelation = {
  id: string;
  sys_domain_id: number;
  mcp_server_id: string;
  is_enabled: boolean;
  mcp_tool_ids?: string[] | null;
  config?: Record<string, unknown> | null;
  server?: TTarsMcpServer | null;
};

export type TTarsDomainMcpServersResponse = { servers: TTarsDomainMcpRelation[] };

/**
 * Full-overwrite domain↔MCP binding payload: for every listed domain, unlisted
 * servers get unbound and each server's tool whitelist is replaced
 * (`mcp_tool_ids: []` = whole server).
 */
export type TTarsDomainMcpSavePayload = {
  domain_ids: number[];
  servers: Array<{ mcp_server_id: string; mcp_tool_ids?: string[] }>;
};

/** One `mcp_logs` audit row. */
export type TTarsMcpLog = {
  id: string;
  sys_user_id: string;
  sys_domain_id?: number | null;
  conversation_id?: string | null;
  message_id?: string | null;
  mcp_server_id: string;
  tool_name: string;
  input_params?: Record<string, unknown> | null;
  output_result?: unknown;
  error_message?: string | null;
  status: string;
  duration_ms?: number | null;
  created_at?: string | null;
};

export type TTarsMcpLogsResponse = { logs: TTarsMcpLog[] };

export type TTarsMcpSyncResult = {
  synced?: number;
  created?: number;
  updated?: number;
  deleted?: number;
};

/** Result of a batch server delete — some ids may be skipped or not found. */
export type TTarsMcpBatchDeleteResult = {
  deleted: string[];
  skipped: string[];
  not_found: string[];
  deleted_count: number;
  skipped_count: number;
  failed_count: number;
};

/** Preview of a parsed OpenAPI/Swagger spec (pwc_tars `POST /parse-openapi`). */
export type TTarsMcpParsedSpec = {
  api_info?: Record<string, unknown>;
  base_url?: string;
  tools?: Array<{ name?: string; description?: string; method?: string; path?: string }>;
  tool_count?: number;
  login_hint?: Record<string, unknown> | null;
};

/** One tool in the user panel, with the user's own enable state. */
export type TTarsMcpUserTool = {
  id: string;
  name: string;
  description?: string | null;
  input_schema?: Record<string, unknown> | null;
  user_enabled: boolean;
};

/** One server in the user panel (domain-visible; includes credential status). */
export type TTarsMcpUserServer = {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  type: string;
  is_enabled: boolean;
  user_enabled: boolean;
  requires_user_credentials: boolean;
  has_credentials: boolean;
  auth_type: string;
  login_fields: string[];
  tools: TTarsMcpUserTool[];
  /**
   * Injected `mcpConfig` entry name (`tars_<code>`, plus a collision suffix when
   * one was needed). Absent when the server has no chat entry at all.
   */
  gateway_name?: string;
};

export type TTarsMcpUserSettingsResponse = { servers: TTarsMcpUserServer[] };

export type TTarsMcpUserServerUpdate = {
  is_enabled?: boolean;
  tool_config?: Record<string, boolean>;
};

/** One tool a domain (腦袋) may use, with the chat-facing LibreChat tool key. */
export type TTarsMcpDomainTool = {
  name: string;
  description?: string | null;
  /** Full LibreChat tool key (`<tool>_mcp_tars_<code>`) as loaded into agents. */
  tool_key: string;
};

/** One gateway server a domain grants, with its usable tools. */
export type TTarsMcpDomainServer = {
  id: string;
  name: string;
  code?: string | null;
  type: string;
  /** Injected `mcpConfig` entry name (`tars_<code>`) matching the chat dropdown. */
  gateway_name: string;
  /**
   * Whether the user opted this server in. pwc_tars defaults servers to OFF, so
   * `false` means the brain allows it but it is not usable yet — the chat menu
   * offers the opt-in rather than hiding it.
   */
  user_enabled: boolean;
  /** Tools the brain grants; only populated once `user_enabled` is true. */
  tools: TTarsMcpDomainTool[];
  /** Tool count the brain grants, known even while opted out. */
  tool_count?: number;
};

export type TTarsMcpDomainToolsResponse = { servers: TTarsMcpDomainServer[] };

/**
 * A pwc_tars account as surfaced to the LibreChat client. Mirrors the backend
 * `TarsUser` (pwc_tars `SysUser.to_dict()`) plus the two fields the listing
 * computes: `is_online` and `roles_names` (the union of the account's own role
 * and every role its groups grant, comma separated).
 */
export type TTarsUser = {
  id: string;
  username: string;
  email: string | null;
  role_id: number | null;
  user_group_id: string | null;
  display_name: string | null;
  avatar?: string | null;
  interface_language?: string | null;
  interface_theme?: string | null;
  timezone?: string | null;
  last_login_at?: string | null;
  last_login_ip?: string | null;
  status: string;
  initialized_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_active_at?: string | null;
  is_sso_user?: boolean;
  is_syncbyad?: boolean;
  sso_config_id?: string | null;
  is_online?: boolean;
  roles_names?: string | null;
};

export type TTarsUsersResponse = {
  users: TTarsUser[];
};

/** A pwc_tars user group (`SysUserGroup.to_dict()`). */
export type TTarsUserGroup = {
  id: string;
  name: string;
  description?: string | null;
  role_id?: string | null;
  status?: number | boolean | null;
  is_syncbyad?: boolean;
  sso_config_id?: string | null;
};

/** Roles, groups and SSO status the user admin page needs before rendering. */
export type TTarsUserPrepareData = {
  roles: TTarsRole[];
  userGroups: TTarsUserGroup[];
  sso: { enabled: boolean; type: string | null };
};

export type TTarsAdWhitelistResponse = {
  usernames: string[];
};

/** Create payload. `email`/`password` are omitted for AD-backed accounts. */
export type TTarsUserInput = {
  username: string;
  email?: string;
  password?: string;
  display_name?: string;
  role_id?: string | number | null;
  user_group_id?: string | null;
  status?: string;
  is_sso_user?: boolean;
};

/** Partial update — pwc_tars only touches the keys that are present. */
export type TTarsUserUpdate = {
  email?: string;
  display_name?: string;
  role_id?: string | number | null;
  user_group_id?: string | null;
  status?: string;
};

/** The subset of fields the bulk editor may apply to many accounts at once. */
export type TTarsBulkUserUpdate = {
  role_id?: string | number | null;
  user_group_id?: string | null;
  status?: string;
};

export type TTarsBulkUserUpdatePayload = {
  ids: string[];
  updates: TTarsBulkUserUpdate;
};

/** pwc_tars import result: a summary `message`, or per-row `details` on failure. */
export type TTarsUserImportResult = {
  message?: string;
  error?: string;
  details?: string[];
};

/** A member row of the `user_list` pwc_tars attaches to each group. */
export type TTarsGroupMember = {
  id: string;
  username: string;
  email: string | null;
  status: string;
};

/**
 * A pwc_tars user group as the group admin page sees it: the group row plus the
 * `user_count` / `user_list` that `user_group_prepare_data` computes.
 * `role_id` is a comma-separated id string — a group may grant several roles.
 */
export type TTarsUserGroupWithMembers = TTarsUserGroup & {
  user_count?: number;
  user_list?: TTarsGroupMember[];
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TTarsGroupPrepareData = {
  roles: TTarsRole[];
  groups: TTarsUserGroupWithMembers[];
};

/** Create/update payload. `status` is pwc_tars' numeric 1/0 for groups. */
export type TTarsUserGroupInput = {
  name: string;
  description?: string;
  roleIds?: string;
  status?: number;
};

/**
 * A pwc_tars role as the permission admin page sees it. `domain_ids` / `menu_ids`
 * are comma-separated id strings and `status` is numeric 1/0 like the group
 * table. `librechat_menu_keys` holds the LibreChat menu permission set — comma
 * separated stable keys, `null` meaning "not configured" (every menu visible).
 */
export type TTarsRoleDetail = TTarsRole & {
  description: string | null;
  domain_ids: string | null;
  menu_ids: string | null;
  librechat_menu_keys: string | null;
  status: number;
  is_default_role: boolean;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TTarsRolePrepareData = {
  roles: TTarsRoleDetail[];
  domains: TTarsDomain[];
};

export type TTarsRoleInput = {
  name: string;
  description?: string;
  domainIds?: string;
  librechatMenuKeys?: string;
  isEnabled?: boolean;
  isDefaultRole?: boolean;
};

/** pwc_tars licence state, surfaced on the system settings page. */
export type TTarsSystemSettings = {
  licenseStatus: string;
  licenseStartDate: string;
  licenseEndDate: string;
};

/**
 * A pwc_tars SSO configuration row. One table holds every provider, so the LDAP
 * field group is optional and only populated when `sso_type_id` is '1'.
 */
export type TTarsSsoConfig = {
  id: string;
  sso_type_id: string;
  sso_type_name: string;
  status: number;
  ldap_name?: string | null;
  ldap_server_address?: string | null;
  ldap_server_port?: string | null;
  ldap_base_dn?: string | null;
  ldap_search_attribute?: string | null;
  ldap_admin_dn?: string | null;
  ldap_admin_password?: string | null;
  ldap_whitelist_users?: string | null;
  ldap_whitelist_groups?: string | null;
  ldap_enable_whitelist?: boolean;
  frequency?: number | null;
  frequency_unit?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  last_execute_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TTarsSsoConfigsResponse = {
  configs: TTarsSsoConfig[];
};

/** Create/update payload for an LDAP configuration. */
export type TTarsLdapConfigInput = {
  ldap_name?: string;
  ldap_server_address?: string;
  ldap_server_port?: string;
  ldap_base_dn?: string;
  ldap_search_attribute?: string;
  ldap_admin_dn?: string;
  ldap_admin_password?: string;
  ldap_whitelist_users?: string;
  ldap_enable_whitelist?: boolean;
  status?: number;
};

/** A node of the pwc_tars LDAP directory tree. */
export type TTarsLdapTreeNode = {
  key: string;
  label: string;
  type?: string | null;
  children?: TTarsLdapTreeNode[];
};

export type TTarsLdapTreeResponse = {
  nodes: TTarsLdapTreeNode[];
};

/** A whitelist entry resolved against the directory. */
export type TTarsWhitelistUser = {
  username: string;
  ou?: string | null;
  display_name?: string | null;
  email?: string | null;
};

export type TTarsWhitelistResponse = {
  users: TTarsWhitelistUser[];
};

export type TTarsSyncSchedule = {
  frequency: number;
  frequency_unit: string;
  start_time: string | null;
  end_time: string | null;
  last_execute_at?: string | null;
};

export type TTarsSyncScheduleResponse = {
  schedule: TTarsSyncSchedule | null;
};

export type TTarsSyncScheduleInput = {
  frequency: number;
  frequency_unit: string;
  start_time?: string;
  end_time?: string;
};

/** A local attachment copy pwc_tars keeps alongside the remote ticket. */
export type TTarsTicketAttachment = {
  id?: string;
  filename?: string;
  original_name?: string;
  size?: number | null;
  uploader?: string | null;
};

/** One comment on the Issue Tracker ticket, as pwc_tars relays it. */
export type TTarsTicketComment = {
  id: string;
  body: string;
  author?: string | null;
  author_email?: string | null;
  side?: string | null;
  created_at?: string | null;
  edited_at?: string | null;
};

/** A pwc_tars support ticket (`SysSupportTicket.to_dict()`). */
export type TTarsTicket = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  priority?: string | null;
  attachments?: TTarsTicketAttachment[] | null;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  jira_ticket_key?: string | null;
  jira_sync_at?: string | null;
  status?: string | null;
  error_message?: string | null;
  source?: string | null;
  is_resolved?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Live Issue Tracker status; null when the remote lookup failed. */
  remote_status?: string | null;
  attach_warning?: string | null;
};

/**
 * A ticket enriched with everything pwc_tars reads back from the Issue Tracker.
 * Each remote lookup fails independently, so `*_error` degrades one section.
 */
export type TTarsTicketDetail = TTarsTicket & {
  editable: boolean;
  remote_error?: string | null;
  comments: TTarsTicketComment[];
  comments_error?: string | null;
  remote_attachments?: TTarsTicketAttachment[] | null;
  attachments_error?: string | null;
  remote_fields?: {
    title?: string | null;
    description?: string | null;
    type?: string | null;
    priority?: string | null;
    severity?: string | null;
    component_id?: string | number | null;
  } | null;
};

export type TTarsTicketsResponse = {
  tickets: TTarsTicket[];
};

export type TTarsTicketResponse = {
  ticket: TTarsTicketDetail;
};

/** An Issue Tracker component the ticket can be filed against. */
export type TTarsTicketComponent = {
  id: string;
  name: string;
};

/** Field domains plus components, fetched together for the report form. */
export type TTarsTicketOptionsResponse = {
  types: string[];
  priorities: string[];
  severities: string[];
  components: TTarsTicketComponent[];
  /** Set when pwc_tars fell back to its built-in domains; the form still works. */
  warning?: string | null;
};

/** Editable ticket fields. pwc_tars requires `title`, `description` and `component_id`. */
export type TTarsTicketInput = {
  title: string;
  description: string;
  type?: string;
  priority?: string;
  severity?: string;
  component_id?: string;
};

/** One message audit row (`POST /api/tars/audit/messages`). */
export type TTarsAuditMessage = {
  message_id: string;
  user_id: string | null;
  username: string | null;
  domain_name: string | null;
  user_query: string | null;
  model_response: string | null;
  conversation_id: string | null;
  conversation_name: string | null;
  knowledge_base_name: string | null;
  model_name: string | null;
  created_at: string | null;
  upload_files: string | null;
  memory_document: string | null;
  memory_website: string | null;
  is_web_search: boolean | null;
  is_sql_agent: boolean | null;
  ip_address: string | null;
  like_counts: number;
  dislike_counts: number;
  comments: string | null;
  is_deleted: boolean;
};

/** A raw feedback record, kept so a rating outside the message's own window still counts. */
export type TTarsAuditFeedback = {
  id?: string;
  message_id: string;
  like_count?: number;
  dislike_count?: number;
  feedback?: string | null;
  created_at?: string | null;
  created_by?: string | null;
};

/** Per-specialized-brain rollup for the statistics tab. */
export type TTarsAuditDomainStat = {
  domain_name: string;
  conversation_count: number;
  message_count: number;
  knowledge_bases: { id?: string | number; name: string }[];
};

export type TTarsAuditSummary = {
  total_domains: number;
  total_conversations: number;
  total_messages: number;
  date_range: { start_date: string; end_date: string };
};

/** pwc_tars pages nothing: the whole period arrives at once, response text included. */
export type TTarsAuditReport = {
  total_count: number;
  data: TTarsAuditMessage[];
  feedback_data: TTarsAuditFeedback[];
  summary: TTarsAuditSummary | null;
  details: TTarsAuditDomainStat[];
};

/** Filters the operator submits. Dates are `YYYY-MM-DD`, interpreted in Asia/Taipei. */
export type TTarsAuditQuery = {
  start_date: string;
  end_date: string;
  filter_user_ids?: string[];
  knowledge_base_ids?: string[];
  domain_id?: string | null;
  query_filter?: string;
};

/** The three pickers that drive the audit filter bar. */
export type TTarsAuditOptionsResponse = {
  users: { id: string; username: string }[];
  domains: { id: string; name: string }[];
  knowledge_bases: { id: string; name: string }[];
};

/**
 * A value from one of pwc_tars' `db.JSON` columns. SQLAlchemy hands these back
 * already parsed, so they arrive as objects rather than text — but rows written
 * before the column was JSON still hold a raw string.
 */
export type TTarsJsonField =
  | string
  | number
  | boolean
  | null
  | TTarsJsonField[]
  | { [key: string]: TTarsJsonField };

/** One recorded operation in the pwc_tars system audit trail. */
export type TTarsActionLog = {
  id: string;
  sys_domain_id: string | null;
  user_id: string | null;
  username: string | null;
  user_email: string | null;
  role_id: string | null;
  action_type: string | null;
  module: string | null;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  description: string | null;
  page_url: string | null;
  menu_id: string | null;
  http_method: string | null;
  api_endpoint: string | null;
  before_data: TTarsJsonField;
  after_data: TTarsJsonField;
  extra: TTarsJsonField;
  status: string | null;
  error_message: string | null;
  ip_address: string | null;
  user_agent: string | null;
  trace_id: string | null;
  created_at: string | null;
};

/** Counts per action verb across the whole filtered set, not just the page. */
export type TTarsActionLogSummary = {
  total: number;
  create: number;
  update: number;
  delete: number;
  read: number;
  export: number;
  download: number;
  login: number;
  logout: number;
  other: number;
};

/** One page of the trail; pwc_tars pages this server-side. */
export type TTarsActionLogPage = {
  logs: TTarsActionLog[];
  total: number;
  page: number;
  page_size: number;
  summary: TTarsActionLogSummary;
};

/** A module the trail can be filtered by, resolved from `sys_menu`. */
export type TTarsActionLogModule = {
  value: string;
  title: string;
  lang_key: string | null;
};

export type TTarsActionLogOptionsResponse = {
  users: { user_id: string; username: string | null; user_email: string | null }[];
  action_types: string[];
  modules: TTarsActionLogModule[];
};

/** Filters the operator submits. Dates are `YYYY-MM-DDTHH:mm` from a local picker. */
export type TTarsActionLogQuery = {
  start_date?: string;
  end_date?: string;
  user_ids?: string[];
  action_types?: string[];
  modules?: string[];
  keyword?: string;
  page?: number;
  page_size?: number;
};

/** The two providers whose spend pwc_tars can bill from an admin API key. */
export type TTarsUsageProvider = 'openai' | 'anthropic';

export type TTarsUsageModelStat = {
  input_tokens: number;
  output_tokens: number;
  requests: number;
};

export type TTarsUsageCompletions = {
  total_input_tokens: number;
  total_output_tokens: number;
  total_requests: number;
  by_model: Record<string, TTarsUsageModelStat>;
};

export type TTarsUsageCosts = {
  total: number;
  currency: string;
  by_line_item: Record<string, number>;
};

export type TTarsUsageDailyCost = {
  date: string;
  cost: number;
};

export type TTarsUsageBilling = {
  budget: number | null;
  usage_this_month: {
    total_cost: number;
    currency: string;
    period: { start: string; end: string };
  } | null;
  remaining_balance: number | null;
};

/** One month of provider spend; both providers answer this same shape. */
export type TTarsProviderUsage = {
  period: { start_date: string; end_date: string };
  completions: TTarsUsageCompletions;
  costs: TTarsUsageCosts;
  daily_costs: TTarsUsageDailyCost[];
  billing: TTarsUsageBilling;
};

/** `month` is `YYYY-MM`; a budget only drives the remaining-balance card. */
export type TTarsUsageQuery = {
  provider: TTarsUsageProvider;
  month: string;
  budget?: number;
};

/** A group-level quota rule (`TokenConfig.to_dict()`) plus pwc_tars' joined names. */
export type TTarsTokenConfig = {
  id: string;
  domain_id: string | null;
  user_group_id: string | null;
  provider: string | null;
  system_total_limit: number | null;
  default_user_limit: number | null;
  reset_type: string | null;
  reset_day: number | null;
  last_reset_at: string | null;
  warning_threshold: number | null;
  is_active: boolean;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  domain_name?: string;
  group_name?: string;
};

/** A per-person override (`TokenUserQuota.to_dict()`) plus the joined names. */
export type TTarsTokenUserQuota = {
  id: string;
  domain_id: string | null;
  user_group_id: string | null;
  user_id: string | null;
  provider: string | null;
  custom_limit: number | null;
  used_amount: number | null;
  total_used_amount: number | null;
  reset_type: string | null;
  reset_day: number | null;
  last_reset_at: string | null;
  warning_threshold: number | null;
  status: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  domain_name?: string;
  group_name?: string;
  username?: string;
  display_name?: string;
  email?: string;
};

/** A user group with the specialized brains its roles grant. */
export type TTarsTokenGroup = {
  id: string;
  name: string;
  allowed_domains: string[];
};

export type TTarsTokenPrepareData = {
  groups: TTarsTokenGroup[];
  domains: { id: string; name: string }[];
};

/** A hit from the personal-quota user picker; pwc_tars caps the list at 20. */
export type TTarsTokenUser = {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  allowed_domains: string[];
  group_id: string | null;
};

export type TTarsTokenConfigsResponse = { configs: TTarsTokenConfig[] };
export type TTarsTokenQuotasResponse = { quotas: TTarsTokenUserQuota[] };
export type TTarsTokenDefaultsResponse = { defaults: TTarsTokenConfig[] };
export type TTarsTokenUsersResponse = { users: TTarsTokenUser[] };

export type TTarsTokenConfigFilters = {
  domain_id?: string;
  user_group_id?: string;
  provider?: string;
  is_active?: boolean;
};

export type TTarsTokenQuotaFilters = {
  domain_id?: string;
  user_group_id?: string;
  user_id?: string;
  provider?: string;
  status?: string;
};

export type TTarsTokenConfigInput = {
  domain_id?: string | null;
  user_group_id?: string | null;
  provider?: string;
  system_total_limit?: number | null;
  default_user_limit?: number | null;
  reset_type?: string;
  reset_day?: number;
  warning_threshold?: number;
  is_active?: boolean;
};

export type TTarsTokenQuotaInput = {
  user_id?: string;
  provider?: string;
  domain_id?: string | null;
  user_group_id?: string | null;
  custom_limit?: number | null;
  reset_type?: string;
  reset_day?: number;
  warning_threshold?: number;
  status?: string;
};

/** The per-provider fallback rule — a config row with neither brain nor group. */
export type TTarsTokenSystemDefaultInput = {
  provider: string;
  system_total_limit?: number | null;
  default_user_limit?: number | null;
  reset_type?: string;
  reset_day?: number;
  warning_threshold?: number;
};

/** One day of a token report series; pwc_tars pre-fills every date in the range. */
export type TTarsTokenDailyUsage = {
  date: string;
  log_count: number;
  total_tokens: number;
  prompt_tokens?: number;
  completion_tokens?: number;
};

/** A user group's usage for the queried period. */
export type TTarsTokenGroupUsage = {
  user_group_id: string | number | null;
  user_group_name: string | null;
  user_count: number;
  log_count: number;
  total_tokens: number;
  daily_usage: TTarsTokenDailyUsage[];
};

export type TTarsTokenDomainUsage = {
  domain_id: string | null;
  domain_name: string | null;
  total_tokens: number;
};

/** `usage_rate` is already a percentage of the period's model tokens. */
export type TTarsTokenModelUsage = {
  model_name: string;
  total_tokens: number;
  usage_rate: number;
};

export type TTarsTokenReportOverview = {
  group_overview: TTarsTokenGroupUsage[];
  domain_usage: TTarsTokenDomainUsage[];
  model_usage: TTarsTokenModelUsage[];
  date_range: { start_date: string; end_date: string };
};

/** One member's usage inside the selected groups. */
export type TTarsTokenUserUsage = {
  user_id: string | number | null;
  username: string | null;
  display_name: string | null;
  user_group_ids: string[];
  log_count: number;
  total_tokens: number;
};

/** One person's period totals plus the day-by-day series behind them. */
export type TTarsTokenUserUsageDetail = {
  user_id: string;
  log_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  daily_usage: TTarsTokenDailyUsage[];
};

/** Every account's period totals, group-agnostic. */
export type TTarsTokenAccountUsage = {
  user_id: string | number | null;
  username: string | null;
  display_name: string | null;
  log_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** A row of the raw `token_usage_log` dump, used only by the export. */
export type TTarsTokenUsageLogRow = {
  id: string;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  domain_id: string | null;
  user_group_id: string | null;
  user_group_name: string | null;
  provider: string | null;
  model_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  ref_type: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string | null;
};

export type TTarsTokenReportExport = {
  group_usage: TTarsTokenGroupUsage[];
  usage_summary: TTarsTokenAccountUsage[];
  user_usage_log: TTarsTokenUsageLogRow[];
  date_range: { start_date: string; end_date: string };
};

/** Dates are `YYYY-MM-DD`; pwc_tars reads them as whole days in Asia/Taipei. */
export type TTarsTokenReportRange = {
  start_date: string;
  end_date: string;
};

export type TTarsTokenReportMembersQuery = TTarsTokenReportRange & {
  user_group_ids: string[];
};

export type TTarsTokenReportUserQuery = TTarsTokenReportRange & {
  user_id: string;
};

export type TTarsTokenReportMembersResponse = { members: TTarsTokenUserUsage[] };
export type TTarsTokenReportUserResponse = { usage: TTarsTokenUserUsageDetail | null };

/**
 * A pwc_tars long-term memory document (`memory_document` row) as surfaced to
 * the LibreChat client. `structured` marks csv/xlsx/xls files whose contents
 * are queried via the data/table-task tools instead of prompt injection;
 * `status` 1 means the file is included in every chat turn of its conversation.
 */
export type TTarsMemoryDocument = {
  id: string;
  filename: string;
  extension: string | null;
  mime_type: string | null;
  size: number | null;
  status: number;
  word_count: number | null;
  tokens: number | null;
  structured: boolean;
  created_at: string | null;
};

export type TTarsMemoryList = {
  tars_conversation_id: string;
  documents: TTarsMemoryDocument[];
  token_used: number;
  token_limit: number;
};

export type TTarsMemoryProcessedFile = {
  filename: string;
  size: number;
  extension: string;
  document_id: string;
};

export type TTarsMemoryRejectedFile = {
  filename: string;
  tokens: number;
  reason: string;
};

export type TTarsMemoryUploadResult = {
  tars_conversation_id: string;
  processed_files: TTarsMemoryProcessedFile[];
  rejected_files: TTarsMemoryRejectedFile[];
  token_used: number;
  token_limit: number;
};

export type TTarsMemoryDocumentContent = {
  id: string;
  filename: string;
  content: string;
  content_length: number;
  preview_type: string;
  file_available: boolean;
};

/** Speech-to-text models pwc_tars can transcribe audio uploads with. */
export type TTarsSttModels = {
  use_mac_stt?: boolean;
  models: string[];
  message?: string;
};
