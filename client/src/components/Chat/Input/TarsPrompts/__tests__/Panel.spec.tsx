import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TTarsPrompt } from 'librechat-data-provider';
import Panel from '../Panel';

/**
 * The composer's 我的提示 panel narrows its tiers by one category across all
 * of them, and each tier's header folds its prompts away.
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

jest.mock('~/data-provider', () => ({
  useCreateTarsPromptMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const chip = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'com_ui_tars_prompts_category_filter' })).getByRole(
    'button',
    { name },
  );

describe('Tars composer prompts panel', () => {
  beforeEach(() => {
    mockPrompts.current = [
      prompt({ id: '1', name: 'aaron_demo', category: 'aaron' }),
      prompt({ id: '2', name: 'aaron_HT', category: 'aaron' }),
      prompt({ id: '3', name: 'FTP_ok', category: '測試' }),
      prompt({ id: '4', name: 'kb_contract', category: '測試', scope: 'knowledge_base' }),
    ];
  });

  it('offers every category once, counted across tiers, with 全部 picked', () => {
    render(<Panel onInsert={jest.fn()} />);

    expect(chip(/com_ui_all_proper\s*4/)).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/aaron\s*2/)).toHaveAttribute('aria-pressed', 'false');
    expect(chip(/測試\s*2/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps only the picked category in every tier, and hides a tier left empty', async () => {
    const user = userEvent.setup();
    render(<Panel onInsert={jest.fn()} />);

    await user.click(chip(/測試/));
    expect(chip(/測試/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('FTP_ok')).toBeInTheDocument();
    expect(screen.getByText('kb_contract')).toBeInTheDocument();
    expect(screen.queryByText('aaron_demo')).not.toBeInTheDocument();

    await user.click(chip(/aaron/));
    expect(screen.getByText('aaron_demo')).toBeInTheDocument();
    expect(screen.queryByText('kb_contract')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /com_ui_tars_prompts_kb/ }),
    ).not.toBeInTheDocument();
  });

  it('applies the search on top of the picked category', async () => {
    const user = userEvent.setup();
    render(<Panel onInsert={jest.fn()} />);

    await user.click(chip(/aaron/));
    await user.type(screen.getByPlaceholderText('com_ui_tars_prompts_search'), 'HT');

    expect(screen.getByText('aaron_HT')).toBeInTheDocument();
    expect(screen.queryByText('aaron_demo')).not.toBeInTheDocument();
  });

  it('folds a tier away from its header and opens it again', async () => {
    const user = userEvent.setup();
    render(<Panel onInsert={jest.fn()} />);

    const header = screen.getByRole('button', { name: /com_ui_tars_prompts_personal/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('aaron_demo')).not.toBeInTheDocument();
    expect(screen.getByText('kb_contract')).toBeInTheDocument();

    await user.click(header);
    expect(screen.getByText('aaron_demo')).toBeInTheDocument();
  });

  it('caps its height to the room it is given, so a long list scrolls inside', () => {
    const { container } = render(<Panel onInsert={jest.fn()} maxHeight={240} />);
    expect(container.firstChild).toHaveStyle({ maxHeight: '240px' });
  });

  it('labels uncategorized prompts and shows no chips without prompts', () => {
    mockPrompts.current = [prompt({ id: '5', name: 'legacy', category: null })];
    const { unmount } = render(<Panel onInsert={jest.fn()} />);
    expect(chip(/com_ui_no_category\s*1/)).toBeInTheDocument();
    unmount();

    mockPrompts.current = [];
    render(<Panel onInsert={jest.fn()} />);
    expect(
      screen.queryByRole('group', { name: 'com_ui_tars_prompts_category_filter' }),
    ).not.toBeInTheDocument();
  });
});
