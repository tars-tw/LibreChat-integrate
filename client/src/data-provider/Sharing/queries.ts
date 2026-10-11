import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type { PrincipalDirectoryResponse, SharedWithMeResponse } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';

/** Every user and group the share dialog can offer (the pwc_tars directory). */
export const usePrincipalDirectoryQuery = (
  config?: UseQueryOptions<PrincipalDirectoryResponse>,
): QueryObserverResult<PrincipalDirectoryResponse> => {
  return useQuery<PrincipalDirectoryResponse>(
    [QueryKeys.principalDirectory],
    () => dataService.getPrincipalDirectory(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 30 * 1000,
      ...config,
    },
  );
};

/** Conversations shared with the current user by name or through one of their groups. */
export const useSharedWithMeQuery = (
  config?: UseQueryOptions<SharedWithMeResponse>,
): QueryObserverResult<SharedWithMeResponse> => {
  return useQuery<SharedWithMeResponse>(
    [QueryKeys.sharedWithMe],
    () => dataService.getSharedWithMe(),
    {
      staleTime: 60 * 1000,
      ...config,
    },
  );
};
