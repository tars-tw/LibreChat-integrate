import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TTarsTicket,
  TTarsDomain,
  TTarsChunk,
  TTarsPrompt,
  TTarsDocument,
  TTarsDomainInput,
  TTarsPromptInput,
  TTarsChunkUpdate,
  TTarsKnowledgeBase,
  TTarsSysConfigUpdate,
  TTarsDocumentReprocess,
  TTarsKnowledgeBaseInput,
  TTarsKnowledgeBaseUpdate,
  TTarsKnowledgeBaseModelUpdate,
  TTarsDatasetWebsite,
  TTarsWebsiteImportInput,
  TTarsFileSystemImportInput,
  TTarsDatasetBatchDelete,
  TTarsMcpTool,
  TTarsMcpServer,
  TTarsMcpSyncResult,
  TTarsMcpToolUpdate,
  TTarsMcpParsedSpec,
  TTarsMcpServerInput,
  TTarsMcpUserServerUpdate,
  TTarsDomainMcpSavePayload,
  TTarsUser,
  TTarsUserInput,
  TTarsUserUpdate,
  TTarsUsersResponse,
  TTarsUserImportResult,
  TTarsBulkUserUpdatePayload,
  TTarsUserGroupInput,
  TTarsUserGroupWithMembers,
  TTarsRoleInput,
  TTarsRoleDetail,
  TTarsSystemSettings,
  TTarsLdapConfigInput,
  TTarsWhitelistUser,
  TTarsLdapTreeNode,
  TTarsSyncScheduleInput,
  TTarsTokenConfig,
  TTarsTokenUserQuota,
  TTarsTokenConfigInput,
  TTarsTokenQuotaInput,
  TTarsTokenSystemDefaultInput,
} from 'librechat-data-provider';
import type { UseMutationResult, UseMutationOptions } from '@tanstack/react-query';

type DomainResponse = { domain: TTarsDomain };
type KnowledgeResponse = { knowledgeBase: TTarsKnowledgeBase };
type PromptResponse = { prompt: TTarsPrompt };
type McpServerResponse = { server: TTarsMcpServer };

const invalidateDomains = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsDomainPrepareData]);
  queryClient.invalidateQueries([QueryKeys.tarsDomains]);
};

export const useCreateTarsDomainMutation = (
  options?: UseMutationOptions<DomainResponse, unknown, TTarsDomainInput>,
): UseMutationResult<DomainResponse, unknown, TTarsDomainInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsDomainInput) => dataService.createTarsDomain(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateDomains(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsDomainMutation = (
  options?: UseMutationOptions<
    DomainResponse,
    unknown,
    { id: string | number; data: TTarsDomainInput }
  >,
): UseMutationResult<DomainResponse, unknown, { id: string | number; data: TTarsDomainInput }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string | number; data: TTarsDomainInput }) =>
      dataService.updateTarsDomain(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateDomains(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsDomainMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string | number>,
): UseMutationResult<{ success: boolean }, unknown, string | number> => {
  const queryClient = useQueryClient();
  return useMutation((id: string | number) => dataService.deleteTarsDomain(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateDomains(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

const invalidateKnowledgeBases = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBases]);
  queryClient.invalidateQueries([QueryKeys.tarsDomainPrepareData]);
};

export const useCreateTarsKnowledgeBaseMutation = (
  options?: UseMutationOptions<KnowledgeResponse, unknown, TTarsKnowledgeBaseInput>,
): UseMutationResult<KnowledgeResponse, unknown, TTarsKnowledgeBaseInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsKnowledgeBaseInput) => dataService.createTarsKnowledgeBase(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateKnowledgeBases(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsKnowledgeBaseMutation = (
  options?: UseMutationOptions<
    KnowledgeResponse,
    unknown,
    { id: string; data: TTarsKnowledgeBaseUpdate }
  >,
): UseMutationResult<
  KnowledgeResponse,
  unknown,
  { id: string; data: TTarsKnowledgeBaseUpdate }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsKnowledgeBaseUpdate }) =>
      dataService.updateTarsKnowledgeBase(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateKnowledgeBases(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsKnowledgeBaseMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsKnowledgeBase(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateKnowledgeBases(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

/**
 * Rebinds one knowledge base's rerank / LLM model. pwc_tars has no batch
 * endpoint, so the batch dialog calls this once per selected base.
 */
export const useUpdateTarsKnowledgeBaseModelBindingsMutation = (
  options?: UseMutationOptions<
    KnowledgeResponse,
    unknown,
    { id: string; data: TTarsKnowledgeBaseModelUpdate }
  >,
): UseMutationResult<
  KnowledgeResponse,
  unknown,
  { id: string; data: TTarsKnowledgeBaseModelUpdate }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsKnowledgeBaseModelUpdate }) =>
      dataService.updateTarsKnowledgeBaseModelBindings(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateKnowledgeBases(queryClient);
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseModelBindings]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

/** Anything that changes a knowledge base's datasets refreshes the same list. */
const invalidateDatasets = (
  queryClient: ReturnType<typeof useQueryClient>,
  knowledgeBaseId: string,
) => {
  queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDatasets, knowledgeBaseId]);
  queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBases]);
};

