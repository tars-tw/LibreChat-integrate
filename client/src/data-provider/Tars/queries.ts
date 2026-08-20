import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TTarsDomain,
  TTarsChunk,
  TTarsDocument,
  TTarsUser,
  TTarsSysConfig,
  TTarsMcpServer,
  TTarsModelOptions,
  TTarsModelsResponse,
  TTarsChunksResponse,
  TTarsDomainsResponse,
  TTarsKnowledgeBase,
  TTarsMcpUserServer,
  TTarsPromptsResponse,
  TTarsDocumentsResponse,
  TTarsDomainPrepareData,
  TTarsSysConfigsResponse,
  TTarsUsersResponse,
  TTarsUserPrepareData,
  TTarsAdWhitelistResponse,
  TTarsGroupPrepareData,
  TTarsRolePrepareData,
  TTarsSsoConfig,
  TTarsSsoConfigsResponse,
  TTarsSystemSettings,
  TTarsSyncSchedule,
  TTarsSyncScheduleResponse,
  TTarsMcpLog,
  TTarsMcpLogsResponse,
  TTarsMcpServersResponse,
  TTarsDomainMcpRelation,
  TTarsMcpDomainServer,
  TTarsMcpUserSettingsResponse,
  TTarsDomainMcpServersResponse,
  TTarsMcpDomainToolsResponse,
} from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';

/** pwc_tars document status: 0 uploaded, 1 processing, 2 completed, 4 failed. */
const PROCESSING_STATUSES = new Set([0, 1]);

const adminQueryOptions = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
} as const;

/**
 * Lists the pwc_tars specialized brains (專用腦) the authenticated user may
 * access. Returns [] for non-tars users or when the integration is unconfigured.
 */
