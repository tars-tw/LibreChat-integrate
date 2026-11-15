import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TTarsAuditMessage, TTarsAuditReport } from 'librechat-data-provider';
import AuditManager from '../Manager';

const mockRow: TTarsAuditMessage = {
  message_id: 'm-1',
  user_id: '3',
  username: 'ada',
  agent_id: 'agent_a',
  agent_name: 'Invoice bot',
  user_query: 'invoice question',
  model_response: 'answer',
  conversation_id: 'c-1',
  conversation_name: 'Invoices',
  knowledge_base_name: null,
  model_name: 'gemma',
  created_at: '2026-11-10T04:00:00Z',
  upload_files: null,
  memory_document: null,
  memory_website: null,
  is_web_search: false,
  is_sql_agent: false,
  ip_address: null,
  like_counts: 0,
  dislike_counts: 0,
  comments: '',
  is_deleted: false,
  conversation_is_deleted: false,
};

const mockReport: TTarsAuditReport = {
  total_count: 1,
  data: [mockRow],
  feedback_data: [],
  summary: {
    total_agents: 1,
    total_conversations: 1,
    total_messages: 1,
    date_range: { start_date: '2026-11-08', end_date: '2026-11-15' },
  },
  details: [],
};

const mockRefetch = jest.fn();
const mockSubmittedQueries: unknown[] = [];

jest.mock('~/data-provider', () => ({
  useTarsAuditOptionsQuery: () => ({
    data: { users: [], knowledge_bases: [], agents: [{ id: 'agent_a', name: 'Invoice bot' }] },
    error: null,
    isFetching: false,
  }),
  useTarsAuditReportQuery: (query: unknown) => {
    if (query != null && mockSubmittedQueries.at(-1) !== query) {
      mockSubmittedQueries.push(query);
    }
    return {
      data: query == null ? undefined : mockReport,
      error: null,
      isFetching: false,
      refetch: mockRefetch,
    };
  },
}));

jest.mock('../Trace', () => ({ TraceDialog: () => null }));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

/** Every table panel stays mounted, so queries are scoped to the one on show. */
const activePanel = (): HTMLElement =>
  screen.getAllByRole('tabpanel').find((panel) => panel.dataset.state === 'active') as HTMLElement;

describe('AuditManager tabs', () => {
  afterEach(() => {
    mockReport.data = [mockRow];
    mockRefetch.mockClear();
    mockSubmittedQueries.length = 0;
  });

  /** A look at another tab is not a new result set, so it must not collapse anything. */
  it('keeps an expanded conversation open across a tab switch', async () => {
    const user = userEvent.setup();
    render(<AuditManager />);

    await user.click(screen.getByRole('button', { name: 'com_ui_tars_audit_search' }));
    await user.click(screen.getByRole('button', { name: 'com_ui_expand Invoices' }));
    expect(screen.getByText('invoice question')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'com_ui_tars_audit_tab_stats' }));
    /** Hidden by its inactive state's class, which jsdom does not apply, so the state is checked. */
    expect(screen.getByText('invoice question').closest('[role="tabpanel"]')).toHaveAttribute(
      'data-state',
      'inactive',
    );

    await user.click(screen.getByRole('tab', { name: /com_ui_tars_audit_tab_report/ }));
    expect(screen.getByRole('button', { name: 'com_ui_collapse Invoices' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('invoice question')).toBeVisible();
  });

  it('keeps the feedback page across a tab switch', async () => {
    /** One more rated message than the default page of twenty, so there is a second page. */
    const rated = Array.from({ length: 21 }, (_, index) => ({
      ...mockRow,
      message_id: `rated-${index + 1}`,
      user_query: `rated question ${index + 1}`,
      like_counts: 1,
    }));
    mockReport.data = [mockRow, ...rated];
    const user = userEvent.setup();
    render(<AuditManager />);

    await user.click(screen.getByRole('button', { name: 'com_ui_tars_audit_search' }));
    await user.click(screen.getByRole('tab', { name: /com_ui_tars_audit_tab_feedback/ }));
    await user.click(
      within(activePanel()).getByRole('button', { name: 'com_ui_tars_users_next_page' }),
    );
    expect(screen.getByText('com_ui_tars_audit_page_indicator:2,2,21')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'com_ui_tars_audit_tab_stats' }));
    expect(
      screen.getByText('com_ui_tars_audit_page_indicator:2,2,21').closest('[role="tabpanel"]'),
    ).toHaveAttribute('data-state', 'inactive');

    await user.click(screen.getByRole('tab', { name: /com_ui_tars_audit_tab_feedback/ }));
    expect(screen.getByText('com_ui_tars_audit_page_indicator:2,2,21')).toBeVisible();
    expect(screen.getByText('rated question 21')).toBeVisible();
  });

  /** An audit re-run must read what was written since, even with unchanged filters. */
  it('fetches again when the same search is run twice', async () => {
    const user = userEvent.setup();
    render(<AuditManager />);

    await user.click(screen.getByRole('button', { name: 'com_ui_tars_audit_search' }));
    expect(mockRefetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'com_ui_tars_audit_search' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockSubmittedQueries).toHaveLength(1);
  });

  /** A deleted agent keeps its history, so the picker must still offer it once it has been seen. */
  it('offers the deleted agents a result named in the agent picker', async () => {
    mockReport.data = [{ ...mockRow, agent_id: 'agent_gone', agent_name: null }];
    const user = userEvent.setup();
    render(<AuditManager />);

    await user.click(screen.getByRole('button', { name: 'com_ui_tars_audit_search' }));
    await user.click(screen.getByText('com_ui_tars_audit_all_agents'));
    expect(screen.getByText('Invoice bot')).toBeInTheDocument();
    expect(
      screen.getAllByText('com_ui_tars_audit_agent_deleted:agent_gone').length,
    ).toBeGreaterThan(1);
  });
});