/**
 * Builds a mutation whose only side effect is refreshing the dataset list.
 * Every dataset action shares that shape, so writing it once keeps the
 * individual hooks down to their call.
 */
const useDatasetMutation = <TData, TVariables>(
  knowledgeBaseId: string,
  mutate: (variables: TVariables) => Promise<TData>,
  options?: UseMutationOptions<TData, unknown, TVariables>,
): UseMutationResult<TData, unknown, TVariables> => {
  const queryClient = useQueryClient();
  return useMutation(mutate, {
    ...options,
    onSuccess: (...args) => {
      invalidateDatasets(queryClient, knowledgeBaseId);
      options?.onSuccess?.(...args);
    },
  });
};

export const useImportTarsWebsiteMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<
    { website: TTarsDatasetWebsite | null },
    unknown,
    TTarsWebsiteImportInput
  >,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    (data: TTarsWebsiteImportInput) => dataService.importTarsWebsiteDataset(knowledgeBaseId, data),
    options,
  );

export const useUpdateTarsWebsiteMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<
    { website: TTarsDatasetWebsite | null },
    unknown,
    { websiteId: string; name: string; description?: string }
  >,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    ({ websiteId, name, description }: { websiteId: string; name: string; description?: string }) =>
      dataService.updateTarsWebsiteDataset(knowledgeBaseId, websiteId, { name, description }),
    options,
  );

export const useDeleteTarsWebsiteMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    (websiteId: string) => dataService.deleteTarsWebsiteDataset(knowledgeBaseId, websiteId),
    options,
  );

export const useBindTarsDatabaseMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { databaseId: string; tables: string[] }
  >,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    ({ databaseId, tables }: { databaseId: string; tables: string[] }) =>
      dataService.bindTarsDatabase(knowledgeBaseId, databaseId, tables),
    options,
  );

export const useUnbindTarsDatabaseMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    (databaseId: string) => dataService.unbindTarsDatabase(knowledgeBaseId, databaseId),
    options,
  );

export const useUpdateTarsDatabasePromptMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { databaseId: string; bindingId: string; tableInfo: string }
  >,
): UseMutationResult<
  { success: boolean },
  unknown,
  { databaseId: string; bindingId: string; tableInfo: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({
      databaseId,
      bindingId,
      tableInfo,
    }: {
      databaseId: string;
      bindingId: string;
      tableInfo: string;
    }) =>
      dataService.updateTarsDatabasePrompt(knowledgeBaseId, databaseId, { bindingId, tableInfo }),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsDatabasePrompt, knowledgeBaseId]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useImportTarsFileSystemMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { fileSystemId: string; data: TTarsFileSystemImportInput }
  >,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    ({ fileSystemId, data }: { fileSystemId: string; data: TTarsFileSystemImportInput }) =>
      dataService.importTarsFileSystemDataset(knowledgeBaseId, fileSystemId, data),
    options,
  );

export const useRefreshTarsFileSystemMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { fileSystemId: string; chunkSize?: number; overlap?: number }
  >,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    ({
      fileSystemId,
      chunkSize,
      overlap,
    }: {
      fileSystemId: string;
      chunkSize?: number;
      overlap?: number;
    }) =>
      dataService.refreshTarsFileSystemDataset(knowledgeBaseId, fileSystemId, {
        chunkSize,
        overlap,
      }),
    options,
  );

export const useReprocessTarsFileSystemMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    (fileSystemId: string) =>
      dataService.reprocessTarsFileSystemDataset(knowledgeBaseId, fileSystemId),
    options,
  );

export const useUnlinkTarsFileSystemMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    (fileSystemId: string) =>
      dataService.unlinkTarsFileSystemDataset(knowledgeBaseId, fileSystemId),
    options,
  );

/**
 * pwc_tars answers 202 and deletes on a background thread, so the refreshed
 * list may still show rows that are on their way out.
 */
export const useBatchDeleteTarsDatasetsMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<{ accepted: number }, unknown, TTarsDatasetBatchDelete>,
) =>
  useDatasetMutation(
    knowledgeBaseId,
    (data: TTarsDatasetBatchDelete) => dataService.batchDeleteTarsDatasets(knowledgeBaseId, data),
    options,
  );

export const useUploadTarsKnowledgeBaseMutation = (
  options?: UseMutationOptions<Record<string, unknown>, unknown, FormData>,
): UseMutationResult<Record<string, unknown>, unknown, FormData> => {
  const queryClient = useQueryClient();
  return useMutation((data: FormData) => dataService.uploadTarsKnowledgeBase(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateKnowledgeBases(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUploadTarsDocumentsMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<Record<string, unknown>, unknown, FormData>,
): UseMutationResult<Record<string, unknown>, unknown, FormData> => {
  const queryClient = useQueryClient();
  return useMutation(
    (data: FormData) => dataService.uploadTarsKnowledgeBaseDocuments(knowledgeBaseId, data),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDocuments, knowledgeBaseId]);
        /** The detail page reads documents from the combined dataset list. */
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDatasets, knowledgeBaseId]);
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBases]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useRenameTarsDocumentMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<
    { document: TTarsDocument },
    unknown,
    { docId: string; newFilename: string }
  >,
): UseMutationResult<
  { document: TTarsDocument },
  unknown,
  { docId: string; newFilename: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ docId, newFilename }: { docId: string; newFilename: string }) =>
      dataService.renameTarsKnowledgeBaseDocument(knowledgeBaseId, docId, newFilename),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDocuments, knowledgeBaseId]);
        /** The detail page reads documents from the combined dataset list. */
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDatasets, knowledgeBaseId]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsDocumentMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation(
    (docId: string) => dataService.deleteTarsKnowledgeBaseDocument(knowledgeBaseId, docId),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDocuments, knowledgeBaseId]);
        /** The detail page reads documents from the combined dataset list. */
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDatasets, knowledgeBaseId]);
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBases]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useReprocessTarsDocumentMutation = (
  knowledgeBaseId: string,
  options?: UseMutationOptions<
    Record<string, unknown>,
    unknown,
    { docId: string; data: TTarsDocumentReprocess }
  >,
): UseMutationResult<
  Record<string, unknown>,
  unknown,
  { docId: string; data: TTarsDocumentReprocess }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ docId, data }: { docId: string; data: TTarsDocumentReprocess }) =>
      dataService.reprocessTarsKnowledgeBaseDocument(knowledgeBaseId, docId, data),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDocuments, knowledgeBaseId]);
        /** The detail page reads documents from the combined dataset list. */
        queryClient.invalidateQueries([QueryKeys.tarsKnowledgeBaseDatasets, knowledgeBaseId]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useUpdateTarsChunkMutation = (
  documentId: string,
  options?: UseMutationOptions<
    { chunk: TTarsChunk },
    unknown,
    { chunkId: string; data: TTarsChunkUpdate }
  >,
): UseMutationResult<
  { chunk: TTarsChunk },
  unknown,
  { chunkId: string; data: TTarsChunkUpdate }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ chunkId, data }: { chunkId: string; data: TTarsChunkUpdate }) =>
      dataService.updateTarsChunk(chunkId, data),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsDocumentChunks, documentId]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsChunkMutation = (
  documentId: string,
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((chunkId: string) => dataService.deleteTarsChunk(chunkId), {
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries([QueryKeys.tarsDocumentChunks, documentId]);
      options?.onSuccess?.(...args);
    },
  });
};

const invalidatePrompts = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsPrompts]);
};

