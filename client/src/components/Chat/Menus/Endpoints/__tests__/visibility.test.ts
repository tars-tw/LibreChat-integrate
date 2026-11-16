/**
 * The model picker, the only place pwc_tars display names show, is offered on 通用腦 alone:
 * a specialized brain or an agent pins its own model and hides it.
 */
import { renderHook } from '@testing-library/react';
import type { TStartupConfig } from 'librechat-data-provider';
import { useModelSelectorVisible } from '../visibility';

let mockDomain = {
  domains: [{ id: 100, name: '通用腦' }],
  isGeneralDomain: true,
  selectedAgentId: null as string | null,
};

jest.mock('../../Tars/domain', () => ({
  useTarsDomain: () => mockDomain,
}));

const visible = (startupConfig?: TStartupConfig) =>
  renderHook(() => useModelSelectorVisible(startupConfig)).result.current;

describe('useModelSelectorVisible', () => {
  beforeEach(() => {
    mockDomain = {
      domains: [{ id: 100, name: '通用腦' }],
      isGeneralDomain: true,
      selectedAgentId: null,
    };
  });

  it('offers the picker on 通用腦 with no agent', () => {
    expect(visible()).toBe(true);
  });

  it('hides it on a specialized brain', () => {
    mockDomain = { ...mockDomain, isGeneralDomain: false };
    expect(visible()).toBe(false);
  });

  it('hides it once an agent is picked on 通用腦', () => {
    mockDomain = { ...mockDomain, selectedAgentId: 'agent_1' };
    expect(visible()).toBe(false);
  });

  it('hides it when the install turns model selection off', () => {
    expect(visible({ interface: { modelSelect: false } } as TStartupConfig)).toBe(false);
  });
});
