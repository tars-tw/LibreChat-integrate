import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { act, renderHook } from '@testing-library/react';
import { LocalStorageKeys } from 'librechat-data-provider';
import type { TTarsDomain } from 'librechat-data-provider';
import useTarsPluginTools from '../useTarsPluginTools';
import { ephemeralAgentByConvoId } from '~/store';

/**
 * The chat-side plugin selection must mirror pwc_tars: the brain's
 * `domain_functions` decides what is offered and what starts on, the user
 * flips plugins per chat, a stored selection is restored for the same brain,
 * switching brain re-seeds, and a plugin the brain stops offering is pruned.
 */

let mockSelected: { selectedId: string; selectedDomain?: TTarsDomain };

jest.mock('~/components/Chat/Menus/Tars/domain', () => ({
  useSelectedTarsDomain: () => mockSelected,
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ user: { provider: 'tars' } }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { tarsAuth: true } }),
}));

jest.mock('~/utils/timestamps', () => ({
  setTimestamp: jest.fn(),
}));

const brain = (id: number, functions: Record<string, unknown>): TTarsDomain => ({
  id,
  name: `brain-${id}`,
  description: null,
  role_ids: null,
  knowledge_base_ids: null,
  domain_functions: JSON.stringify(functions),
  prompt_instruction: null,
  iframe_url: null,
  status: true,
});

const plugin = (name: string, enabled: boolean, defaultValue: boolean) => ({
  kind: 'plugin',
  name,
  enabled,
  default_value: defaultValue,
  display_name: name,
  description: '',
});

const twoPlugins = brain(100, {
  web_search: { enabled: true, default_value: true },
  'plugin:text_stats': plugin('text_stats', true, true),
  'plugin:summarize_text': plugin('summarize_text', true, false),
  'plugin:hidden_tool': plugin('hidden_tool', false, true),
});

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RecoilRoot>{children}</RecoilRoot>
);

const renderPlugins = (conversationId: string, storageContextKey?: string) =>
  renderHook(
    () => ({
      control: useTarsPluginTools({ conversationId, storageContextKey }),
      agent: useRecoilValue(ephemeralAgentByConvoId(conversationId)),
    }),
    { wrapper: Wrapper },
  );

beforeEach(() => {
  localStorage.clear();
  mockSelected = { selectedId: '100', selectedDomain: twoPlugins };
});

describe('useTarsPluginTools', () => {
  it('offers only the enabled plugins and seeds the "on by default" ones', () => {
    const { result } = renderPlugins('convo-1');

    expect(result.current.control.tools.map((tool) => tool.name)).toEqual([
      'text_stats',
      'summarize_text',
    ]);
    expect(result.current.control.selected).toEqual(['text_stats']);
    expect(result.current.agent?.tars_plugins).toEqual(['text_stats']);
    expect(
      JSON.parse(localStorage.getItem(`${LocalStorageKeys.LAST_TARS_PLUGINS_}convo-1`)!),
    ).toEqual({ selected: ['text_stats'], offered: ['text_stats', 'summarize_text'] });
  });

  it('toggles a plugin into the ephemeral agent and the new-chat defaults key', () => {
    const { result } = renderPlugins('convo-1', '__defaults__');

    act(() => result.current.control.toggle('summarize_text'));
    expect(result.current.agent?.tars_plugins).toEqual(['text_stats', 'summarize_text']);
    expect(
      JSON.parse(localStorage.getItem(`${LocalStorageKeys.LAST_TARS_PLUGINS_}__defaults__`)!)
        .selected,
    ).toEqual(['text_stats', 'summarize_text']);

    act(() => result.current.control.toggle('text_stats'));
    expect(result.current.control.isSelected('text_stats')).toBe(false);

    /** A plugin the brain does not offer can never be switched on. */
    act(() => result.current.control.toggle('hidden_tool'));
    expect(result.current.agent?.tars_plugins).toEqual(['summarize_text']);
  });

  it('restores a stored selection for the same brain instead of the defaults', () => {
    localStorage.setItem(
      `${LocalStorageKeys.LAST_TARS_PLUGINS_}convo-2`,
      JSON.stringify({
        selected: ['summarize_text', 'removed_tool'],
        offered: ['text_stats', 'summarize_text', 'removed_tool'],
      }),
    );
    const { result } = renderPlugins('convo-2');
    expect(result.current.agent?.tars_plugins).toEqual(['summarize_text']);
  });

  it('adds a plugin the admin made "on by default" after the selection was stored', () => {
    /** Stored when the brain offered only summarize_text; text_stats is new and on by default. */
    localStorage.setItem(
      `${LocalStorageKeys.LAST_TARS_PLUGINS_}convo-2b`,
      JSON.stringify({ selected: [], offered: ['summarize_text'] }),
    );
    const { result } = renderPlugins('convo-2b');
    expect(result.current.agent?.tars_plugins).toEqual(['text_stats']);
  });

  it('reads the legacy bare-array format, treating the list as the offered set', () => {
    localStorage.setItem(
      `${LocalStorageKeys.LAST_TARS_PLUGINS_}convo-2c`,
      JSON.stringify(['summarize_text']),
    );
    const { result } = renderPlugins('convo-2c');
    expect(result.current.agent?.tars_plugins).toEqual(['summarize_text', 'text_stats']);
  });

  it('re-seeds from the new brain when the brain changes on the same chat', () => {
    const { result, rerender } = renderPlugins('convo-3');
    act(() => result.current.control.toggle('summarize_text'));
    expect(result.current.agent?.tars_plugins).toEqual(['text_stats', 'summarize_text']);

    mockSelected = {
      selectedId: '235',
      selectedDomain: brain(235, {
        'plugin:summarize_text': plugin('summarize_text', true, true),
      }),
    };
    rerender();
    expect(result.current.control.tools.map((tool) => tool.name)).toEqual(['summarize_text']);
    expect(result.current.agent?.tars_plugins).toEqual(['summarize_text']);
  });

  it('prunes a selection the brain no longer offers', () => {
    const { result, rerender } = renderPlugins('convo-4');
    act(() => result.current.control.toggle('summarize_text'));

    mockSelected = {
      selectedId: '100',
      selectedDomain: brain(100, { 'plugin:text_stats': plugin('text_stats', true, true) }),
    };
    rerender();
    expect(result.current.agent?.tars_plugins).toEqual(['text_stats']);
  });

  it('keeps pins across conversations', () => {
    const first = renderPlugins('convo-5');
    act(() => first.result.current.control.setPinned('summarize_text', true));
    expect(first.result.current.control.isPinned('summarize_text')).toBe(true);

    const second = renderPlugins('convo-6');
    expect(second.result.current.control.isPinned('summarize_text')).toBe(true);
    expect(second.result.current.control.isPinned('text_stats')).toBe(false);
  });

  it('offers nothing before the brain is known', () => {
    mockSelected = { selectedId: '', selectedDomain: undefined };
    const { result } = renderPlugins('convo-7');
    expect(result.current.control.tools).toEqual([]);
    expect(result.current.agent).toBeNull();
  });
});
