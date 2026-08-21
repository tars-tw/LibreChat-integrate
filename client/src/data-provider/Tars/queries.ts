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
  TTarsKnowledgeBasesResponse,
  TTarsKnowledgeBaseModelBindings,
  TTarsKnowledgeBaseDatasets,
  TTarsDatabaseTables,
  TTarsWebsiteChunkPage,
  TTarsDatabasePrompt,
  TTarsFileSystemSource,
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
  TTarsActionLog,
  TTarsActionLogPage,
  TTarsActionLogQuery,
  TTarsActionLogOptionsResponse,
  TTarsAuditQuery,
  TTarsAuditReport,
  TTarsAuditOptionsResponse,
  TTarsTicket,
  TTarsTicketDetail,
  TTarsTicketsResponse,
  TTarsTicketResponse,
  TTarsTicketOptionsResponse,
  TTarsUsageQuery,
  TTarsProviderUsage,
  TTarsTokenPrepareData,
  TTarsTokenConfigFilters,
  TTarsTokenQuotaFilters,
  TTarsTokenConfigsResponse,
  TTarsTokenQuotasResponse,
  TTarsTokenDefaultsResponse,
  TTarsTokenUsersResponse,
  TTarsTokenReportRange,
  TTarsTokenReportOverview,
  TTarsTokenReportMembersQuery,
  TTarsTokenReportMembersResponse,
  TTarsTokenReportUserQuery,
  TTarsTokenReportUserResponse,
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

/**
 * Admin: knowledge bases plus the users and groups the access pickers offer.
 * Shares a cache key with `useTarsKnowledgeBasesQuery`, so the two hooks cost
 * one request between them.
 */
export const useTarsKnowledgeBaseOverviewQuery = (
  config?: UseQueryOptions<TTarsKnowledgeBasesResponse>,
): QueryObserverResult<TTarsKnowledgeBasesResponse> => {
  return useQuery<TTarsKnowledgeBasesResponse>(
    [QueryKeys.tarsKnowledgeBases],
    () => dataService.getTarsKnowledgeBases(),
    { ...adminQueryOptions, ...config },
  );
};

/** The rerank / LLM models one knowledge base may be bound to. */
export const useTarsKnowledgeBaseModelBindingsQuery = (
  knowledgeBaseId?: string | null,
  config?: UseQueryOptions<TTarsKnowledgeBaseModelBindings>,
): QueryObserverResult<TTarsKnowledgeBaseModelBindings> => {
  return useQuery<TTarsKnowledgeBaseModelBindings>(
    [QueryKeys.tarsKnowledgeBaseModelBindings, knowledgeBaseId],
    () => dataService.getTarsKnowledgeBaseModelBindings(knowledgeBaseId ?? ''),
    { enabled: knowledgeBaseId != null && knowledgeBaseId !== '', ...adminQueryOptions, ...config },
  );
};

/**
 * Every dataset in a knowledge base, plus the system upload limits.
 *
 * Polls while anything is still ingesting: pwc_tars processes uploads,
 * crawls and document-group syncs on background threads, so the statuses
 * only settle after the request that started them has long returned.
 */
export const useTarsKnowledgeBaseDatasetsQuery = (
  knowledgeBaseId?: string | null,
  config?: UseQueryOptions<TTarsKnowledgeBaseDatasets>,
): QueryObserverResult<TTarsKnowledgeBaseDatasets> => {
  return useQuery<TTarsKnowledgeBaseDatasets>(
    [QueryKeys.tarsKnowledgeBaseDatasets, knowledgeBaseId],
    () => dataService.getTarsKnowledgeBaseDatasets(knowledgeBaseId ?? ''),
    {
      enabled: knowledgeBaseId != null && knowledgeBaseId !== '',
      refetchOnWindowFocus: false,
      refetchInterval: (data) =>
        (data?.documents ?? []).some((doc) => PROCESSING_STATUSES.has(doc.status)) ? 5000 : false,
      ...config,
    },
  );
};

/** Every crawled chunk of one website dataset. Unpaged, like the document one. */
export const useTarsWebsiteChunksQuery = (
  knowledgeBaseId: string,
  websiteId?: string | null,
  config?: UseQueryOptions<TTarsWebsiteChunkPage>,
): QueryObserverResult<TTarsWebsiteChunkPage> => {
  return useQuery<TTarsWebsiteChunkPage>(
    [QueryKeys.tarsWebsiteChunks, knowledgeBaseId, websiteId],
    () => dataService.getTarsWebsiteChunks(knowledgeBaseId, websiteId ?? ''),
    { enabled: websiteId != null && websiteId !== '', ...adminQueryOptions, ...config },
  );
};

