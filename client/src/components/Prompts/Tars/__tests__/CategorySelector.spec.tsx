import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import userEvent from '@testing-library/user-event';
import { dataService } from 'librechat-data-provider';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CategorySelector from '../CategorySelector';

/**
 * pwc_tars keeps categories on the prompts, so deleting or renaming one moves
 * every prompt of the scope that uses it; an unused one is only a local option.
 */

jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key} ${Object.values(vars).join(' ')}` : key,
}));

const mockShowToast = jest.fn();
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const renderSelector = (props: Partial<React.ComponentProps<typeof CategorySelector>> = {}) => {
  const onChange = jest.fn();
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CategorySelector
        value="test"
        onChange={onChange}
        categories={['test', '文章']}
        categoryCounts={{ test: 6, 文章: 2 }}
        domainId="208"
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onChange };
};

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'com_ui_prompt_category_selector_aria' }));
};

describe('Tars CategorySelector', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockShowToast.mockReset();
  });

  it('lists each category with its usage and its own rename and delete items', async () => {
    const user = userEvent.setup();
    renderSelector();

    await openMenu(user);

    expect(await screen.findByRole('menuitem', { name: 'test 6' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'com_ui_tars_prompt_category_rename_aria 文章' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'com_ui_tars_prompt_category_delete_aria 文章' }),
    ).toBeInTheDocument();
  });

  it('drops an unused category locally without asking pwc_tars', async () => {
    const user = userEvent.setup();
    const rename = jest.spyOn(dataService, 'renameTarsPromptCategory');
    const { onChange } = renderSelector({ value: '草稿' });

    await openMenu(user);
    await user.click(
      await screen.findByRole('menuitem', { name: 'com_ui_tars_prompt_category_delete_aria 草稿' }),
    );

    expect(onChange).toHaveBeenCalledWith('');
    expect(rename).not.toHaveBeenCalled();
  });

  it('moves the prompts of a deleted category to the chosen one', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const rename = jest
      .spyOn(dataService, 'renameTarsPromptCategory')
      .mockResolvedValue({ updated_count: 6 });
    const { onChange } = renderSelector();

    await openMenu(user);
    await user.click(
      await screen.findByRole('menuitem', { name: 'com_ui_tars_prompt_category_delete_aria test' }),
    );
    expect(
      await screen.findByText('com_ui_tars_prompt_category_delete_desc test 6'),
    ).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'com_ui_delete' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('combobox'));
    /* The select portals outside the modal dialog, which marks the rest of the page aria-hidden */
    await user.click(await screen.findByRole('option', { name: '文章', hidden: true }));
    await user.click(confirm);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('文章'));
    expect(rename).toHaveBeenCalledWith({
      old_category: 'test',
      new_category: '文章',
      domain_id: '208',
      knowledge_base_id: undefined,
    });
  });

  it('renames a used category across its prompts', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const rename = jest
      .spyOn(dataService, 'renameTarsPromptCategory')
      .mockResolvedValue({ updated_count: 6 });
    const { onChange } = renderSelector();

    await openMenu(user);
    await user.click(
      await screen.findByRole('menuitem', { name: 'com_ui_tars_prompt_category_rename_aria test' }),
    );
    const input = await screen.findByRole('textbox', { name: 'com_ui_prompt_category_name' });
    expect(input).toHaveValue('test');
    await user.clear(input);
    await user.type(input, '測試');
    await user.click(screen.getByRole('button', { name: 'com_ui_save' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('測試'));
    expect(rename).toHaveBeenCalledWith(
      expect.objectContaining({ old_category: 'test', new_category: '測試', domain_id: '208' }),
    );
  });
});
