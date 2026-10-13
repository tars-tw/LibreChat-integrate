import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import LangflowView from '../LangflowView';

type MockOption = { value?: string; label?: string; divider?: boolean };

let mockOutcomes: Array<{ ticket: string } | { status: number }> = [];
let mockUser: { role: string } = { role: 'USER' };
const mockMutate = jest.fn();

/**
 * Mirrors react-query's mutation: a stable `mutate` that clears the last error, then settles.
 * The ticket outcome is decided per call so a retry can succeed after a failure.
 */
jest.mock('~/data-provider', () => ({
  useTarsWorkflowTicketMutation: (options: { onSuccess?: (data: { ticket: string }) => void }) => {
    const { useCallback, useRef, useState } = jest.requireActual<typeof import('react')>('react');
    const [error, setError] = useState<unknown>(undefined);
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const mutate = useCallback((actAs?: unknown) => {
      mockMutate(actAs);
      setError(undefined);
      const outcome = mockOutcomes.shift();
      if (outcome && 'ticket' in outcome) {
        optionsRef.current.onSuccess?.(outcome);
        return;
      }
      setError({ response: { status: outcome?.status ?? 500 } });
    }, []);
    return { isError: error !== undefined, error, mutate };
  },
  useTarsWorkflowAccountsQuery: () => ({
    data: [{ tarsId: 'u-42', username: 'alice', lastLoginAt: null }],
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => ({ user: mockUser }),
}));

/** A plain select stands in for the popover Dropdown, keeping the same value contract. */
jest.mock('@librechat/client', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    ...jest.requireActual('@librechat/client'),
    Dropdown: (props: { value: string; onChange: (v: string) => void; options: MockOption[] }) =>
      createElement(
        'select',
        {
          'aria-label': 'workspace',
          value: props.value,
          onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
        },
        props.options
          .filter((option) => !option.divider)
          .map((option) =>
            createElement('option', { key: option.value, value: option.value }, option.label),
          ),
      ),
  };
});

const signInUrl = (ticket: string) =>
  `http://localhost:7860/api/v1/tars/sso?ticket=${encodeURIComponent(ticket)}`;

describe('LangflowView', () => {
  beforeEach(() => {
    mockOutcomes = [];
    mockUser = { role: 'USER' };
    mockMutate.mockClear();
  });

  it('loads Langflow through its sign-in address with a fresh ticket', () => {
    mockOutcomes = [{ ticket: 'ticket-1' }];

    render(<LangflowView />);

    expect(screen.getByTitle('com_ui_langflow')).toHaveAttribute('src', signInUrl('ticket-1'));
    expect(mockMutate).toHaveBeenCalledWith(undefined);
  });

  it('offers no workspace switcher to anyone but an admin', () => {
    mockOutcomes = [{ ticket: 'ticket-1' }];

    render(<LangflowView />);

    expect(screen.queryByLabelText('workspace')).not.toBeInTheDocument();
  });

  it('lets an admin switch into the system account and back', async () => {
    mockUser = { role: 'ADMIN' };
    mockOutcomes = [{ ticket: 'own' }, { ticket: 'system' }, { ticket: 'own-again' }];

    render(<LangflowView />);
    const switcher = screen.getByLabelText('workspace');

    await userEvent.selectOptions(switcher, 'system');
    expect(mockMutate).toHaveBeenLastCalledWith({ type: 'system' });
    expect(screen.getByTitle('com_ui_langflow')).toHaveAttribute('src', signInUrl('system'));

    await userEvent.selectOptions(switcher, 'self');
    expect(mockMutate).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTitle('com_ui_langflow')).toHaveAttribute('src', signInUrl('own-again'));
  });

  it("lets an admin enter a user's workspace and keeps the switcher when that fails", async () => {
    mockUser = { role: 'ADMIN' };
    mockOutcomes = [{ ticket: 'own' }, { status: 404 }];

    render(<LangflowView />);
    await userEvent.selectOptions(screen.getByLabelText('workspace'), 'user:u-42');

    expect(mockMutate).toHaveBeenLastCalledWith({ type: 'user', tarsId: 'u-42' });
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_langflow_no_workspace');
    expect(screen.queryByRole('button', { name: 'com_ui_retry' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('workspace')).toBeInTheDocument();
  });

  it('explains a missing Workflow grant without offering a retry', () => {
    mockOutcomes = [{ status: 403 }];

    render(<LangflowView />);

    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_langflow_no_access');
    expect(screen.queryByRole('button', { name: 'com_ui_retry' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('com_ui_langflow')).not.toBeInTheDocument();
  });

  it('points at the administrator while sign-in is not configured', () => {
    mockOutcomes = [{ status: 503 }];

    render(<LangflowView />);

    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_langflow_not_configured');
    expect(screen.queryByRole('button', { name: 'com_ui_retry' })).not.toBeInTheDocument();
  });

  it('asks for a new ticket for the same workspace on retry after a transient failure', async () => {
    mockOutcomes = [{ status: 502 }, { ticket: 'ticket-2' }];

    render(<LangflowView />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_langflow_signin_failed');

    await userEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));

    expect(screen.getByTitle('com_ui_langflow')).toHaveAttribute('src', signInUrl('ticket-2'));
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });
});
