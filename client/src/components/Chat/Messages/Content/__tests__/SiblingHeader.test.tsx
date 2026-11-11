import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TEndpointsConfig } from 'librechat-data-provider';
import SiblingHeader from '../SiblingHeader';

const mockEndpointsQuery = jest.fn();
const mockAgentsMap = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => mockEndpointsQuery(),
}));

jest.mock('~/data-provider/Messages', () => ({
  useBranchMessageMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

jest.mock('~/Providers', () => ({
  useAgentsMapContext: () => mockAgentsMap(),
}));

jest.mock('~/Providers/MessagePartsHostContext', () => ({
  useMessagePartsHost: () => ({ useToast: () => jest.fn() }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/components/Share/MessageIcon', () => ({
  __esModule: true,
  default: () => <span data-testid="icon" />,
}));

jest.mock('@librechat/chat/components', () => ({
  MessageTimestamp: () => null,
}));

const endpointsConfig = {
  vLLM: { modelDisplayLabel: 'vLLM' },
  Ollama: { modelDisplayLabel: 'Local AI' },
} as unknown as TEndpointsConfig;

const headerText = (agentId?: string) => {
  const { container, unmount } = render(<SiblingHeader agentId={agentId} messageId="m1" />);
  const text = Array.from(container.querySelectorAll('span'), (span) => span.textContent).filter(
    Boolean,
  );
  unmount();
  return text;
};

describe('SiblingHeader', () => {
  beforeEach(() => {
    mockEndpointsQuery.mockReturnValue({ data: endpointsConfig });
    mockAgentsMap.mockReturnValue({});
  });

  it('tells two models of one labeled endpoint apart', () => {
    expect(headerText('vLLM__Qwen3.6-35B-A3B___vLLM')).toEqual(['Qwen3.6-35B-A3B', 'vLLM']);
    expect(headerText('vLLM__gemma-4-31B___vLLM____1')).toEqual(['gemma-4-31B', 'vLLM']);
    expect(headerText('Ollama__llama3___Local AI')).toEqual(['llama3', 'Local AI']);
  });

  it('still names the model while the endpoints config is not loaded', () => {
    mockEndpointsQuery.mockReturnValue({ data: undefined });
    expect(headerText('vLLM__gemma-4-31B___vLLM')).toEqual(['gemma-4-31B', 'vLLM']);
    expect(headerText('Ollama__llama3___Local AI')).toEqual(['Local AI']);
  });

  it('keeps a custom name and an unlabeled model as the only header text', () => {
    expect(headerText('vLLM__gemma-4-31B___My Bot')).toEqual(['My Bot']);
    expect(headerText('google__gemini-3.6-flash')).toEqual(['gemini-3.6-flash']);
  });

  it('heads a saved agent by its name, whatever endpoint it runs on', () => {
    mockAgentsMap.mockReturnValue({ agent_1: { id: 'agent_1', name: 'Analyst', model: 'm' } });
    expect(headerText('agent_1____1')).toEqual(['Analyst']);
  });

  it('falls back to a generic name without an agent id', () => {
    mockAgentsMap.mockReturnValue(undefined);
    expect(headerText(undefined)).toEqual(['Agent']);
    render(<SiblingHeader agentId={undefined} />);
    expect(screen.getByRole('button', { name: 'com_ui_branch_message' })).toBeDisabled();
  });
});
