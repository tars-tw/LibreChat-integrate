import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TTarsPrompt } from 'librechat-data-provider';
import TarsPromptsPanel from '../Panel';

/**
 * The prompts side panel narrows its tiers by one category chip across all of
 * them, the same way the chat composer's panel does.
 */

const prompt = (overrides: Partial<TTarsPrompt>): TTarsPrompt => ({
  id: 'p',
  name: 'prompt',
  description: null,
  category: null,
  content: 'content',
  status: 1,
  created_by: 'u1',
  created_at: '2026-11-18',
  scope: 'personal',
  ...overrides,
});

const mockPrompts: { current: TTarsPrompt[] } = { current: [] };

jest.mock('~/hooks/Tars/useTarsChatPrompts', () => ({
  __esModule: true,
  default: () => ({
    data: { prompts: mockPrompts.current, knowledgeBases: [] },
    isLoading: false,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('../Item', () => ({
  __esModule: true,
  default: ({ prompt }: { prompt: TTarsPrompt }) => <div>{prompt.name}</div>,
}));

jest.mock('../../buttons/AutoSendPrompt', () => ({
  __esModule: true,
  default: () => null,
}));

const renderPanel = () =>
  render(
    <MemoryRouter initialEntries={['/c/new']}>
      <TarsPromptsPanel />
    </MemoryRouter>,
  );

const chip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'com_ui_tars_prompts_category_filter' })).getByRole(
    'button',
    { name },
  );

describe('Tars prompts side panel', () => {
  beforeEach(() => {
    mockPrompts.current = [
      prompt({ id: '1', name: 'aaron_demo', category: 'aaron' }),
      prompt({ id: '2', name: 'FTP_ok', category: '測試' }),
      prompt({ id: '3', name: 'kb_contract', category: '測試', scope: 'knowledge_base' }),
    ];
  });

  it('replaces the icon-only filter with one chip per category, counted across tiers', () => {
    renderPanel();

    expect(screen.queryByRole('combobox', { name: 'com_ui_filter_prompts' })).toBeNull();
    expect(chip(/com_ui_all_proper\s*3/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/測試\s*2/)).toBeInTheDocument();
  });

  it('keeps only the picked category in every tier, combined with the search', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(chip(/測試/));
    expect(screen.getByText('FTP_ok')).toBeInTheDocument();
    expect(screen.getByText('kb_contract')).toBeInTheDocument();
    expect(screen.queryByText('aaron_demo')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), 'kb_');
    expect(screen.getByText('kb_contract')).toBeInTheDocument();
    expect(screen.queryByText('FTP_ok')).not.toBeInTheDocument();
  });
});
