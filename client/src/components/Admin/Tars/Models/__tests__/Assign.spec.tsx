import React from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TPrincipal, TTarsModelProfile, TTarsPrincipalInfo } from 'librechat-data-provider';
import ModelAssignModal from '../Assign';

type SaveOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const mockSave = jest.fn();
const mockShowToast = jest.fn();
let mockSaveOptions: SaveOptions = {};
let mockAssignees: TTarsPrincipalInfo[] | undefined;
let mockPicked: TPrincipal[] = [];
let mockExcludeIds: (string | undefined)[] = [];

const profile = {
  id: 'p-1',
  name: 'gpt-5.4',
  version: null,
  type: 'CLOUD',
  description: null,
  status: 1,
  config: null,
  endpoint: 'https://api.openai.com/v1',
  api_version: null,
} as TTarsModelProfile;

const saved = (): TTarsPrincipalInfo[] => [
  { principal_type: 'group', principal_id: 'g1', name: 'BOSS', email: null, is_active: true },
  { principal_type: 'user', principal_id: 'u2', name: 'Old', email: null, is_active: false },
  { principal_type: 'user', principal_id: 'u1', name: 'Amy', email: 'amy@x', is_active: true },
];

const directoryUser = (id: string, name: string): TPrincipal =>
  ({ type: PrincipalType.USER, id: `mongo-${id}`, idOnTheSource: id, name }) as TPrincipal;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useTarsModelAssigneesQuery: () => ({ data: mockAssignees }),
  useSaveTarsModelPermissionMutation: (options: SaveOptions) => {
    mockSaveOptions = options;
    return { mutate: mockSave, isLoading: false };
  },
}));

/** Stands in for the directory combobox: one press adds whatever the test queued up. */
jest.mock('~/components/Sharing/PeoplePicker/DirectoryPeoplePicker', () => ({
  __esModule: true,
  default: ({
    onAddPeople,
    onPendingChange,
    excludeIds,
  }: {
    onAddPeople: (people: TPrincipal[]) => void;
    onPendingChange?: (people: TPrincipal[]) => void;
    excludeIds: (string | undefined)[];
  }) => {
    mockExcludeIds = excludeIds;
    return (
      <>
        <button type="button" data-testid="pick-people" onClick={() => onAddPeople(mockPicked)} />
        <button
          type="button"
          data-testid="check-people"
          onClick={() => onPendingChange?.(mockPicked)}
        />
      </>
    );
  },
}));

const onClose = jest.fn();
const renderModal = () => render(<ModelAssignModal profile={profile} onClose={onClose} />);

const removeButtons = () => screen.queryAllByRole('button', { name: /^com_ui_tars_mcp_unassign / });
const listedNames = () =>
  removeButtons().map((button) => button.getAttribute('aria-label')?.split(' ').slice(1).join(' '));
const remove = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `com_ui_tars_mcp_unassign ${name}` }));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
const savedCall = () =>
  mockSave.mock.calls[0][0] as {
    modelProfileId: string;
    data: { principals: Array<{ principal_type: string; principal_id: string }> };
  };
const savedIds = () => savedCall().data.principals.map((entry) => entry.principal_id);

beforeEach(() => {
  jest.clearAllMocks();
  mockAssignees = saved();
  mockPicked = [];
});

describe('ModelAssignModal', () => {
  it('lists users before groups, each by name, with their status', () => {
    renderModal();
    expect(listedNames()).toEqual(['Amy', 'Old', 'BOSS']);
    expect(screen.getAllByText('com_ui_tars_mcp_principal_active')).toHaveLength(2);
    expect(screen.getByText('com_ui_tars_mcp_disabled')).toBeInTheDocument();
  });

  it('saves only this model, sending each principal as type and id', () => {
    renderModal();
    save();
    expect(savedCall()).toEqual({
      modelProfileId: 'p-1',
      data: {
        principals: [
          { principal_type: 'group', principal_id: 'g1' },
          { principal_type: 'user', principal_id: 'u2' },
          { principal_type: 'user', principal_id: 'u1' },
        ],
      },
    });
  });

  it('adds directory picks, never one already assigned, and hides the assigned from the picker', () => {
    mockPicked = [directoryUser('u1', 'Amy again'), directoryUser('u9', 'Zed')];
    renderModal();
    expect(mockExcludeIds).toEqual(['g1', 'u2', 'u1']);

    fireEvent.click(screen.getByTestId('pick-people'));
    expect(listedNames()).toEqual(['Amy', 'Old', 'Zed', 'BOSS']);
    save();
    expect(savedIds()).toEqual(['g1', 'u2', 'u1', 'u9']);
  });

  it('saves picks still waiting in the picker, as if Add had been pressed', () => {
    mockPicked = [directoryUser('u9', 'Zed')];
    renderModal();
    fireEvent.click(screen.getByTestId('check-people'));
    save();
    expect(savedIds()).toContain('u9');
  });

  it('drops a removed assignee, disabled ones included', () => {
    renderModal();
    remove('Old');
    save();
    expect(savedIds()).toEqual(['g1', 'u1']);
  });

  it('asks before emptying a restricted model, which opens it to everyone', () => {
    renderModal();
    remove('Amy');
    remove('Old');
    remove('BOSS');
    expect(screen.getByText('com_ui_tars_models_assigned_empty')).toBeInTheDocument();

    save();
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText('com_ui_tars_models_open_confirm:gpt-5.4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_tars_models_open_confirm_action' }));
    expect(savedCall().data.principals).toEqual([]);
  });

  it('does not ask when a model nobody was assigned to is saved empty', () => {
    mockAssignees = [];
    renderModal();
    save();
    expect(screen.queryByText('com_ui_tars_models_open_confirm:gpt-5.4')).not.toBeInTheDocument();
    expect(savedCall().data.principals).toEqual([]);
  });

  it('does not ask when the only pick is still waiting in the picker', () => {
    mockAssignees = [saved()[0]];
    mockPicked = [directoryUser('u9', 'Zed')];
    renderModal();
    remove('BOSS');
    fireEvent.click(screen.getByTestId('check-people'));
    save();
    expect(savedIds()).toEqual(['u9']);
  });

  it('closes with a toast once the save succeeds', () => {
    renderModal();
    save();
    act(() => mockSaveOptions.onSuccess?.());
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_models_assign_saved:gpt-5.4',
      status: 'success',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open and shows pwc_tars's reason when the save is refused", () => {
    renderModal();
    save();
    act(() =>
      mockSaveOptions.onError?.({
        response: { status: 400, data: { error: '已停用的對象不可新增：GONE' } },
      }),
    );
    expect(mockShowToast).toHaveBeenCalledWith({
      message: '已停用的對象不可新增：GONE',
      status: 'error',
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('waits for the saved assignees before allowing a save', () => {
    mockAssignees = undefined;
    renderModal();
    expect(screen.getByRole('button', { name: 'com_ui_save' })).toBeDisabled();
    expect(screen.queryByText('com_ui_tars_models_assigned_empty')).not.toBeInTheDocument();
  });
});
