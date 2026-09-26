import React from 'react';
import { dataService } from 'librechat-data-provider';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TStartupConfig } from 'librechat-data-provider';
import { useTarsDomainsQuery, useTarsAllowedModelsQuery } from '../queries';
import { useGetStartupConfig } from '../../Endpoints';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: { ...actual.dataService, getTarsDomains: jest.fn(), getTarsModels: jest.fn() },
  };
});

jest.mock('../../Endpoints', () => ({
  useGetStartupConfig: jest.fn(),
}));

const getTarsDomains = dataService.getTarsDomains as jest.Mock;
const getTarsModels = dataService.getTarsModels as jest.Mock;

const mockStartupConfig = (config: Partial<TStartupConfig> | undefined) =>
  (useGetStartupConfig as jest.Mock).mockReturnValue({ data: config });

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe('chat-shell TARS queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTarsDomains.mockResolvedValue({ domains: [{ id: 100, name: '通用腦' }] });
    getTarsModels.mockResolvedValue({ models: ['gpt-5.4-mini'] });
  });

  it.each([
    ['startup config still loading', undefined],
    ['pwc_tars not configured', { tarsAuth: false }],
  ])('sends no request while %s', async (_label, config) => {
    mockStartupConfig(config);
    const wrapper = createWrapper();

    const domains = renderHook(() => useTarsDomainsQuery(), { wrapper });
    const models = renderHook(() => useTarsAllowedModelsQuery(), { wrapper });

    await waitFor(() => expect(domains.result.current.fetchStatus).toBe('idle'));
    expect(models.result.current.fetchStatus).toBe('idle');
    expect(getTarsDomains).not.toHaveBeenCalled();
    expect(getTarsModels).not.toHaveBeenCalled();
  });

  it('fetches once pwc_tars is configured', async () => {
    mockStartupConfig({ tarsAuth: true });
    const wrapper = createWrapper();

    const domains = renderHook(() => useTarsDomainsQuery(), { wrapper });
    const models = renderHook(() => useTarsAllowedModelsQuery(), { wrapper });

    await waitFor(() => expect(domains.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(models.result.current.isSuccess).toBe(true));
    expect(domains.result.current.data).toEqual([{ id: 100, name: '通用腦' }]);
    expect(models.result.current.data).toEqual(['gpt-5.4-mini']);
    expect(getTarsDomains).toHaveBeenCalledTimes(1);
    expect(getTarsModels).toHaveBeenCalledTimes(1);
  });

  it('keeps a caller-disabled query disabled when pwc_tars is configured', async () => {
    mockStartupConfig({ tarsAuth: true });
    const { result } = renderHook(() => useTarsDomainsQuery({ enabled: false }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(getTarsDomains).not.toHaveBeenCalled();
  });
});
