import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TTarsPrompt } from 'librechat-data-provider';
import TarsPromptList from '../List';

/** The `/prompts` management list filters its one scope by a category chip. */

const prompt = (overrides: Partial<TTarsPrompt>): TTarsPrompt => ({
  id: 'p',
  name: 'prompt',
  description: null,
  category: null,
  content: 'content',
  status: 1,
  created_by: 'u1',
  created_at: '2026-11-18',
  ...overrides,
});

const mockPrompts: TTarsPrompt[] = [
  prompt({ id: '1', name: 'contract_review', category: '合約' }),
  prompt({ id: '2', name: 'contract_draft', category: '合約' }),
  prompt({ id: '3', name: 'sales_report', category: '銷售' }),
];

jest.mock('../hooks', () => ({
  __esModule: true,
  default: () => ({
    prompts: mockPrompts,
    categories: [],
    categoryCounts: {},
    isLoading: false,
    basePath: '/prompts/knowledge-base/kb1',
  }),
}));

jest.mock('~/data-provider', () => ({
  useDeleteTarsPromptMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const chip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'com_ui_tars_prompts_category_filter' })).getByRole(
    'button',
    { name },
  );

describe('Tars prompt management list', () => {
  it('lists the scope by the picked category, combined with the search', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TarsPromptList knowledgeBaseId="kb1" />
      </MemoryRouter>,
    );

    expect(chip(/com_ui_all_proper\s*3/)).toHaveAttribute('aria-pressed', 'true');

    await user.click(chip(/合約\s*2/));
    expect(screen.getByText('contract_review')).toBeInTheDocument();
    expect(screen.queryByText('sales_report')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), 'draft');
    expect(screen.getByText('contract_draft')).toBeInTheDocument();
    expect(screen.queryByText('contract_review')).not.toBeInTheDocument();
  });
});
