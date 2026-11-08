import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSaveTarsKnowledgeBaseChatPermissionsMutation } from '../mutations';
import { useTarsKnowledgeBaseChatAssigneesQuery } from '../queries';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getTarsKnowledgeBaseChatPermissions: jest.fn(),
      saveTarsKnowledgeBaseChatPermissions: jest.fn(),
    },
  };
});

const getMock = dataService.getTarsKnowledgeBaseChatPermissions as jest.Mock;
const saveMock = dataService.saveTarsKnowledgeBaseChatPermissions as jest.Mock;

const setup = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { invalidate, wrapper };
};

beforeEach(() => jest.clearAllMocks());

describe('useTarsKnowledgeBaseChatAssigneesQuery', () => {
  it("reads one knowledge base's chat list", async () => {
    const principals = [
      { principal_type: 'user', principal_id: 'u1', name: 'Amy', email: null, is_active: true },
    ];
    getMock.mockResolvedValue({ principals });
    const { wrapper } = setup();

    const { result } = renderHook(() => useTarsKnowledgeBaseChatAssigneesQuery('kb1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(principals));
    expect(getMock).toHaveBeenCalledWith('kb1');
  });

  it('waits for a knowledge base', () => {
    const { wrapper } = setup();

    renderHook(() => useTarsKnowledgeBaseChatAssigneesQuery(null), { wrapper });
    renderHook(() => useTarsKnowledgeBaseChatAssigneesQuery(''), { wrapper });

    expect(getMock).not.toHaveBeenCalled();
  });
});

describe('useSaveTarsKnowledgeBaseChatPermissionsMutation', () => {
  it('saves for the id given with the call and refreshes that list and the counts', async () => {
    saveMock.mockResolvedValue({
      result: { knowledge_base_id: 'kb-new', user_count: 1, group_count: 0 },
    });
    const { invalidate, wrapper } = setup();
    const onSuccess = jest.fn();
    const { result } = renderHook(
      () => useSaveTarsKnowledgeBaseChatPermissionsMutation({ onSuccess }),
      { wrapper },
    );
    const data = { principals: [{ principal_type: 'user' as const, principal_id: 'u1' }] };

    await result.current.mutateAsync({ knowledgeBaseId: 'kb-new', data });

    expect(saveMock).toHaveBeenCalledWith('kb-new', data);
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.tarsKnowledgeBaseChatPermissions, 'kb-new']);
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.tarsKnowledgeBases]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
