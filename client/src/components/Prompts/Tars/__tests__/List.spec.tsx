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

const mockScope = { isError: false, basePath: '/prompts/knowledge-base/kb1' };

jest.mock('../hooks', () => ({
  __esModule: true,
  default: () => ({
    prompts: mockScope.isError ? [] : mockPrompts,
    categories: [],
    categoryCounts: {},
    isLoading: false,
    isError: mockScope.isError,
    basePath: mockScope.basePath,
  }),
}));

jest.mock('~/data-provider', () => ({
  useDeleteTarsPromptMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useGetAgentByIdQuery: (agentId?: string) => ({
    data: agentId ? { id: agentId, name: '客服助理' } : undefined,
  }),
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
  afterEach(() => {
    mockScope.isError = false;
    mockScope.basePath = '/prompts/knowledge-base/kb1';
  });

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

  it("heads an agent's list with the agent's name and links new prompts under it", () => {
    mockScope.basePath = '/prompts/agent/agent_a';
    render(
      <MemoryRouter>
        <TarsPromptList agentId="agent_a" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '客服助理' })).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_agent_prompts_title')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'com_ui_create_prompt' })).toHaveAttribute(
      'href',
      '/prompts/agent/agent_a/new',
    );
  });

  it('tells a caller who may not edit the agent so, with no way to create', () => {
    mockScope.isError = true;
    mockScope.basePath = '/prompts/agent/agent_a';
    render(
      <MemoryRouter>
        <TarsPromptList agentId="agent_a" />
      </MemoryRouter>,
    );

    expect(screen.getByText('com_ui_tars_agent_prompts_no_access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'com_ui_create_prompt' })).not.toBeInTheDocument();
    expect(screen.queryByText('com_ui_no_prompts_title')).not.toBeInTheDocument();
  });
});