/** The tables a connection exposes, and which are already bound. */
export const useTarsDatabaseTablesQuery = (
  knowledgeBaseId: string,
  databaseId?: string | null,
  config?: UseQueryOptions<TTarsDatabaseTables>,
): QueryObserverResult<TTarsDatabaseTables> => {
  return useQuery<TTarsDatabaseTables>(
    [QueryKeys.tarsDatabaseTables, knowledgeBaseId, databaseId],
    () => dataService.getTarsDatabaseTables(knowledgeBaseId, databaseId ?? ''),
    {
      enabled: databaseId != null && databaseId !== '',
      /** Opening a real connection is slow; do not repeat it on a focus change. */
      refetchOnWindowFocus: false,
      retry: false,
      ...config,
    },
  );
};

/** The schema description the text-to-SQL prompt is built from. */
export const useTarsDatabasePromptQuery = (
  knowledgeBaseId: string,
  databaseId?: string | null,
  config?: UseQueryOptions<TTarsDatabasePrompt>,
): QueryObserverResult<TTarsDatabasePrompt> => {
  return useQuery<TTarsDatabasePrompt>(
    [QueryKeys.tarsDatabasePrompt, knowledgeBaseId, databaseId],
    () => dataService.getTarsDatabasePrompt(knowledgeBaseId, databaseId ?? ''),
    { enabled: databaseId != null && databaseId !== '', ...adminQueryOptions, ...config },
  );
};

