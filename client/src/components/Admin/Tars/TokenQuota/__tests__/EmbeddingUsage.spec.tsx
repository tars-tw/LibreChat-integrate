import React from 'react';
import { AxiosError } from 'axios';
import userEvent from '@testing-library/user-event';
import { dataService } from 'librechat-data-provider';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  TTarsEmbeddingUsageRow,
  TTarsEmbeddingUsageQuery,
  TTarsEmbeddingUsageSummary,
} from 'librechat-data-provider';
import type { AxiosResponse } from 'axios';
import EmbeddingUsage from '../Report/EmbeddingUsage';

jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

const RANGE = { start_date: '2026-10-01', end_date: '2026-10-07' };

const row = (
  group: string | null,
  tokens: number,
  split?: string | null,
): TTarsEmbeddingUsageRow => ({
  group,
  split,
  input_tokens: tokens,
  request_count: 2,
  text_count: 3,
  usage_rows: 1,
});

const summaryOf = (
  query: TTarsEmbeddingUsageQuery,
  rows: TTarsEmbeddingUsageRow[],
): TTarsEmbeddingUsageSummary => ({
  group_by: query.group_by,
  split_by: query.split_by ?? null,
  start_date: query.start_date,
  end_date: query.end_date,
  rows,
  totals: { input_tokens: 1200, request_count: 4, text_count: 9, usage_rows: 2 },
  rows_cut_off: false,
});

/** pwc_tars answering each `group_by` with rows of its own. */
const answering = (rowsByGroup: Partial<Record<string, TTarsEmbeddingUsageRow[]>>) =>
  jest
    .spyOn(dataService, 'getTarsEmbeddingUsageSummary')
    .mockImplementation(async (query) => summaryOf(query, rowsByGroup[query.group_by] ?? []));

const failingWith = (status: number) =>
  jest.spyOn(dataService, 'getTarsEmbeddingUsageSummary').mockRejectedValue(
    new AxiosError('Failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status,
      data: {},
    } as AxiosResponse),
  );

const renderUsage = (props: Partial<React.ComponentProps<typeof EmbeddingUsage>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EmbeddingUsage range={RANGE} {...props} />
    </QueryClientProvider>,
  );
};

describe('EmbeddingUsage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the totals, the daily chart and both splits once pwc_tars answers', async () => {
    const summary = answering({
      day: [row('2026-10-01', 700, 'kb_query'), row('2026-10-02', 500, 'kb_ingest')],
      purpose: [row('kb_query', 700), row('kb_ingest', 500)],
      model: [row('text-embedding-3-small', 1200)],
    });

    renderUsage();

    expect(await screen.findByText('9')).toBeInTheDocument();
    expect(screen.getAllByText('1,200')).toHaveLength(2);
    expect(screen.getAllByText('com_ui_tars_embedding_purpose_kb_query').length).toBeGreaterThan(0);
    expect(await screen.findByText('text-embedding-3-small')).toBeInTheDocument();
    expect(summary).toHaveBeenCalledWith({ ...RANGE, group_by: 'day', split_by: 'purpose' });
    expect(summary).toHaveBeenCalledWith({ ...RANGE, group_by: 'purpose' });
    expect(summary).toHaveBeenCalledWith({ ...RANGE, group_by: 'model' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks again by the dimension the admin picks, with the model split beside it', async () => {
    const summary = answering({});
    renderUsage();
    await screen.findByText('1,200');

    await userEvent.selectOptions(screen.getByRole('combobox'), 'domain');

    await waitFor(() =>
      expect(summary).toHaveBeenCalledWith({ ...RANGE, group_by: 'day', split_by: 'domain' }),
    );
    expect(summary).toHaveBeenCalledWith({ ...RANGE, group_by: 'domain' });
    expect(await screen.findByText(/com_ui_tars_embedding_hint_domain/)).toBeInTheDocument();
  });

  it('keeps each part labelled by what it shows while the next view loads', async () => {
    const summary = jest
      .spyOn(dataService, 'getTarsEmbeddingUsageSummary')
      .mockImplementation((query) =>
        query.group_by === 'domain' || query.split_by === 'domain'
          ? new Promise(() => undefined)
          : Promise.resolve(
              summaryOf(query, query.group_by === 'purpose' ? [row('kb_query', 700)] : []),
            ),
      );
    renderUsage();
    await screen.findByRole('heading', { name: 'com_ui_tars_embedding_group_purpose' });

    await userEvent.selectOptions(screen.getByRole('combobox'), 'domain');
    await waitFor(() => expect(summary).toHaveBeenCalledWith({ ...RANGE, group_by: 'domain' }));

    expect(
      screen.getByRole('heading', { name: 'com_ui_tars_embedding_group_purpose' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'com_ui_tars_embedding_group_domain' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('com_ui_tars_embedding_purpose_kb_query').length).toBeGreaterThan(0);
    expect(screen.queryByText(/com_ui_tars_embedding_hint_domain/)).not.toBeInTheDocument();
  });

  it('draws every day of the period, including the ones without usage', async () => {
    answering({ day: [row('2026-10-02', 700, 'kb_query')] });
    renderUsage();

    await screen.findByText('com_ui_tars_embedding_by_day');
    expect(await screen.findAllByRole('img')).toHaveLength(7);
    expect(screen.getByRole('img', { name: '2026-10-03 0' })).toBeInTheDocument();
  });

  it('folds the series past the seventh into Other, in the legend and in the table', async () => {
    answering({
      day: Array.from({ length: 9 }, (_, index) => row('2026-10-01', 100 - index, `kb${index}`)),
    });
    renderUsage();
    await screen.findByText('com_ui_tars_embedding_by_day');

    await userEvent.selectOptions(screen.getByRole('combobox'), 'knowledge_base');

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(8));
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      ...Array.from({ length: 7 }, (_, index) => `kb${index}`),
      'com_ui_tars_embedding_other_label',
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_tars_usage_view_table' }));
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toContain('com_ui_tars_embedding_other_label');
    expect(headers).not.toContain('kb7');
    expect(screen.getByRole('cell', { name: '185' })).toBeInTheDocument();
  });

  it('says there is no usage when the period has none', async () => {
    answering({});
    renderUsage();

    expect(await screen.findAllByText('com_ui_tars_audit_no_data')).toHaveLength(3);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('narrows every request to the user it is opened for and says so', async () => {
    const summary = answering({});
    renderUsage({ userId: 'u-7', compact: true });

    await screen.findByText('1,200');
    expect(summary).toHaveBeenCalledWith({
      ...RANGE,
      group_by: 'day',
      split_by: 'purpose',
      user_id: 'u-7',
    });
    expect(screen.getByText(/com_ui_tars_embedding_hint_filtered/)).toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    failingWith(500);
    renderUsage();

    expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_tars_embedding_load_failed');
  });

  it('hides itself when the request is refused', async () => {
    const summary = failingWith(403);
    const { container } = renderUsage();

    await waitFor(() => expect(summary).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('explains a range past the limit without asking pwc_tars', () => {
    const summary = answering({});
    renderUsage({ range: { start_date: '2025-01-01', end_date: '2026-10-07' } });

    expect(screen.getByText('com_ui_tars_embedding_range_too_long:366')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(summary).not.toHaveBeenCalled();
  });
});
