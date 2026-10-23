/**
 * @jest-environment jsdom
 */
import React from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { EModelEndpoint } from 'librechat-data-provider';
import { fireEvent, render } from '@testing-library/react';
import type { TStartupConfig } from 'librechat-data-provider';
import type { UseFormReturn } from 'react-hook-form';
import type { AgentForm } from '~/common';
import ModelPanel from './ModelPanel';

const mockWebSearchAllowed = jest.fn(() => true);

const mockStartupConfig = jest.fn<Partial<TStartupConfig>, []>(() => ({}));

jest.mock('@librechat/client', () => ({
  Alert: ({ children, role = 'alert' }: React.HTMLAttributes<HTMLDivElement>) => (
    <div role={role}>{children}</div>
  ),
  Button: ({
    children,
    onClick,
    type,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ControlCombobox: ({
    ariaLabel,
    disabled,
    items,
    selectedValue,
    selectPlaceholder,
    setValue,
  }: {
    ariaLabel: string;
    disabled?: boolean;
    items: Array<{ label: string; value: string }>;
    selectedValue: string;
    selectPlaceholder?: string;
    setValue: (value: string) => void;
  }) => (
    <div>
      <button type="button" disabled={disabled} aria-label={ariaLabel}>
        {selectedValue || selectPlaceholder}
      </button>
      <span data-testid={`${ariaLabel}-selected`}>{selectedValue}</span>
      <span data-testid={`${ariaLabel}-placeholder`}>{selectPlaceholder}</span>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          disabled={disabled}
          data-testid={`${ariaLabel}-${item.value}`}
          onClick={() => setValue(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('~/components/SidePanel/Parameters/components', () => ({
  componentMapping: {},
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: {} }),
  useGetStartupConfig: () => ({ data: mockStartupConfig() }),
  useReasoningCapabilitiesQuery: () => ({ data: undefined }),
}));

jest.mock('~/Providers', () => ({
  useLiveAnnouncer: () => ({ announcePolite: jest.fn() }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => mockWebSearchAllowed(),
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' '),
}));

let capturedFormMethods: UseFormReturn<AgentForm> | null = null;

const openAIProviders = [{ label: 'OpenAI', value: EModelEndpoint.openAI }];

function TestForm({
  open = true,
  onClose = jest.fn(),
  defaultModel = '',
  defaultProvider = '',
  defaultModelParameters = {},
  modelsByProvider,
  providers = [{ label: 'Custom', value: 'custom' }],
}: {
  open?: boolean;
  onClose?: () => void;
  defaultModel?: string;
  defaultProvider?: string;
  defaultModelParameters?: Partial<AgentForm['model_parameters']>;
  modelsByProvider: Record<string, string[]>;
  providers?: Array<{ label: string; value: string }>;
}) {
  const methods = useForm<AgentForm>({
    defaultValues: {
      provider: defaultProvider,
      model: defaultModel,
      model_parameters: defaultModelParameters,
    },
  });

  capturedFormMethods = methods;

  return (
    <FormProvider {...methods}>
      <ModelPanel
        open={open}
        onClose={onClose}
        providers={providers}
        modelsByProvider={modelsByProvider}
      />
    </FormProvider>
  );
}

describe('ModelPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    capturedFormMethods = null;
    mockStartupConfig.mockReturnValue({});
    mockWebSearchAllowed.mockReturnValue(true);
  });

  it('explains a denied native search control without changing saved model parameters', () => {
    mockWebSearchAllowed.mockReturnValue(false);
    const parameters = { web_search: true, useResponsesApi: true };
    const props = {
      defaultProvider: EModelEndpoint.openAI,
      defaultModel: 'gpt-4o',
      defaultModelParameters: parameters,
      modelsByProvider: { [EModelEndpoint.openAI]: ['gpt-4o'] },
      providers: openAIProviders,
    };
    const { getByRole, queryByRole, rerender } = render(<TestForm {...props} />);

    expect(getByRole('status')).toHaveTextContent('com_ui_native_web_search_denied');
    expect(capturedFormMethods?.getValues('model_parameters')).toEqual(parameters);

    mockWebSearchAllowed.mockReturnValue(true);
    rerender(<TestForm {...props} />);
    expect(queryByRole('status')).toBeNull();
    expect(capturedFormMethods?.getValues('model_parameters')).toEqual(parameters);
  });

  it('explains why native search is unavailable even before the agent requests it', () => {
    mockWebSearchAllowed.mockReturnValue(false);
    const { getByRole } = render(
      <TestForm
        defaultProvider={EModelEndpoint.openAI}
        defaultModel="gpt-4o"
        modelsByProvider={{ [EModelEndpoint.openAI]: ['gpt-4o'] }}
        providers={openAIProviders}
      />,
    );
    expect(getByRole('status')).toHaveTextContent('com_ui_native_web_search_denied');
  });

  it('does not show a search warning for a provider without native search', () => {
    mockWebSearchAllowed.mockReturnValue(false);
    const { queryByRole } = render(
      <TestForm defaultProvider="removed-provider" modelsByProvider={{}} />,
    );
    expect(queryByRole('status')).toBeNull();
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <TestForm open={false} modelsByProvider={{ custom: ['custom-model'] }} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('initializes the dialog from the current form selection', () => {
    const { getByTestId } = render(
      <TestForm
        defaultProvider="custom"
        defaultModel="second-model"
        modelsByProvider={{ custom: ['first-model', 'second-model'] }}
      />,
    );

    expect(getByTestId('com_ui_provider-selected')).toHaveTextContent('custom');
    expect(getByTestId('com_ui_model-selected')).toHaveTextContent('second-model');
  });

  it('selects the first model of a newly chosen provider without touching the form', () => {
    const providers = [
      { label: 'Original', value: 'original' },
      { label: 'Alternate', value: 'alternate' },
    ];
    const { getByTestId } = render(
      <TestForm
        defaultProvider="original"
        defaultModel="original-model"
        modelsByProvider={{ original: ['original-model'], alternate: ['alternate-model'] }}
        providers={providers}
      />,
    );

    fireEvent.click(getByTestId('com_ui_provider-alternate'));

    expect(getByTestId('com_ui_model-selected')).toHaveTextContent('alternate-model');
    expect(capturedFormMethods?.getValues('provider')).toBe('original');
    expect(capturedFormMethods?.getValues('model')).toBe('original-model');
    expect(localStorage.getItem('lastAgentProvider')).toBeNull();
    expect(localStorage.getItem('lastAgentModel')).toBeNull();
  });

  it('commits the selection to the form and storage on confirm', () => {
    const onClose = jest.fn();
    const { getByTestId, getByText } = render(
      <TestForm
        onClose={onClose}
        defaultProvider="custom"
        defaultModel="first-model"
        modelsByProvider={{ custom: ['first-model', 'second-model'] }}
      />,
    );

    fireEvent.click(getByTestId('com_ui_model-second-model'));
    fireEvent.click(getByText('com_ui_confirm'));

    expect(capturedFormMethods?.getValues('provider')).toBe('custom');
    expect(capturedFormMethods?.getValues('model')).toBe('second-model');
    expect(localStorage.getItem('lastAgentProvider')).toBe('custom');
    expect(localStorage.getItem('lastAgentModel')).toBe('second-model');
    expect(onClose).toHaveBeenCalled();
  });

  it('discards the pending selection on cancel', () => {
    const onClose = jest.fn();
    const { getByTestId, getByText } = render(
      <TestForm
        onClose={onClose}
        defaultProvider="custom"
        defaultModel="first-model"
        modelsByProvider={{ custom: ['first-model', 'second-model'] }}
      />,
    );

    fireEvent.click(getByTestId('com_ui_model-second-model'));
    fireEvent.click(getByText('com_ui_close'));

    expect(capturedFormMethods?.getValues('model')).toBe('first-model');
    expect(localStorage.getItem('lastAgentModel')).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('labels the provider and model controls', () => {
    const { container } = render(
      <TestForm defaultProvider="custom" modelsByProvider={{ custom: ['custom-model'] }} />,
    );

    expect(container.querySelector('label[for="provider"]')).not.toBeNull();
    expect(container.querySelector('label[for="model"]')).not.toBeNull();
  });
});
