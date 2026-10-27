import React from 'react';
import { dataService } from 'librechat-data-provider';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TTarsMessageEmbeddingUsageRow } from 'librechat-data-provider';
import MessageEmbeddingUsage from '../MessageEmbeddingUsage';

jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

const usageRow = (
  id: string,
  tokens: number,
  overrides: Partial<TTarsMessageEmbeddingUsageRow> = {},
): TTarsMessageEmbeddingUsageRow => ({
  id,
  purpose: 'kb_query',
  provider: 'openai',
  embedding_model_name: 'text-embedding-3-small',
  knowledge_base_id: 'kb-1',
  input_tokens: tokens,
  request_count: 1,
  text_count: 1,
  created_at: null,
  ...overrides,
});

const renderUsage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MessageEmbeddingUsage messageId="m-1" />
    </QueryClientProvider>,
  );
};

describe('MessageEmbeddingUsage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists each search the message spent, with the total in the heading', async () => {
    const read = jest.spyOn(dataService, 'getTarsMessageEmbeddingUsage').mockResolvedValue({
      message_id: 'm-1',
      rows: [
        usageRow('a', 1500),
        usageRow('b', 300, { purpose: 'memory', knowledge_base_id: null }),
      ],
    });

    renderUsage();

    expect(await screen.findByText('com_ui_tars_embedding_total_tokens:1,800')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('com_ui_tars_embedding_purpose_memory')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_embedding_unattributed')).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith('m-1');
  });

  it('says so when the message spent nothing', async () => {
    jest
      .spyOn(dataService, 'getTarsMessageEmbeddingUsage')
      .mockResolvedValue({ message_id: 'm-1', rows: [] });

    renderUsage();

    expect(await screen.findByText('com_ui_tars_embedding_none')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('stays out of the dialog when pwc_tars cannot answer', async () => {
    const read = jest
      .spyOn(dataService, 'getTarsMessageEmbeddingUsage')
      .mockRejectedValue(new Error('offline'));

    const { container } = renderUsage();

    await waitFor(() => expect(read).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
