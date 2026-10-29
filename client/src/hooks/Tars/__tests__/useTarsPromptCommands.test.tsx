import React from 'react';
import { RecoilRoot } from 'recoil';
import { dataService } from 'librechat-data-provider';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TTarsPrompt, TStartupConfig, TTarsDomainsResponse } from 'librechat-data-provider';
import useTarsPromptCommands, { toTarsPromptCommands } from '../useTarsPromptCommands';

/**
 * The `/` picker lists the chat brain's pwc_tars prompts, matched by command or
 * name, and only asks pwc_tars once the picker opens.
 */

jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

jest.mock('~/components/Chat/Menus/Tars/domain', () => ({
  useSelectedTarsDomain: () => ({ domainId: '154', selectedAgentId: null }),
}));

const makePrompt = (overrides: Partial<TTarsPrompt>): TTarsPrompt => ({
  id: 'p1',
  name: '快速總結',
  description: null,
  category: '文章',
  content: '請總結 {{text}}',
  command: null,
  status: 1,
  created_by: '1',
  created_at: '2026-10-29T00:00:00Z',
  scope: 'personal',
  ...overrides,
});

const prompts: TTarsPrompt[] = [
  makePrompt({ id: 'd1', name: '翻譯', command: '翻譯', scope: 'domain', content: '翻譯成英文' }),
  makePrompt({
    id: 'k1',
    name: '查訂單',
    scope: 'knowledge_base',
    knowledge_base_name: '訂單知識庫',
    description: '依客戶查訂單',
  }),
  makePrompt({ id: 'p1' }),
];

const renderCommands = (enabled: boolean) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </RecoilRoot>
  );
  return renderHook(({ open }) => useTarsPromptCommands(open), {
    wrapper,
    initialProps: { open: enabled },
  });
};

describe('toTarsPromptCommands', () => {
  it('leads the label with the command and matches on it, else on the name', () => {
    const { promptGroups, promptsMap } = toTarsPromptCommands(prompts, (p) => p.scope ?? '');

    expect(
      promptGroups.map(({ id, value, label, description }) => ({ id, value, label, description })),
    ).toEqual([
      { id: 'domain:d1', value: '翻譯', label: '/翻譯 - 翻譯: 翻譯成英文', description: 'domain' },
      {
        id: 'knowledge_base:k1',
        value: '查訂單',
        label: '查訂單: 依客戶查訂單',
        description: 'knowledge_base',
      },
      {
        id: 'personal:p1',
        value: '快速總結',
        label: '快速總結: 請總結 {{text}}',
        description: 'personal',
      },
    ]);
    expect(promptsMap['domain:d1']).toEqual({
      name: '翻譯',
      category: '文章',
      productionPrompt: { prompt: '翻譯成英文' },
    });
    expect(promptsMap['domain:d1']._id).toBeUndefined();
  });
});

describe('useTarsPromptCommands', () => {
  beforeEach(() => {
    jest
      .spyOn(dataService, 'getStartupConfig')
      .mockResolvedValue({ tarsAuth: true } as TStartupConfig);
    jest.spyOn(dataService, 'getTarsDomains').mockResolvedValue({
      domains: [
        { id: 100, name: 'general' },
        { id: 154, name: '業務' },
      ],
    } as TTarsDomainsResponse);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not ask pwc_tars while the picker is closed', async () => {
    const getPrompts = jest.spyOn(dataService, 'getTarsPrompts');

    const { result } = renderCommands(false);

    await waitFor(() => expect(dataService.getTarsDomains).toHaveBeenCalled());
    expect(getPrompts).not.toHaveBeenCalled();
    expect(result.current).toEqual({ data: undefined, isLoading: false });
  });

  it("lists the chat brain's prompts once opened, labelled by tier", async () => {
    const getPrompts = jest
      .spyOn(dataService, 'getTarsPrompts')
      .mockResolvedValue({ prompts, knowledgeBases: [] });

    const { result } = renderCommands(true);

    await waitFor(() => expect(result.current.data?.promptGroups).toHaveLength(3));
    expect(getPrompts).toHaveBeenCalledTimes(1);
    expect(getPrompts).toHaveBeenCalledWith('154');
    expect(result.current.data?.promptGroups.map((option) => option.description)).toEqual([
      'com_ui_tars_prompts_domain',
      '訂單知識庫',
      'com_ui_tars_prompts_personal',
    ]);
  });
});
