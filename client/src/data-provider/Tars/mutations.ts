import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult, UseMutationOptions } from '@tanstack/react-query';
import type {
  TTarsDomain,
  TTarsPrompt,
  TTarsDomainInput,
  TTarsPromptInput,
  TTarsKnowledgeBase,
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
