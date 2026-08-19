import { QueryKeys, dataService } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
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
