import React from 'react';
import { renderHook } from '@testing-library/react';
import { dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TTarsMcpDirectToolsResponse } from 'librechat-data-provider';
import { useUpdateTarsMcpDirectToolsMutation } from '../mutations';
import { tarsMcpDirectToolsKey } from '../queries';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: { ...actual.dataService, updateTarsMcpDirectTools: jest.fn() },
  };
});

const setup = () => {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
};

const readTools = (queryClient: QueryClient) =>
  queryClient
    .getQueryData<TTarsMcpDirectToolsResponse>(tarsMcpDirectToolsKey('s1'))
    ?.tools.filter((tool) => tool.is_enabled)
    .map((tool) => tool.name);

describe('useUpdateTarsMcpDirectToolsMutation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('applies the saved list at once, so the next toggle does not build on a stale one', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData<TTarsMcpDirectToolsResponse>(tarsMcpDirectToolsKey('s1'), {
      tools_status: 'ok',
      tools: [
        { name: 'health', is_enabled: false },
        { name: 'whoami', is_enabled: true },
      ],
    });
    (dataService.updateTarsMcpDirectTools as jest.Mock).mockResolvedValue({
      enabled_tools: ['health', 'whoami'],
    });

    const { result } = renderHook(() => useUpdateTarsMcpDirectToolsMutation('s1'), { wrapper });
    await result.current.mutateAsync(['health', 'whoami']);

    expect(readTools(queryClient)).toEqual(['health', 'whoami']);
  });

  it('leaves the list alone when the save fails', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData<TTarsMcpDirectToolsResponse>(tarsMcpDirectToolsKey('s1'), {
      tools_status: 'ok',
      tools: [{ name: 'health', is_enabled: false }],
    });
    (dataService.updateTarsMcpDirectTools as jest.Mock).mockRejectedValue(new Error('refused'));

    const { result } = renderHook(() => useUpdateTarsMcpDirectToolsMutation('s1'), { wrapper });
    await expect(result.current.mutateAsync(['health'])).rejects.toThrow('refused');

    expect(readTools(queryClient)).toEqual([]);
  });

  it('does not invent a list the panel has not loaded', async () => {
    const { queryClient, wrapper } = setup();
    (dataService.updateTarsMcpDirectTools as jest.Mock).mockResolvedValue({
      enabled_tools: ['health'],
    });

    const { result } = renderHook(() => useUpdateTarsMcpDirectToolsMutation('s1'), { wrapper });
    await result.current.mutateAsync(['health']);

    expect(queryClient.getQueryData(tarsMcpDirectToolsKey('s1'))).toBeUndefined();
  });
});
