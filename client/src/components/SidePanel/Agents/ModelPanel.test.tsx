/**
 * @jest-environment jsdom
 */
import React from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { fireEvent, render } from '@testing-library/react';
import type { UseFormReturn } from 'react-hook-form';
import type { AgentForm } from '~/common';
import ModelPanel from './ModelPanel';

jest.mock('@librechat/client', () => ({
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
}));

jest.mock('~/Providers', () => ({
  useLiveAnnouncer: () => ({ announcePolite: jest.fn() }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' '),
}));

let capturedFormMethods: UseFormReturn<AgentForm> | null = null;

function TestForm({
  open = true,
  onClose = jest.fn(),
  defaultModel = '',
  defaultProvider = '',
  modelsByProvider,
  providers = [{ label: 'Custom', value: 'custom' }],
}: {
  open?: boolean;
  onClose?: () => void;
  defaultModel?: string;
  defaultProvider?: string;
  modelsByProvider: Record<string, string[]>;
  providers?: Array<{ label: string; value: string }>;
}) {
  const methods = useForm<AgentForm>({
    defaultValues: {
      provider: defaultProvider,
      model: defaultModel,
      model_parameters: {},
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
