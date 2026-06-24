import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult, UseMutationOptions } from '@tanstack/react-query';
import type {
  TTarsDomain,
  TTarsChunk,
  TTarsPrompt,
  TTarsDocument,
  TTarsDomainInput,
  TTarsPromptInput,
  TTarsChunkUpdate,
  TTarsKnowledgeBase,
  TTarsDocumentReprocess,
  TTarsKnowledgeBaseInput,
  TTarsKnowledgeBaseUpdate,
} from 'librechat-data-provider';

type DomainResponse = { domain: TTarsDomain };
type KnowledgeResponse = { knowledgeBase: TTarsKnowledgeBase };
type PromptResponse = { prompt: TTarsPrompt };

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
