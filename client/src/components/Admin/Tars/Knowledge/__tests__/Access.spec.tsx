import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import AccessSummary from '../Access';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, string>) =>
    params != null ? `${key} ${Object.values(params).join(' ')}` : key,
}));

const kb = (extra: Partial<TTarsKnowledgeBase>): TTarsKnowledgeBase => ({
  id: 'kb1',
  name: 'HR',
  description: null,
  ...extra,
});

describe('AccessSummary', () => {
  it('counts the management list', () => {
    render(
      <AccessSummary
        knowledgeBase={kb({ allowed_user_ids: ['u1', 'u2'], allowed_user_group_ids: ['g1'] })}
        kind="manage"
      />,
    );

    expect(
      screen.getByText('com_ui_tars_kb_count_users 2 · com_ui_tars_kb_count_groups 1'),
    ).toBeInTheDocument();
  });

  it('counts the chat list, leaving out an empty kind', () => {
    render(<AccessSummary knowledgeBase={kb({ chat_user_group_count: 3 })} kind="chat" />);

    expect(screen.getByText('com_ui_tars_kb_count_groups 3')).toBeInTheDocument();
  });

  it('says what an empty list means: admins only to manage, nobody in chat', () => {
    render(
      <>
        <AccessSummary knowledgeBase={kb({})} kind="manage" />
        <AccessSummary knowledgeBase={kb({ chat_user_count: 0 })} kind="chat" />
      </>,
    );

    expect(screen.getByText('com_ui_tars_kb_manage_admins_only')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_kb_chat_unset')).toBeInTheDocument();
  });

  it('names the list for screen readers when it shows an icon', () => {
    render(<AccessSummary knowledgeBase={kb({ chat_user_count: 1 })} kind="chat" withIcon />);

    expect(screen.getByText('com_ui_tars_kb_chat_tab')).toHaveClass('sr-only');
  });
});
