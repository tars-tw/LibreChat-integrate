import React from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { PrincipalDirectoryResponse } from 'librechat-data-provider';
import DirectoryPeoplePicker from '../PeoplePicker/DirectoryPeoplePicker';

const mockUsePrincipalDirectoryQuery = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

jest.mock('~/data-provider', () => ({
  usePrincipalDirectoryQuery: () => mockUsePrincipalDirectoryQuery(),
}));

jest.mock('../PrincipalAvatar', () => ({
  __esModule: true,
  default: () => <span data-testid="avatar" />,
}));

const directory: PrincipalDirectoryResponse = {
  enabled: true,
  groups: [
    {
      id: null,
      type: PrincipalType.GROUP,
      name: 'Finance',
      source: 'tars',
      idOnTheSource: 'g-finance',
      memberCount: 3,
    },
  ],
  users: [
    {
      id: null,
      type: PrincipalType.USER,
      name: 'Alice Chen',
      email: 'alice@example.com',
      source: 'tars',
      idOnTheSource: 'u-alice',
    },
    {
      id: null,
      type: PrincipalType.USER,
      name: 'Bob Lin',
      username: 'bob',
      source: 'tars',
      idOnTheSource: 'u-bob',
    },
  ],
};

/** Ariakit opens the list on the mouseup that follows a mousedown on the input. */
const openList = () => {
  const input = screen.getByRole('combobox');
  act(() => {
    fireEvent.mouseDown(input);
    fireEvent.mouseUp(input);
    fireEvent.click(input);
  });
  return input;
};