export const useCreateTarsPromptMutation = (
  options?: UseMutationOptions<PromptResponse, unknown, TTarsPromptInput>,
): UseMutationResult<PromptResponse, unknown, TTarsPromptInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsPromptInput) => dataService.createTarsPrompt(data), {
    ...options,
    onSuccess: (...args) => {
      invalidatePrompts(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsPromptMutation = (
  options?: UseMutationOptions<PromptResponse, unknown, { id: string; data: TTarsPromptInput }>,
): UseMutationResult<PromptResponse, unknown, { id: string; data: TTarsPromptInput }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsPromptInput }) =>
      dataService.updateTarsPrompt(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidatePrompts(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsPromptMutation = (
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { id: string; domainId?: string; knowledgeBaseId?: string }
  >,
): UseMutationResult<
  { success: boolean },
  unknown,
  { id: string; domainId?: string; knowledgeBaseId?: string }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({
      id,
      domainId,
      knowledgeBaseId,
    }: {
      id: string;
      domainId?: string;
      knowledgeBaseId?: string;
    }) => dataService.deleteTarsPrompt(id, { domainId, knowledgeBaseId }),
    {
      ...options,
      onSuccess: (...args) => {
        invalidatePrompts(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useUpdateTarsSysConfigMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, TTarsSysConfigUpdate>,
): UseMutationResult<{ success: boolean }, unknown, TTarsSysConfigUpdate> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsSysConfigUpdate) => dataService.updateTarsSysConfig(data), {
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries([QueryKeys.tarsSysConfigs]);
      queryClient.invalidateQueries([QueryKeys.endpoints]);
      options?.onSuccess?.(...args);
    },
  });
};

const invalidateTarsMcp = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsMcpServers]);
  queryClient.invalidateQueries([QueryKeys.tarsMcpUserSettings]);
  queryClient.invalidateQueries([QueryKeys.tarsMcpDomainServers]);
  /** Admin mutations change the injected per-server gateway entries — refresh the native MCP surfaces too. */
  queryClient.invalidateQueries([QueryKeys.mcpServers]);
  queryClient.invalidateQueries([QueryKeys.mcpTools]);
  queryClient.invalidateQueries([QueryKeys.mcpConnectionStatus]);
};

