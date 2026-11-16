import React from 'react';
import { dataService } from 'librechat-data-provider';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TStartupConfig } from 'librechat-data-provider';
import {
  useTarsDomainsQuery,
  useTarsModelLabelsQuery,
  useTarsAllowedModelsQuery,
} from '../queries';
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
    const labels = renderHook(() => useTarsModelLabelsQuery(), { wrapper });

    await waitFor(() => expect(domains.result.current.fetchStatus).toBe('idle'));
    expect(models.result.current.fetchStatus).toBe('idle');
    expect(labels.result.current.fetchStatus).toBe('idle');
    expect(getTarsDomains).not.toHaveBeenCalled();
    expect(getTarsModels).not.toHaveBeenCalled();
  });

  it('keys the display names by lower-cased model name off the whitelist request', async () => {
    mockStartupConfig({ tarsAuth: true });
    getTarsModels.mockResolvedValue({
      models: ['GPT-5.4-mini', 'o3'],
      labels: { 'GPT-5.4-mini': '快速模型' },
    });
    const wrapper = createWrapper();

    const models = renderHook(() => useTarsAllowedModelsQuery(), { wrapper });
    const labels = renderHook(() => useTarsModelLabelsQuery(), { wrapper });

    await waitFor(() => expect(labels.result.current.isSuccess).toBe(true));
    expect(labels.result.current.data).toEqual(new Map([['gpt-5.4-mini', '快速模型']]));
    expect(models.result.current.data).toEqual(['GPT-5.4-mini', 'o3']);
    expect(getTarsModels).toHaveBeenCalledTimes(1);
  });

  it('gives no display names when pwc_tars sends none', async () => {
    mockStartupConfig({ tarsAuth: true });
    const { result } = renderHook(() => useTarsModelLabelsQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.size).toBe(0);
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
