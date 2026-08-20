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
};

/** A document inside a knowledge base (pwc_tars `Document.to_dict()`). */
export type TTarsDocument = {
  id: string;
  filename: string;
  knowledge_base_ids?: string | null;
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

export type TTarsChunkUpdate = {
  content: string;
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