describe('DirectoryPeoplePicker', () => {
  beforeEach(() => {
    mockUsePrincipalDirectoryQuery.mockReturnValue({
      data: directory,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
    });
  });

  it('lists every group and user without typing', () => {
    render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
    openList();

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Finance')).toBeInTheDocument();
    expect(within(listbox).getByText('com_ui_share_group_member_count:3')).toBeInTheDocument();
    expect(within(listbox).getByText('Alice Chen')).toBeInTheDocument();
    expect(within(listbox).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(listbox).getByText('bob')).toBeInTheDocument();
  });

  it('narrows the list by name, email or username', () => {
    render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
    const input = openList();

    act(() => {
      fireEvent.change(input, { target: { value: 'ALICE@' } });
    });

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Alice Chen')).toBeInTheDocument();
    expect(within(listbox).queryByText('Bob Lin')).not.toBeInTheDocument();
    expect(within(listbox).queryByText('Finance')).not.toBeInTheDocument();
  });

  it('shows picked people and groups as removable tags and adds them together', () => {
    const onAddPeople = jest.fn();
    render(<DirectoryPeoplePicker onAddPeople={onAddPeople} />);
    openList();

    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Finance/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Alice Chen/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Bob Lin/ }));
    });

    const chips = screen.getAllByTestId('directory-picker-chip');
    expect(chips.map((chip) => chip.textContent)).toEqual(['Finance', 'Alice Chen', 'Bob Lin']);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_share_remove_selected:Bob Lin' }));
    });
    expect(screen.getAllByTestId('directory-picker-chip')).toHaveLength(2);

    act(() => {
      fireEvent.click(screen.getByTestId('directory-picker-add'));
    });

    expect(onAddPeople).toHaveBeenCalledWith([
      expect.objectContaining({
        type: PrincipalType.GROUP,
        source: 'tars',
        idOnTheSource: 'g-finance',
        name: 'Finance',
      }),
      expect.objectContaining({
        type: PrincipalType.USER,
        source: 'tars',
        idOnTheSource: 'u-alice',
        email: 'alice@example.com',
      }),
    ]);
    expect(screen.queryAllByTestId('directory-picker-chip')).toHaveLength(0);
  });

  it('reports picks not added yet, and none once they are added', () => {
    const onPendingChange = jest.fn();
    /** A host that re-renders with a fresh `excludeIds` array on every report. */
    function Host() {
      const [, setCount] = React.useState(0);
      return (
        <DirectoryPeoplePicker
          onAddPeople={jest.fn()}
          excludeIds={['u-nobody']}
          onPendingChange={(people) => {
            onPendingChange(people);
            setCount((count) => count + 1);
          }}
        />
      );
    }
    render(<Host />);
    openList();

    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Finance/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Alice Chen/ }));
    });

    expect(onPendingChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ idOnTheSource: 'g-finance' }),
      expect.objectContaining({ idOnTheSource: 'u-alice' }),
    ]);
    /** Mount (empty) plus one report per pick — a fresh `excludeIds` does not re-report. */
    expect(onPendingChange).toHaveBeenCalledTimes(3);

    act(() => {
      fireEvent.click(screen.getByTestId('directory-picker-add'));
    });
    expect(onPendingChange).toHaveBeenLastCalledWith([]);
  });

  it('forgets a pick once the host lists it, so removing it later does not bring it back', () => {
    const onPendingChange = jest.fn();
    /** A host that saves picks without Add, then lets the admin remove them again. */
    function Host() {
      const [listed, setListed] = React.useState<string[]>([]);
      return (
        <>
          <DirectoryPeoplePicker
            onAddPeople={jest.fn()}
            excludeIds={listed}
            onPendingChange={onPendingChange}
          />
          <button type="button" data-testid="save-picks" onClick={() => setListed(['u-alice'])} />
          <button type="button" data-testid="remove-alice" onClick={() => setListed([])} />
        </>
      );
    }
    render(<Host />);
    openList();
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Alice Chen/ }));
    });
    expect(onPendingChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ idOnTheSource: 'u-alice' }),
    ]);

    act(() => {
      fireEvent.click(screen.getByTestId('save-picks'));
    });
    expect(onPendingChange).toHaveBeenLastCalledWith([]);

    act(() => {
      fireEvent.click(screen.getByTestId('remove-alice'));
    });
    expect(onPendingChange).toHaveBeenLastCalledWith([]);
    expect(screen.queryAllByTestId('directory-picker-chip')).toHaveLength(0);
  });

  it('does not offer principals already on the share list', () => {
    render(<DirectoryPeoplePicker onAddPeople={jest.fn()} excludeIds={['u-alice', undefined]} />);
    openList();

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).queryByText('Alice Chen')).not.toBeInTheDocument();
    expect(within(listbox).getByText('Bob Lin')).toBeInTheDocument();
  });

  it('opens as a full-width panel under the field and adds from its footer', () => {
    const onAddPeople = jest.fn();
    render(<DirectoryPeoplePicker onAddPeople={onAddPeople} />);
    openList();

    const panel = screen.getByTestId('directory-picker-panel');
    expect(within(panel).getByRole('listbox')).toBeInTheDocument();
    expect(within(panel).getByText('com_ui_selected_count:0')).toBeInTheDocument();
    expect(screen.getByTestId('directory-picker-panel-add')).toBeDisabled();

    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Alice Chen/ }));
    });
    expect(within(panel).getByText('com_ui_selected_count:1')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('directory-picker-panel-add'));
    });
    expect(onAddPeople).toHaveBeenCalledWith([
      expect.objectContaining({ idOnTheSource: 'u-alice' }),
    ]);
    expect(screen.queryByTestId('directory-picker-panel')).not.toBeInTheDocument();
  });

  it('clears the picks from the footer', () => {
    render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
    openList();
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Finance/ }));
    });
    expect(screen.getAllByTestId('directory-picker-chip')).toHaveLength(1);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_clear' }));
    });
    expect(screen.queryAllByTestId('directory-picker-chip')).toHaveLength(0);
  });

  it('closes on Escape and on a press outside, keeping the picks', () => {
    render(
      <div>
        <button type="button" aria-label="outside" />
        <DirectoryPeoplePicker onAddPeople={jest.fn()} />
      </div>,
    );
    const input = openList();
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: /Finance/ }));
    });

    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(screen.queryByTestId('directory-picker-panel')).not.toBeInTheDocument();

    openList();
    expect(screen.getByTestId('directory-picker-panel')).toBeInTheDocument();
    act(() => {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    });
    expect(screen.queryByTestId('directory-picker-panel')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('directory-picker-chip')).toHaveLength(1);
  });

  it('keeps Add disabled until something is picked', () => {
    render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
    expect(screen.getByTestId('directory-picker-add')).toBeDisabled();
  });

  it('offers a retry when the directory fails to load', () => {
    const refetch = jest.fn();
    mockUsePrincipalDirectoryQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    });

    render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
    expect(screen.getByText('com_ui_share_directory_error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  describe('two columns', () => {
    const manyUsers = (count: number): PrincipalDirectoryResponse => ({
      ...directory,
      users: Array.from({ length: count }, (_, index) => ({
        id: null,
        type: PrincipalType.USER,
        name: `User ${String(index + 1).padStart(3, '0')}`,
        source: 'tars' as const,
        idOnTheSource: `u-${index + 1}`,
      })),
    });

    const withDirectory = (data: PrincipalDirectoryResponse) =>
      mockUsePrincipalDirectoryQuery.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: jest.fn(),
      });

    it('lists groups and users in separate columns', () => {
      render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
      openList();

      const groups = screen.getByTestId('directory-picker-groups');
      const users = screen.getByTestId('directory-picker-users');
      expect(within(groups).getByText('com_ui_share_directory_groups (1)')).toBeInTheDocument();
      expect(within(groups).getByText('Finance')).toBeInTheDocument();
      expect(within(groups).queryByText('Alice Chen')).not.toBeInTheDocument();
      expect(within(users).getByText('com_ui_share_directory_users (2)')).toBeInTheDocument();
      expect(within(users).getByText('Alice Chen')).toBeInTheDocument();
      expect(within(users).queryByText('Finance')).not.toBeInTheDocument();
    });

    it('keeps both columns while searching, with an empty one saying so', () => {
      render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
      const input = openList();

      act(() => {
        fireEvent.change(input, { target: { value: 'bob' } });
      });

      const groups = screen.getByTestId('directory-picker-groups');
      expect(within(groups).getByText('com_ui_share_directory_groups (0)')).toBeInTheDocument();
      expect(within(groups).getByText('com_ui_no_results_found')).toBeInTheDocument();
      expect(
        within(screen.getByTestId('directory-picker-users')).getByText('Bob Lin'),
      ).toBeVisible();
    });

    it('lets every user of a mid-sized directory be reached by scrolling', () => {
      withDirectory(manyUsers(60));
      render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
      openList();

      const users = screen.getByTestId('directory-picker-users');
      expect(within(users).getByText('User 060')).toBeInTheDocument();
      expect(within(users).queryByText(/com_ui_share_directory_more/)).not.toBeInTheDocument();
    });

    it('caps a very large column at 200 rows and asks to narrow by typing', () => {
      withDirectory(manyUsers(205));
      render(<DirectoryPeoplePicker onAddPeople={jest.fn()} />);
      openList();

      const users = screen.getByTestId('directory-picker-users');
      expect(within(users).getByText('User 200')).toBeInTheDocument();
      expect(within(users).queryByText('User 201')).not.toBeInTheDocument();
      expect(within(users).getByText('com_ui_share_directory_more:5')).toBeInTheDocument();
    });
  });
});