export const useTarsDomainsQuery = (
  config?: UseQueryOptions<TTarsDomainsResponse, unknown, TTarsDomain[]>,
): QueryObserverResult<TTarsDomain[]> => {
  return useQuery<TTarsDomainsResponse, unknown, TTarsDomain[]>(
    [QueryKeys.tarsDomains],
    () => dataService.getTarsDomains(),
    {
      select: (data) => data.domains ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: all domains, knowledge bases and roles for the domain editor. */
export const useTarsDomainPrepareDataQuery = (
  config?: UseQueryOptions<TTarsDomainPrepareData>,
): QueryObserverResult<TTarsDomainPrepareData> => {
  return useQuery<TTarsDomainPrepareData>(
    [QueryKeys.tarsDomainPrepareData],
    () => dataService.getTarsDomainPrepareData(),
    { ...adminQueryOptions, ...config },
  );
};

/** Admin: knowledge bases with document/chunk/token stats. */
export const useTarsKnowledgeBasesQuery = (
  config?: UseQueryOptions<{ knowledgeBases: TTarsKnowledgeBase[] }, unknown, TTarsKnowledgeBase[]>,
): QueryObserverResult<TTarsKnowledgeBase[]> => {
  return useQuery<{ knowledgeBases: TTarsKnowledgeBase[] }, unknown, TTarsKnowledgeBase[]>(
    [QueryKeys.tarsKnowledgeBases],
    () => dataService.getTarsKnowledgeBases(),
    {
      select: (data) => data.knowledgeBases ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/**
 * Documents inside a knowledge base. Polls every 5s while any document is still
 * uploading/processing so status badges update without a manual refresh.
 */
export const useTarsKnowledgeBaseDocumentsQuery = (
  knowledgeBaseId?: string | null,
  config?: UseQueryOptions<TTarsDocumentsResponse, unknown, TTarsDocument[]>,
): QueryObserverResult<TTarsDocument[]> => {
  return useQuery<TTarsDocumentsResponse, unknown, TTarsDocument[]>(
    [QueryKeys.tarsKnowledgeBaseDocuments, knowledgeBaseId],
    () => dataService.getTarsKnowledgeBaseDocuments(knowledgeBaseId ?? ''),
    {
      enabled: !!knowledgeBaseId,
      select: (data) => data.documents ?? [],
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: (data) =>
        (data ?? []).some((doc) => PROCESSING_STATUSES.has(doc.status)) ? 5000 : false,
      ...config,
    },
  );
};

/** Chunks of a document. Disabled until a `documentId` is known. */
export const useTarsDocumentChunksQuery = (
  documentId?: string | null,
  config?: UseQueryOptions<TTarsChunksResponse, unknown, TTarsChunk[]>,
): QueryObserverResult<TTarsChunk[]> => {
  return useQuery<TTarsChunksResponse, unknown, TTarsChunk[]>(
    [QueryKeys.tarsDocumentChunks, documentId],
    () => dataService.getTarsDocumentChunks(documentId ?? ''),
    {
      enabled: !!documentId,
      select: (data) => data.chunks ?? [],
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

/**
 * The three-tier "我的提示" list (personal + specialized brain + its knowledge
 * bases) for the given brain. Disabled until a `domainId` is known.
 */
export const useTarsPromptsQuery = (
  domainId?: string | null,
  config?: UseQueryOptions<TTarsPromptsResponse>,
): QueryObserverResult<TTarsPromptsResponse> => {
  return useQuery<TTarsPromptsResponse>(
    [QueryKeys.tarsPrompts, domainId],
    () => dataService.getTarsPrompts(domainId ?? undefined),
    {
      enabled: !!domainId,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

/**
 * The user's personal "我的提示" (`prompt` table) — the tier the prompts
 * management page reads and writes. Omitting the brain makes the backend skip
 * the specialized-brain and knowledge-base tiers.
 */
export const useTarsPersonalPromptsQuery = (
  config?: UseQueryOptions<TTarsPromptsResponse>,
): QueryObserverResult<TTarsPromptsResponse> =>
  useTarsPromptsQuery(null, { enabled: true, ...config });

/** Admin: pwc_tars 系統參數設定 rows. */
export const useTarsSysConfigsQuery = (
  config?: UseQueryOptions<TTarsSysConfigsResponse, unknown, TTarsSysConfig[]>,
): QueryObserverResult<TTarsSysConfig[]> => {
  return useQuery<TTarsSysConfigsResponse, unknown, TTarsSysConfig[]>(
    [QueryKeys.tarsSysConfigs],
    () => dataService.getTarsSysConfigs(),
    {
      select: (data) => data.sysConfigs ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: pwc_tars MCP servers (openapi / custom_api / external / builtin). */
export const useTarsMcpServersQuery = (
  config?: UseQueryOptions<TTarsMcpServersResponse, unknown, TTarsMcpServer[]>,
): QueryObserverResult<TTarsMcpServer[]> => {
  return useQuery<TTarsMcpServersResponse, unknown, TTarsMcpServer[]>(
    [QueryKeys.tarsMcpServers],
    () => dataService.getTarsMcpServers(),
    {
      select: (data) => data.servers ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: one pwc_tars MCP server's detail, including its `mcp_tools` rows. */
export const useTarsMcpServerQuery = (
  serverId: string | null,
  config?: UseQueryOptions<{ server: TTarsMcpServer }, unknown, TTarsMcpServer | null>,
): QueryObserverResult<TTarsMcpServer | null> => {
  return useQuery<{ server: TTarsMcpServer }, unknown, TTarsMcpServer | null>(
    [QueryKeys.tarsMcpServers, serverId],
    () => dataService.getTarsMcpServer(serverId as string),
    {
      select: (data) => data.server ?? null,
      enabled: serverId != null,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: existing domain↔MCP bindings (`sys_domain_mcp` rows) of one domain. */
export const useTarsDomainMcpServersQuery = (
  domainId: number | null,
  config?: UseQueryOptions<TTarsDomainMcpServersResponse, unknown, TTarsDomainMcpRelation[]>,
): QueryObserverResult<TTarsDomainMcpRelation[]> => {
  return useQuery<TTarsDomainMcpServersResponse, unknown, TTarsDomainMcpRelation[]>(
    [QueryKeys.tarsMcpDomainServers, domainId],
    () => dataService.getTarsDomainMcpServers(domainId as number),
    {
      select: (data) => data.servers ?? [],
      enabled: domainId != null,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: recent `mcp_logs` audit rows (newest first). */
export const useTarsMcpLogsQuery = (
  query?: { conversationId?: string; limit?: number },
  config?: UseQueryOptions<TTarsMcpLogsResponse, unknown, TTarsMcpLog[]>,
): QueryObserverResult<TTarsMcpLog[]> => {
  return useQuery<TTarsMcpLogsResponse, unknown, TTarsMcpLog[]>(
    [QueryKeys.tarsMcpLogs, query?.conversationId ?? '', query?.limit ?? 0],
    () => dataService.getTarsMcpLogs(query),
    {
      select: (data) => data.logs ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/**
 * The authenticated user's pwc_tars MCP tool panel: domain-visible servers and
 * tools with the user's own enable states and credential status.
 */
export const useTarsMcpUserSettingsQuery = (
  config?: UseQueryOptions<TTarsMcpUserSettingsResponse, unknown, TTarsMcpUserServer[]>,
): QueryObserverResult<TTarsMcpUserServer[]> => {
  return useQuery<TTarsMcpUserSettingsResponse, unknown, TTarsMcpUserServer[]>(
    [QueryKeys.tarsMcpUserSettings],
    () => dataService.getTarsMcpUserSettings(),
    {
      select: (data) => data.servers ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/**
 * The MCP servers/tools the given brain (domain) may use, filtered by pwc_tars
 * with both the domain whitelist and the user's own toggles. Feeds the chat
 * dropdown's per-tool selection.
 */
export const useTarsMcpDomainToolsQuery = (
  domainId: string | number | null,
  config?: UseQueryOptions<TTarsMcpDomainToolsResponse, unknown, TTarsMcpDomainServer[]>,
): QueryObserverResult<TTarsMcpDomainServer[]> => {
  return useQuery<TTarsMcpDomainToolsResponse, unknown, TTarsMcpDomainServer[]>(
    [QueryKeys.tarsMcpDomainTools, String(domainId ?? '')],
    () => dataService.getTarsMcpUserDomainTools(domainId as string | number),
    {
      select: (data) => data.servers ?? [],
      enabled: domainId != null && domainId !== '',
      ...adminQueryOptions,
      ...config,
    },
  );
};

/**
 * The pwc_tars model_profile whitelist for the model selector. `null` means no
 * restriction (TARS unconfigured, unreachable, or the request failed).
 */
export const useTarsAllowedModelsQuery = (
  config?: UseQueryOptions<TTarsModelsResponse, unknown, string[] | null>,
): QueryObserverResult<string[] | null> => {
  return useQuery<TTarsModelsResponse, unknown, string[] | null>(
    [QueryKeys.tarsModels],
    () => dataService.getTarsModels(),
    {
      select: (data) => data.models ?? null,
      staleTime: 5 * 60 * 1000,
      retry: false,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: LLM / embedding / rerank model options for the upload form. */
export const useTarsModelOptionsQuery = (
  config?: UseQueryOptions<TTarsModelOptions>,
): QueryObserverResult<TTarsModelOptions> => {
  return useQuery<TTarsModelOptions>(
    [QueryKeys.tarsModelOptions],
    () => dataService.getTarsKnowledgeBaseModels(),
    { ...adminQueryOptions, ...config },
  );
};

/** Admin: every pwc_tars account, with online state and resolved role names. */
export const useTarsUsersQuery = (
  config?: UseQueryOptions<TTarsUsersResponse, unknown, TTarsUser[]>,
): QueryObserverResult<TTarsUser[]> => {
  return useQuery<TTarsUsersResponse, unknown, TTarsUser[]>(
    [QueryKeys.tarsUsers],
    () => dataService.getTarsUsers(),
    {
      select: (data) => data.users ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: roles, user groups and SSO status for the user admin editors. */
export const useTarsUserPrepareDataQuery = (
  config?: UseQueryOptions<TTarsUserPrepareData>,
): QueryObserverResult<TTarsUserPrepareData> => {
  return useQuery<TTarsUserPrepareData>(
    [QueryKeys.tarsUserPrepareData],
    () => dataService.getTarsUserPrepareData(),
    { ...adminQueryOptions, ...config },
  );
};

/**
 * Admin: the LDAP whitelist usernames selectable when creating an AD-backed
 * account. Disabled until the create form actually switches to AD mode.
 */
export const useTarsAdWhitelistQuery = (
  enabled: boolean,
  config?: UseQueryOptions<TTarsAdWhitelistResponse, unknown, string[]>,
): QueryObserverResult<string[]> => {
  return useQuery<TTarsAdWhitelistResponse, unknown, string[]>(
    [QueryKeys.tarsAdWhitelist],
    () => dataService.getTarsAdWhitelist(),
    {
      enabled,
      select: (data) => data.usernames ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: every pwc_tars user group (with its member list) plus all roles. */
export const useTarsUserGroupsQuery = (
  config?: UseQueryOptions<TTarsGroupPrepareData>,
): QueryObserverResult<TTarsGroupPrepareData> => {
  return useQuery<TTarsGroupPrepareData>(
    [QueryKeys.tarsUserGroups],
    () => dataService.getTarsUserGroups(),
    { ...adminQueryOptions, ...config },
  );
};

/** Admin: every pwc_tars role plus the specialized brains they can be bound to. */
export const useTarsRolesQuery = (
  config?: UseQueryOptions<TTarsRolePrepareData>,
): QueryObserverResult<TTarsRolePrepareData> => {
  return useQuery<TTarsRolePrepareData>([QueryKeys.tarsRoles], () => dataService.getTarsRoles(), {
    ...adminQueryOptions,
    ...config,
  });
};

/** Admin: pwc_tars licence status and validity window. */
export const useTarsSystemSettingsQuery = (
  config?: UseQueryOptions<TTarsSystemSettings>,
): QueryObserverResult<TTarsSystemSettings> => {
  return useQuery<TTarsSystemSettings>(
    [QueryKeys.tarsSystemSettings],
    () => dataService.getTarsSystemSettings(),
    { ...adminQueryOptions, ...config },
  );
};

/** Admin: every stored LDAP configuration. */
export const useTarsSsoConfigsQuery = (
  config?: UseQueryOptions<TTarsSsoConfigsResponse, unknown, TTarsSsoConfig[]>,
): QueryObserverResult<TTarsSsoConfig[]> => {
  return useQuery<TTarsSsoConfigsResponse, unknown, TTarsSsoConfig[]>(
    [QueryKeys.tarsSsoConfigs],
    () => dataService.getTarsSsoConfigs(),
    {
      select: (data) => data.configs ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: one configuration's sync schedule. Disabled until a config is chosen. */
export const useTarsSyncScheduleQuery = (
  configId: string | null,
  config?: UseQueryOptions<TTarsSyncScheduleResponse, unknown, TTarsSyncSchedule | null>,
): QueryObserverResult<TTarsSyncSchedule | null> => {
  return useQuery<TTarsSyncScheduleResponse, unknown, TTarsSyncSchedule | null>(
    [QueryKeys.tarsSyncSchedule, configId ?? ''],
    () => dataService.getTarsSyncSchedule(configId as string),
    {
      enabled: configId != null && configId !== '',
      select: (data) => data.schedule ?? null,
      ...adminQueryOptions,
      ...config,
    },
  );
};
