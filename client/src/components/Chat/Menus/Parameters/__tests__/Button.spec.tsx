import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { TStartupConfig } from 'librechat-data-provider';
import ParametersButton from '../Button';

let mockEndpoint = 'openAI';

jest.mock('librechat-data-provider/react-query', () => ({
  useUserKeyQuery: () => ({ data: { expiresAt: undefined } }),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({
    data: {
      openAI: { type: 'openAI' },
      vLLM: { type: 'custom' },
      Ollama: { type: 'custom' },
    },
  }),
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ conversation: { endpoint: mockEndpoint } }),
}));

jest.mock('../../Endpoints/visibility', () => ({
  useModelSelectorVisible: () => true,
}));

jest.mock('../Dialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ children, description: _description, ...props }: Record<string, unknown>) => (
    <div {...props}>{children as React.ReactNode}</div>
  ),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const startupConfig = { interface: { parameters: true } } as TStartupConfig;

describe('ParametersButton', () => {
  it('shows for a cloud model', () => {
    mockEndpoint = 'openAI';
    render(<ParametersButton startupConfig={startupConfig} />);
    expect(screen.getByTestId('header-parameters-button')).toBeInTheDocument();
  });

  it('shows for other custom endpoints', () => {
    mockEndpoint = 'Ollama';
    render(<ParametersButton startupConfig={startupConfig} />);
    expect(screen.getByTestId('header-parameters-button')).toBeInTheDocument();
  });

  it('hides for pwc_tars local (vLLM) models', () => {
    mockEndpoint = 'vLLM';
    const { container } = render(<ParametersButton startupConfig={startupConfig} />);
    expect(container).toBeEmptyDOMElement();
  });
});