/** File servers this knowledge base may import a document group from. */
export const useTarsFileSystemSourcesQuery = (
  knowledgeBaseId?: string | null,
  config?: UseQueryOptions<{ sources: TTarsFileSystemSource[] }, unknown, TTarsFileSystemSource[]>,
): QueryObserverResult<TTarsFileSystemSource[]> => {
  return useQuery<{ sources: TTarsFileSystemSource[] }, unknown, TTarsFileSystemSource[]>(
    [QueryKeys.tarsFileSystemSources, knowledgeBaseId],
    () => dataService.getTarsFileSystemSources(knowledgeBaseId ?? ''),
    {
      enabled: knowledgeBaseId != null && knowledgeBaseId !== '',
      select: (data) => data.sources ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** What a file server currently holds, for the import picker. */
export const useTarsFileSystemFilesQuery = (
  knowledgeBaseId: string,
  fileSystemId?: string | null,
  config?: UseQueryOptions<{ files: string[] }, unknown, string[]>,
): QueryObserverResult<string[]> => {
  return useQuery<{ files: string[] }, unknown, string[]>(
    [QueryKeys.tarsFileSystemFiles, knowledgeBaseId, fileSystemId],
    () => dataService.getTarsFileSystemFiles(knowledgeBaseId, fileSystemId ?? ''),
    {
      enabled: fileSystemId != null && fileSystemId !== '',
      select: (data) => data.files ?? [],
      /** Walking the remote tree is slow; do not repeat it on a focus change. */
      refetchOnWindowFocus: false,
      retry: false,
      ...config,
    },
  );
};

/** Admin: knowledge bases with per-type dataset counts. */
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

/** Admin: ticket history for the operator, with live Issue Tracker status. */
export const useTarsTicketsQuery = (
  config?: UseQueryOptions<TTarsTicketsResponse, unknown, TTarsTicket[]>,
): QueryObserverResult<TTarsTicket[]> => {
  return useQuery<TTarsTicketsResponse, unknown, TTarsTicket[]>(
    [QueryKeys.tarsTickets],
    () => dataService.getTarsTickets(),
    {
      select: (data) => data.tickets ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/**
 * Admin: one ticket with its Issue Tracker status, comments and attachments.
 * Disabled until a ticket is selected, and never cached — the remote status
 * decides whether the form is editable, so a stale value would mislead.
 */
export const useTarsTicketQuery = (
  ticketId: string | null,
  config?: UseQueryOptions<TTarsTicketResponse, unknown, TTarsTicketDetail | null>,
): QueryObserverResult<TTarsTicketDetail | null> => {
  return useQuery<TTarsTicketResponse, unknown, TTarsTicketDetail | null>(
    [QueryKeys.tarsTicket, ticketId ?? ''],
    () => dataService.getTarsTicket(ticketId as string),
    {
      enabled: ticketId != null && ticketId !== '',
      select: (data) => data.ticket ?? null,
      staleTime: 0,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: type / priority / severity domains plus Issue Tracker components. */
export const useTarsTicketOptionsQuery = (
  config?: UseQueryOptions<TTarsTicketOptionsResponse>,
): QueryObserverResult<TTarsTicketOptionsResponse> => {
  return useQuery<TTarsTicketOptionsResponse>(
    [QueryKeys.tarsTicketOptions],
    () => dataService.getTarsTicketOptions(),
    { ...adminQueryOptions, ...config },
  );
};

/** Admin: the users / specialized brains / knowledge bases the audit filters offer. */
export const useTarsAuditOptionsQuery = (
  config?: UseQueryOptions<TTarsAuditOptionsResponse>,
): QueryObserverResult<TTarsAuditOptionsResponse> => {
  return useQuery<TTarsAuditOptionsResponse>(
    [QueryKeys.tarsAuditOptions],
    () => dataService.getTarsAuditOptions(),
    { ...adminQueryOptions, ...config },
  );
};

/**
 * Admin: the message audit report for one submitted filter set.
 *
 * Keyed on the filters so re-running an earlier search is free, but disabled
 * until the operator presses Search — the query is expensive upstream and
 * returns the full response text of every message in the period, so it must
 * never fire on a half-typed filter.
 */
export const useTarsAuditReportQuery = (
  query: TTarsAuditQuery | null,
  config?: UseQueryOptions<TTarsAuditReport>,
): QueryObserverResult<TTarsAuditReport> => {
  return useQuery<TTarsAuditReport>(
    [QueryKeys.tarsAuditReport, query],
    () => dataService.getTarsAuditReport(query as TTarsAuditQuery),
    {
      enabled: query != null,
      keepPreviousData: true,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: users, action types and modules for the operation-audit filter bar. */
export const useTarsOperationLogOptionsQuery = (
  config?: UseQueryOptions<TTarsActionLogOptionsResponse>,
): QueryObserverResult<TTarsActionLogOptionsResponse> => {
  return useQuery<TTarsActionLogOptionsResponse>(
    [QueryKeys.tarsOperationLogOptions],
    () => dataService.getTarsOperationLogOptions(),
    { ...adminQueryOptions, ...config },
  );
};

/**
 * Admin: one page of the system operation audit trail.
 *
 * pwc_tars pages this server-side, so the page number belongs in the key —
 * turning a page is a new request, and each one stays cached on its own.
 */
export const useTarsOperationLogsQuery = (
  query: TTarsActionLogQuery | null,
  config?: UseQueryOptions<TTarsActionLogPage>,
): QueryObserverResult<TTarsActionLogPage> => {
  return useQuery<TTarsActionLogPage>(
    [QueryKeys.tarsOperationLogs, query],
    () => dataService.getTarsOperationLogs(query as TTarsActionLogQuery),
    {
      enabled: query != null,
      keepPreviousData: true,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: one operator's whole activity in the window, for the timeline panel. */
export const useTarsUserOperationLogsQuery = (
  userId: string | null,
  window: { start_date?: string; end_date?: string },
  config?: UseQueryOptions<{ logs: TTarsActionLog[] }, unknown, TTarsActionLog[]>,
): QueryObserverResult<TTarsActionLog[]> => {
  return useQuery<{ logs: TTarsActionLog[] }, unknown, TTarsActionLog[]>(
    [QueryKeys.tarsOperationLogsByUser, userId ?? '', window],
    () => dataService.getTarsOperationLogsByUser(userId as string, window),
    {
      enabled: userId != null && userId !== '',
      select: (data) => data.logs ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/**
 * Admin: one month of provider spend.
 *
 * Disabled until the operator presses Search — pwc_tars pages the provider's
 * admin API a day at a time, so it must never fire on a half-typed budget.
 */
export const useTarsProviderUsageQuery = (
  query: TTarsUsageQuery | null,
  config?: UseQueryOptions<TTarsProviderUsage>,
): QueryObserverResult<TTarsProviderUsage> => {
  return useQuery<TTarsProviderUsage>(
    [QueryKeys.tarsProviderUsage, query],
    () => dataService.getTarsProviderUsage(query as TTarsUsageQuery),
    {
      enabled: query != null,
      keepPreviousData: true,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: the groups and specialized brains the quota forms pick from. */
export const useTarsTokenPrepareDataQuery = (
  config?: UseQueryOptions<TTarsTokenPrepareData>,
): QueryObserverResult<TTarsTokenPrepareData> => {
  return useQuery<TTarsTokenPrepareData>(
    [QueryKeys.tarsTokenPrepareData],
    () => dataService.getTarsTokenPrepareData(),
    { ...adminQueryOptions, ...config },
  );
};

/**
 * Admin: users matching the personal-quota picker's term. Upstream caps the
 * result at 20 rows, so this stays a search rather than a full listing.
 */
export const useTarsTokenUsersQuery = (
  keyword: string,
  config?: UseQueryOptions<TTarsTokenUsersResponse, unknown, TTarsTokenUsersResponse['users']>,
): QueryObserverResult<TTarsTokenUsersResponse['users']> => {
  return useQuery<TTarsTokenUsersResponse, unknown, TTarsTokenUsersResponse['users']>(
    [QueryKeys.tarsTokenUsers, keyword],
    () => dataService.searchTarsTokenUsers(keyword),
    {
      select: (data) => data.users ?? [],
      keepPreviousData: true,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: the group-level quota rules, optionally narrowed by the filter bar. */
export const useTarsTokenConfigsQuery = (
  filters: TTarsTokenConfigFilters = {},
  config?: UseQueryOptions<
    TTarsTokenConfigsResponse,
    unknown,
    TTarsTokenConfigsResponse['configs']
  >,
): QueryObserverResult<TTarsTokenConfigsResponse['configs']> => {
  return useQuery<TTarsTokenConfigsResponse, unknown, TTarsTokenConfigsResponse['configs']>(
    [QueryKeys.tarsTokenConfigs, filters],
    () => dataService.getTarsTokenConfigs(filters),
    {
      select: (data) => data.configs ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: the per-person quota overrides. */
export const useTarsTokenQuotasQuery = (
  filters: TTarsTokenQuotaFilters = {},
  config?: UseQueryOptions<TTarsTokenQuotasResponse, unknown, TTarsTokenQuotasResponse['quotas']>,
): QueryObserverResult<TTarsTokenQuotasResponse['quotas']> => {
  return useQuery<TTarsTokenQuotasResponse, unknown, TTarsTokenQuotasResponse['quotas']>(
    [QueryKeys.tarsTokenQuotas, filters],
    () => dataService.getTarsTokenQuotas(filters),
    {
      select: (data) => data.quotas ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: the per-provider fallback rules used when no group rule matches. */
export const useTarsTokenDefaultsQuery = (
  config?: UseQueryOptions<
    TTarsTokenDefaultsResponse,
    unknown,
    TTarsTokenDefaultsResponse['defaults']
  >,
): QueryObserverResult<TTarsTokenDefaultsResponse['defaults']> => {
  return useQuery<TTarsTokenDefaultsResponse, unknown, TTarsTokenDefaultsResponse['defaults']>(
    [QueryKeys.tarsTokenDefaults],
    () => dataService.getTarsTokenSystemDefaults(),
    {
      select: (data) => data.defaults ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/**
 * Admin: the token usage report for one period.
 *
 * Disabled until a range is submitted — pwc_tars scans the whole usage log, so
 * it must never fire while the operator is still picking dates.
 */
export const useTarsTokenReportOverviewQuery = (
  range: TTarsTokenReportRange | null,
  config?: UseQueryOptions<TTarsTokenReportOverview>,
): QueryObserverResult<TTarsTokenReportOverview> => {
  return useQuery<TTarsTokenReportOverview>(
    [QueryKeys.tarsTokenReportOverview, range],
    () => dataService.getTarsTokenReportOverview(range as TTarsTokenReportRange),
    {
      enabled: range != null,
      keepPreviousData: true,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: member totals inside the drilled-into user groups. */
export const useTarsTokenReportMembersQuery = (
  query: TTarsTokenReportMembersQuery | null,
  config?: UseQueryOptions<
    TTarsTokenReportMembersResponse,
    unknown,
    TTarsTokenReportMembersResponse['members']
  >,
): QueryObserverResult<TTarsTokenReportMembersResponse['members']> => {
  return useQuery<
    TTarsTokenReportMembersResponse,
    unknown,
    TTarsTokenReportMembersResponse['members']
  >(
    [QueryKeys.tarsTokenReportMembers, query],
    () => dataService.getTarsTokenReportMembers(query as TTarsTokenReportMembersQuery),
    {
      enabled: query != null && query.user_group_ids.length > 0,
      select: (data) => data.members ?? [],
      keepPreviousData: true,
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: one person's daily token usage, loaded when their row is opened. */
export const useTarsTokenReportUserQuery = (
  query: TTarsTokenReportUserQuery | null,
  config?: UseQueryOptions<
    TTarsTokenReportUserResponse,
    unknown,
    TTarsTokenReportUserResponse['usage']
  >,
): QueryObserverResult<TTarsTokenReportUserResponse['usage']> => {
  return useQuery<TTarsTokenReportUserResponse, unknown, TTarsTokenReportUserResponse['usage']>(
    [QueryKeys.tarsTokenReportUser, query],
    () => dataService.getTarsTokenReportUser(query as TTarsTokenReportUserQuery),
    {
      enabled: query != null,
      select: (data) => data.usage ?? null,
      ...adminQueryOptions,
      ...config,
    },
  );
};
