import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { FormProvider, useForm } from 'react-hook-form';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AgentForm } from '~/common';
import SourceDownload from '../SourceDownload';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

let formRef: ReturnType<typeof useForm<AgentForm>> | null = null;

function Harness({ defaults }: { defaults: Partial<AgentForm> }) {
  const methods = useForm<AgentForm>({ defaultValues: defaults as AgentForm });
  formRef = methods;
  return (
    <FormProvider {...methods}>
      <SourceDownload />
    </FormProvider>
  );
}

describe('SourceDownload', () => {
  afterEach(() => {
    formRef = null;
  });

  it('stays hidden while the agent has no knowledge search', () => {
    render(<Harness defaults={{ tools: ['tars_sql_query'], tars_source_download: true }} />);
    expect(screen.queryByTestId('agent-tars-source-download')).not.toBeInTheDocument();
  });

  it('shows the stored state and writes the change into the form', () => {
    render(<Harness defaults={{ tools: ['tars_knowledge_search'] }} />);
    const toggle = screen.getByTestId('agent-tars-source-download');
    expect(screen.getByText('com_ui_tars_source_download')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(formRef?.getValues('tars_source_download')).toBe(true);
  });
});
