import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TTarsAuditMessage } from 'librechat-data-provider';
import { DEFAULT_MESSAGE_COLUMNS, MESSAGE_COLUMNS, groupConversations } from '../helpers';
import ConversationTable from '../Conversations';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

const message = (overrides: Partial<TTarsAuditMessage>): TTarsAuditMessage => ({
  message_id: 'm-1',
  user_id: '3',
  username: 'ada',
  agent_id: null,
  agent_name: null,
  user_query: 'question',
  model_response: 'answer',
  conversation_id: 'c-1',
  conversation_name: 'Invoices',
  knowledge_base_name: 'Tax rules',
  model_name: 'gemma',
  created_at: '2026-11-10T04:00:00Z',
  upload_files: null,
  memory_document: null,
  memory_website: null,
  is_web_search: false,
  is_sql_agent: false,
  ip_address: '10.0.0.1',
  like_counts: 0,
  dislike_counts: 0,
  comments: '',
  is_deleted: false,
  conversation_is_deleted: false,
  ...overrides,
});

/** Twelve messages in one conversation, one in another: enough to page the first. */
const ROWS = [
  ...Array.from({ length: 12 }, (_, index) =>
    message({
      message_id: `a-${index + 1}`,
      user_query: `invoice question ${index + 1}`,
      agent_id: 'agent_a',
      agent_name: 'Invoice bot',
    }),
  ),
  message({
    message_id: 'b-1',
    conversation_id: 'c-2',
    conversation_name: null,
    user_query: 'holiday question',
    conversation_is_deleted: true,
  }),
];

const renderTable = (rows = ROWS) => {
  const props = {
    columns: MESSAGE_COLUMNS,
    visible: DEFAULT_MESSAGE_COLUMNS,
    onVisibleChange: jest.fn(),
    isLoading: false,
    locale: 'en',
    onViewResponse: jest.fn(),
    onViewTrace: jest.fn(),
    exportName: 'AuditReport',
    emptyHint: 'empty',
  };
  const view = render(<ConversationTable conversations={groupConversations(rows)} {...props} />);
  return {
    ...view,
    rerenderWith: (next: TTarsAuditMessage[]) =>
      view.rerender(<ConversationTable conversations={groupConversations(next)} {...props} />),
  };
};

const toggleFor = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^com_ui_(expand|collapse) ${name}$`) });

describe('groupConversations', () => {
  it('groups by conversation in arrival order and keeps the deleted flag', () => {
    const groups = groupConversations(ROWS);
    expect(groups.map((group) => [group.id, group.messages.length, group.is_deleted])).toEqual([
      ['c-1', 12, false],
      ['c-2', 1, true],
    ]);
  });
});

describe('ConversationTable', () => {
  it('lists one collapsed row per conversation with its fixed columns', () => {
    renderTable();
    expect(screen.getByText('com_ui_tars_audit_page_indicator_conversations:1,1,2')).toBeVisible();
    expect(screen.getByText('Invoice bot')).toBeVisible();
    expect(screen.getByText('com_ui_tars_audit_no_agent')).toBeVisible();
    expect(screen.getByText('12')).toBeVisible();
    expect(screen.getByLabelText('com_ui_tars_audit_col_deleted')).toBeVisible();
    expect(screen.queryByText('invoice question 1')).not.toBeInTheDocument();
    expect(toggleFor('Invoices')).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands conversations independently and pages each one ten at a time', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(toggleFor('Invoices'));
    expect(toggleFor('Invoices')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('invoice question 10')).toBeVisible();
    expect(screen.queryByText('invoice question 11')).not.toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_audit_inner_page_indicator:1,2')).toBeVisible();

    const detail = screen.getByText('com_ui_tars_audit_inner_page_indicator:1,2').closest('tr');
    await user.click(within(detail as HTMLElement).getByText('com_ui_tars_users_next_page'));
    expect(screen.getByText('invoice question 11')).toBeVisible();
    expect(screen.queryByText('invoice question 1')).not.toBeInTheDocument();

    await user.click(toggleFor('com_ui_tars_audit_untitled_conversation'));
    expect(screen.getByText('holiday question')).toBeVisible();
    expect(screen.getByText('invoice question 11')).toBeVisible();
    /** One message fits on one page, so the second conversation gets no pager. */
    expect(screen.getAllByText(/com_ui_tars_audit_inner_page_indicator/)).toHaveLength(1);
  });

  it('shows the default message columns and hides the optional ones', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(toggleFor('Invoices'));
    expect(screen.getAllByText('com_ui_tars_audit_col_kb').length).toBeGreaterThan(0);
    expect(screen.getAllByText('com_ui_tars_audit_col_model').length).toBeGreaterThan(0);
    expect(screen.queryByText('com_ui_tars_audit_col_ip')).not.toBeInTheDocument();
    expect(screen.queryByText('10.0.0.1')).not.toBeInTheDocument();
  });

  it('collapses everything and returns to the first page when the results change', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderTable();
    await user.click(toggleFor('Invoices'));
    expect(screen.getByText('invoice question 1')).toBeVisible();

    rerenderWith([...ROWS]);
    expect(toggleFor('Invoices')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('invoice question 1')).not.toBeInTheDocument();
  });

  /** Selecting a conversation name to copy it must not expand or collapse the row. */
  it('ignores a row click that ends a text selection', async () => {
    const user = userEvent.setup();
    renderTable();
    const selection = jest
      .spyOn(window, 'getSelection')
      .mockReturnValue({ isCollapsed: false } as Selection);
    await user.click(screen.getByText('Invoices'));
    expect(toggleFor('Invoices')).toHaveAttribute('aria-expanded', 'false');

    selection.mockRestore();
    await user.click(screen.getByText('Invoices'));
    expect(toggleFor('Invoices')).toHaveAttribute('aria-expanded', 'true');
  });
});