export const useCreateTarsMcpServerMutation = (
  options?: UseMutationOptions<McpServerResponse, unknown, TTarsMcpServerInput>,
): UseMutationResult<McpServerResponse, unknown, TTarsMcpServerInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsMcpServerInput) => dataService.createTarsMcpServer(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsMcp(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsMcpServerMutation = (
  options?: UseMutationOptions<
    McpServerResponse,
    unknown,
    { id: string; data: Partial<TTarsMcpServerInput> }
  >,
): UseMutationResult<
  McpServerResponse,
  unknown,
  { id: string; data: Partial<TTarsMcpServerInput> }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: Partial<TTarsMcpServerInput> }) =>
      dataService.updateTarsMcpServer(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateTarsMcp(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsMcpServerMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsMcpServer(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsMcp(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useTestTarsMcpServerMutation = (
  options?: UseMutationOptions<{ result: Record<string, unknown> }, unknown, string>,
): UseMutationResult<{ result: Record<string, unknown> }, unknown, string> => {
  return useMutation((id: string) => dataService.testTarsMcpServer(id), options);
};

export const useSyncTarsMcpServerMutation = (
  options?: UseMutationOptions<{ result: TTarsMcpSyncResult }, unknown, string>,
): UseMutationResult<{ result: TTarsMcpSyncResult }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.syncTarsMcpServer(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsMcp(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useParseTarsMcpOpenapiMutation = (
  options?: UseMutationOptions<
    { parsed: TTarsMcpParsedSpec },
    unknown,
    { openapi_url?: string; base_url?: string; timeout?: number }
  >,
): UseMutationResult<
  { parsed: TTarsMcpParsedSpec },
  unknown,
  { openapi_url?: string; base_url?: string; timeout?: number }
> => {
  return useMutation((data) => dataService.parseTarsMcpOpenapi(data), options);
};

export const useUpdateTarsMcpUserServerMutation = (
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { id: string; data: TTarsMcpUserServerUpdate }
  >,
): UseMutationResult<
  { success: boolean },
  unknown,
  { id: string; data: TTarsMcpUserServerUpdate }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsMcpUserServerUpdate }) =>
      dataService.updateTarsMcpUserServer(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsMcpUserSettings]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useSaveTarsMcpUserCredentialsMutation = (
  options?: UseMutationOptions<
    { result: Record<string, unknown> },
    unknown,
    { id: string; credentials: Record<string, string> }
  >,
): UseMutationResult<
  { result: Record<string, unknown> },
  unknown,
  { id: string; credentials: Record<string, string> }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, credentials }: { id: string; credentials: Record<string, string> }) =>
      dataService.saveTarsMcpUserCredentials(id, credentials),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsMcpUserSettings]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useClearTarsMcpUserCredentialsMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.clearTarsMcpUserCredentials(id), {
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries([QueryKeys.tarsMcpUserSettings]);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsMcpToolMutation = (
  options?: UseMutationOptions<
    { tool: TTarsMcpTool },
    unknown,
    { id: string; data: TTarsMcpToolUpdate }
  >,
): UseMutationResult<{ tool: TTarsMcpTool }, unknown, { id: string; data: TTarsMcpToolUpdate }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsMcpToolUpdate }) =>
      dataService.updateTarsMcpTool(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateTarsMcp(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsMcpToolMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsMcpTool(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsMcp(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useSaveTarsDomainMcpMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, TTarsDomainMcpSavePayload>,
): UseMutationResult<{ success: boolean }, unknown, TTarsDomainMcpSavePayload> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsDomainMcpSavePayload) => dataService.saveTarsDomainMcp(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsMcp(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

type UserResponse = { user: TTarsUser };

const invalidateUsers = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsUsers]);
};

export const useCreateTarsUserMutation = (
  options?: UseMutationOptions<UserResponse, unknown, TTarsUserInput>,
): UseMutationResult<UserResponse, unknown, TTarsUserInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsUserInput) => dataService.createTarsUser(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateUsers(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsUserMutation = (
  options?: UseMutationOptions<UserResponse, unknown, { id: string; data: TTarsUserUpdate }>,
): UseMutationResult<UserResponse, unknown, { id: string; data: TTarsUserUpdate }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsUserUpdate }) => dataService.updateTarsUser(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateUsers(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsUserMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsUser(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateUsers(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useBulkUpdateTarsUsersMutation = (
  options?: UseMutationOptions<TTarsUsersResponse, unknown, TTarsBulkUserUpdatePayload>,
): UseMutationResult<TTarsUsersResponse, unknown, TTarsBulkUserUpdatePayload> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsBulkUserUpdatePayload) => dataService.bulkUpdateTarsUsers(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateUsers(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useBulkDeleteTarsUsersMutation = (
  options?: UseMutationOptions<{ success: boolean; deletedCount: number }, unknown, string[]>,
): UseMutationResult<{ success: boolean; deletedCount: number }, unknown, string[]> => {
  const queryClient = useQueryClient();
  return useMutation((ids: string[]) => dataService.bulkDeleteTarsUsers(ids), {
    ...options,
    onSuccess: (...args) => {
      invalidateUsers(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useResetTarsUserPasswordMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, { id: string; password: string }>,
): UseMutationResult<{ success: boolean }, unknown, { id: string; password: string }> => {
  return useMutation(
    ({ id, password }: { id: string; password: string }) =>
      dataService.resetTarsUserPassword(id, password),
    options,
  );
};

export const useImportTarsUsersMutation = (
  options?: UseMutationOptions<TTarsUserImportResult, unknown, FormData>,
): UseMutationResult<TTarsUserImportResult, unknown, FormData> => {
  const queryClient = useQueryClient();
  return useMutation((data: FormData) => dataService.importTarsUsers(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateUsers(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

type GroupResponse = { group: TTarsUserGroupWithMembers };

/**
 * Group edits also change what the user admin page shows (a user's groups and
 * the roles those groups grant), so both caches are refreshed together.
 */
const invalidateUserGroups = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsUserGroups]);
  queryClient.invalidateQueries([QueryKeys.tarsUsers]);
  queryClient.invalidateQueries([QueryKeys.tarsUserPrepareData]);
};

export const useCreateTarsUserGroupMutation = (
  options?: UseMutationOptions<GroupResponse, unknown, TTarsUserGroupInput>,
): UseMutationResult<GroupResponse, unknown, TTarsUserGroupInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsUserGroupInput) => dataService.createTarsUserGroup(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateUserGroups(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsUserGroupMutation = (
  options?: UseMutationOptions<GroupResponse, unknown, { id: string; data: TTarsUserGroupInput }>,
): UseMutationResult<GroupResponse, unknown, { id: string; data: TTarsUserGroupInput }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsUserGroupInput }) =>
      dataService.updateTarsUserGroup(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateUserGroups(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsUserGroupMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsUserGroup(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateUserGroups(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useAddTarsUserGroupMembersMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, { id: string; userIds: string[] }>,
): UseMutationResult<{ success: boolean }, unknown, { id: string; userIds: string[] }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, userIds }: { id: string; userIds: string[] }) =>
      dataService.addTarsUserGroupMembers(id, userIds),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateUserGroups(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useRemoveTarsUserGroupMemberMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, { id: string; userId: string }>,
): UseMutationResult<{ success: boolean }, unknown, { id: string; userId: string }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, userId }: { id: string; userId: string }) =>
      dataService.removeTarsUserGroupMember(id, userId),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateUserGroups(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

type RoleResponse = { role: TTarsRoleDetail };

/**
 * Roles feed the user and group editors, and marking one the default role makes
 * pwc_tars clear the flag on every other role — so the whole listing plus both
 * dependent pages are refreshed after any role change.
 */
const invalidateRoles = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsRoles]);
  queryClient.invalidateQueries([QueryKeys.tarsUserPrepareData]);
  queryClient.invalidateQueries([QueryKeys.tarsUserGroups]);
  queryClient.invalidateQueries([QueryKeys.tarsUsers]);
};

export const useCreateTarsRoleMutation = (
  options?: UseMutationOptions<RoleResponse, unknown, TTarsRoleInput>,
): UseMutationResult<RoleResponse, unknown, TTarsRoleInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsRoleInput) => dataService.createTarsRole(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateRoles(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsRoleMutation = (
  options?: UseMutationOptions<
    RoleResponse,
    unknown,
    { id: string | number; data: TTarsRoleInput }
  >,
): UseMutationResult<RoleResponse, unknown, { id: string | number; data: TTarsRoleInput }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string | number; data: TTarsRoleInput }) =>
      dataService.updateTarsRole(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateRoles(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsRoleMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string | number>,
): UseMutationResult<{ success: boolean }, unknown, string | number> => {
  const queryClient = useQueryClient();
  return useMutation((id: string | number) => dataService.deleteTarsRole(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateRoles(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

const invalidateSystemLogo = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsSystemSettings]);
};

export const useUploadTarsSystemLogoMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, FormData>,
): UseMutationResult<{ success: boolean }, unknown, FormData> => {
  const queryClient = useQueryClient();
  return useMutation((data: FormData) => dataService.uploadTarsSystemLogo(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateSystemLogo(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useRemoveTarsSystemLogoMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, void>,
): UseMutationResult<{ success: boolean }, unknown, void> => {
  const queryClient = useQueryClient();
  return useMutation(() => dataService.removeTarsSystemLogo(), {
    ...options,
    onSuccess: (...args) => {
      invalidateSystemLogo(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useImportTarsLicenseMutation = (
  options?: UseMutationOptions<TTarsSystemSettings, unknown, FormData>,
): UseMutationResult<TTarsSystemSettings, unknown, FormData> => {
  const queryClient = useQueryClient();
  return useMutation((data: FormData) => dataService.importTarsLicense(data), {
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries([QueryKeys.tarsSystemSettings]);
      options?.onSuccess?.(...args);
    },
  });
};

/**
 * An LDAP change can add, remove or disable pwc_tars accounts and groups, so
 * the user and group listings are refreshed alongside the configurations.
 */
const invalidateSsoConfigs = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsSsoConfigs]);
  queryClient.invalidateQueries([QueryKeys.tarsUsers]);
  queryClient.invalidateQueries([QueryKeys.tarsUserGroups]);
};

export const useCreateTarsSsoConfigMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, TTarsLdapConfigInput>,
): UseMutationResult<{ success: boolean }, unknown, TTarsLdapConfigInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsLdapConfigInput) => dataService.createTarsSsoConfig(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateSsoConfigs(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsSsoConfigMutation = (
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { id: string; data: TTarsLdapConfigInput }
  >,
): UseMutationResult<{ success: boolean }, unknown, { id: string; data: TTarsLdapConfigInput }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsLdapConfigInput }) =>
      dataService.updateTarsSsoConfig(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateSsoConfigs(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsSsoConfigMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsSsoConfig(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateSsoConfigs(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useTestTarsSsoConnectionMutation = (
  options?: UseMutationOptions<
    { message: string },
    unknown,
    { config_id?: string } & TTarsLdapConfigInput
  >,
): UseMutationResult<
  { message: string },
  unknown,
  { config_id?: string } & TTarsLdapConfigInput
> => {
  return useMutation((data) => dataService.testTarsSsoConnection(data), options);
};

export const useTarsLdapTreeMutation = (
  options?: UseMutationOptions<
    { nodes: TTarsLdapTreeNode[] },
    unknown,
    { config_id?: string } & TTarsLdapConfigInput
  >,
): UseMutationResult<
  { nodes: TTarsLdapTreeNode[] },
  unknown,
  { config_id?: string } & TTarsLdapConfigInput
> => {
  return useMutation((data) => dataService.getTarsLdapTree(data), options);
};

export const useTarsSsoWhitelistMutation = (
  options?: UseMutationOptions<
    { users: TTarsWhitelistUser[] },
    unknown,
    { whitelist_users: string } & TTarsLdapConfigInput
  >,
): UseMutationResult<
  { users: TTarsWhitelistUser[] },
  unknown,
  { whitelist_users: string } & TTarsLdapConfigInput
> => {
  return useMutation((data) => dataService.getTarsSsoWhitelist(data), options);
};

export const useImportTarsAdDataMutation = (
  options?: UseMutationOptions<{ message: string }, unknown, { id: string; enableUsers: boolean }>,
): UseMutationResult<{ message: string }, unknown, { id: string; enableUsers: boolean }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, enableUsers }: { id: string; enableUsers: boolean }) =>
      dataService.importTarsAdData(id, enableUsers),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateSsoConfigs(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsAdDataMutation = (
  options?: UseMutationOptions<{ message: string }, unknown, string>,
): UseMutationResult<{ message: string }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsAdData(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateSsoConfigs(queryClient);
      queryClient.invalidateQueries([QueryKeys.tarsSyncSchedule]);
      options?.onSuccess?.(...args);
    },
  });
};

export const useSaveTarsSyncScheduleMutation = (
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { id: string; data: TTarsSyncScheduleInput }
  >,
): UseMutationResult<
  { success: boolean },
  unknown,
  { id: string; data: TTarsSyncScheduleInput }
> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsSyncScheduleInput }) =>
      dataService.saveTarsSyncSchedule(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        queryClient.invalidateQueries([QueryKeys.tarsSyncSchedule]);
        queryClient.invalidateQueries([QueryKeys.tarsSsoConfigs]);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsSyncScheduleMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsSyncSchedule(id), {
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries([QueryKeys.tarsSyncSchedule]);
      queryClient.invalidateQueries([QueryKeys.tarsSsoConfigs]);
      options?.onSuccess?.(...args);
    },
  });
};

export const useCreateTarsTicketMutation = (
  options?: UseMutationOptions<{ ticket: TTarsTicket }, unknown, FormData>,
): UseMutationResult<{ ticket: TTarsTicket }, unknown, FormData> => {
  const queryClient = useQueryClient();
  return useMutation((data: FormData) => dataService.createTarsTicket(data), {
    ...options,
    onSuccess: (...args) => {
      queryClient.invalidateQueries([QueryKeys.tarsTickets]);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsTicketMutation = (
  options?: UseMutationOptions<{ ticket: TTarsTicket }, unknown, { id: string; data: FormData }>,
): UseMutationResult<{ ticket: TTarsTicket }, unknown, { id: string; data: FormData }> => {
  const queryClient = useQueryClient();
  return useMutation(({ id, data }) => dataService.updateTarsTicket(id, data), {
    ...options,
    onSuccess: (result, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.tarsTickets]);
      queryClient.invalidateQueries([QueryKeys.tarsTicket, variables.id]);
      options?.onSuccess?.(result, variables, context);
    },
  });
};

/** A reply lands on the Issue Tracker, so only the detail needs re-reading. */
export const useCreateTarsTicketCommentMutation = (
  options?: UseMutationOptions<{ id: string | null }, unknown, { id: string; body: string }>,
): UseMutationResult<{ id: string | null }, unknown, { id: string; body: string }> => {
  const queryClient = useQueryClient();
  return useMutation(({ id, body }) => dataService.createTarsTicketComment(id, body), {
    ...options,
    onSuccess: (result, variables, context) => {
      queryClient.invalidateQueries([QueryKeys.tarsTicket, variables.id]);
      options?.onSuccess?.(result, variables, context);
    },
  });
};

type TokenConfigResponse = { config: TTarsTokenConfig };
type TokenQuotaResponse = { quota: TTarsTokenUserQuota };

/** Every quota surface reads from the same three tables, so they refresh together. */
const invalidateTarsTokenQuotas = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries([QueryKeys.tarsTokenConfigs]);
  queryClient.invalidateQueries([QueryKeys.tarsTokenQuotas]);
  queryClient.invalidateQueries([QueryKeys.tarsTokenDefaults]);
};

export const useCreateTarsTokenConfigMutation = (
  options?: UseMutationOptions<TokenConfigResponse, unknown, TTarsTokenConfigInput>,
): UseMutationResult<TokenConfigResponse, unknown, TTarsTokenConfigInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsTokenConfigInput) => dataService.createTarsTokenConfig(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsTokenQuotas(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsTokenConfigMutation = (
  options?: UseMutationOptions<
    TokenConfigResponse,
    unknown,
    { id: string; data: TTarsTokenConfigInput }
  >,
): UseMutationResult<TokenConfigResponse, unknown, { id: string; data: TTarsTokenConfigInput }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsTokenConfigInput }) =>
      dataService.updateTarsTokenConfig(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateTarsTokenQuotas(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsTokenConfigMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsTokenConfig(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsTokenQuotas(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useCreateTarsTokenQuotaMutation = (
  options?: UseMutationOptions<TokenQuotaResponse, unknown, TTarsTokenQuotaInput>,
): UseMutationResult<TokenQuotaResponse, unknown, TTarsTokenQuotaInput> => {
  const queryClient = useQueryClient();
  return useMutation((data: TTarsTokenQuotaInput) => dataService.createTarsTokenQuota(data), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsTokenQuotas(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

export const useUpdateTarsTokenQuotaMutation = (
  options?: UseMutationOptions<
    TokenQuotaResponse,
    unknown,
    { id: string; data: TTarsTokenQuotaInput }
  >,
): UseMutationResult<TokenQuotaResponse, unknown, { id: string; data: TTarsTokenQuotaInput }> => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ id, data }: { id: string; data: TTarsTokenQuotaInput }) =>
      dataService.updateTarsTokenQuota(id, data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateTarsTokenQuotas(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};

export const useDeleteTarsTokenQuotaMutation = (
  options?: UseMutationOptions<{ success: boolean }, unknown, string>,
): UseMutationResult<{ success: boolean }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteTarsTokenQuota(id), {
    ...options,
    onSuccess: (...args) => {
      invalidateTarsTokenQuotas(queryClient);
      options?.onSuccess?.(...args);
    },
  });
};

/** Upserts the fallback rule for one provider. */
export const useUpdateTarsTokenDefaultMutation = (
  options?: UseMutationOptions<TokenConfigResponse, unknown, TTarsTokenSystemDefaultInput>,
): UseMutationResult<TokenConfigResponse, unknown, TTarsTokenSystemDefaultInput> => {
  const queryClient = useQueryClient();
  return useMutation(
    (data: TTarsTokenSystemDefaultInput) => dataService.updateTarsTokenSystemDefault(data),
    {
      ...options,
      onSuccess: (...args) => {
        invalidateTarsTokenQuotas(queryClient);
        options?.onSuccess?.(...args);
      },
    },
  );
};
